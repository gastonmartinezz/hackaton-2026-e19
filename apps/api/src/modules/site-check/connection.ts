import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { cacheKey, ProviderBudget, TtlCache, withTimeout } from './cache.js';
import { describeHost } from './domain.js';
import { BlockedHostError, resolvePublic, systemResolver, type HostResolver, type ResolvedAddress } from './net-guard.js';
import { errorKind, unavailable, type Finding, type SourceResult } from './types.js';

const MAX_REDIRECTS = 5;
const CONNECTION_TTL_MS = 60 * 60_000;
const SOURCE = 'Inspección de conexión';

export interface TlsInfo {
  authorized: boolean;
  /** Código de OpenSSL/Node si el certificado no es válido (vencido, autofirmado, nombre distinto…). */
  error: string | null;
  validTo: string | null;
  issuer: string | null;
  protocol: string | null;
}

export interface HopResult {
  status: number;
  location: string | null;
  tls: TlsInfo | null;
}

/** Hace UNA petición a `url` conectando a `address` (ya validada). No sigue redirecciones. */
export type HopRequester = (url: URL, address: ResolvedAddress, timeoutMs: number, signal: AbortSignal) => Promise<HopResult>;

export interface ConnectionData {
  /** Orígenes recorridos, sin path ni query. */
  hops: Array<{ origin: string; status: number }>;
  finalOrigin: string;
  https: boolean;
  tls: TlsInfo | null;
  crossDomainRedirect: boolean;
}

/**
 * Petición real con node:http(s). Conecta a la IP validada (sin segunda resolución DNS), sin
 * cookies ni credenciales, y corta en cuanto llegan los encabezados: nunca descarga el cuerpo.
 */
export const nodeHopRequester: HopRequester = (url, address, timeoutMs, signal) =>
  new Promise<HopResult>((resolve, reject) => {
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) (callback as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address: address.address, family: address.family }]);
      else callback(null, address.address, address.family);
    };
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, {
      method: 'GET',
      headers: { 'user-agent': 'MostrameSiteCheck/1.0', accept: 'text/html' },
      lookup,
      agent: false,
      timeout: timeoutMs,
      signal,
      // Se inspecciona el certificado en vez de abortar: un certificado inválido es un hallazgo.
      rejectUnauthorized: false,
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('Tiempo de espera agotado'), { name: 'TimeoutError' })));
    request.on('error', reject);
    request.on('response', (response) => {
      const socket = response.socket as TLSSocket;
      let tls: TlsInfo | null = null;
      if (url.protocol === 'https:' && typeof socket.getPeerCertificate === 'function') {
        const cert = socket.getPeerCertificate();
        const authError = socket.authorizationError as unknown;
        tls = {
          authorized: socket.authorized,
          error: authError ? String((authError as { code?: string }).code ?? authError).slice(0, 80) : null,
          validTo: cert?.valid_to ? new Date(cert.valid_to).toISOString() : null,
          issuer: typeof cert?.issuer?.O === 'string' ? cert.issuer.O.slice(0, 120) : null,
          protocol: socket.getProtocol?.() ?? null,
        };
      }
      const location = response.headers.location ?? null;
      response.destroy();
      request.destroy();
      resolve({ status: response.statusCode ?? 0, location, tls });
    });
    request.end();
  });

/**
 * Revisa HTTPS, certificado y redirecciones con un fetch controlado. Bloquea localhost, IPs
 * privadas/reservadas y puertos no estándar, valida DNS en cada salto y limita los saltos.
 * Lo que observa este servicio puede diferir de lo que ve la persona (sesión, ubicación).
 */
export class ConnectionInspector {
  private readonly cache = new TtlCache<SourceResult<ConnectionData>>();
  private readonly budget: ProviderBudget;

  constructor(
    private readonly options: {
      timeoutMs: number;
      maxPerMinute: number;
      enabled: boolean;
      resolver?: HostResolver;
      requester?: HopRequester;
      now?: () => number;
    },
  ) {
    this.budget = new ProviderBudget(options.maxPerMinute, options.now);
  }

  /** `url` ya depurada (sin query ni fragmento). */
  inspect(url: URL): Promise<SourceResult<ConnectionData>> {
    const checkedAt = new Date((this.options.now ?? Date.now)()).toISOString();
    if (!this.options.enabled) {
      return Promise.resolve(unavailable(SOURCE, checkedAt, ['disabled'], ['Inspección de conexión deshabilitada (SITE_CHECK_CONNECTION=false).']));
    }
    return this.cache.getOrLoad(
      cacheKey('connection', url.toString()),
      async () => {
        try {
          this.budget.take();
          return await withTimeout(this.options.timeoutMs, (signal) => this.follow(url, checkedAt, signal));
        } catch (error) {
          return unavailable<ConnectionData>(SOURCE, checkedAt, [errorKind(error)]);
        }
      },
      (result) => result.ttlMs,
    );
  }

  private async follow(start: URL, checkedAt: string, signal: AbortSignal): Promise<SourceResult<ConnectionData>> {
    const resolver = this.options.resolver ?? systemResolver;
    const requester = this.options.requester ?? nodeHopRequester;
    const hops: ConnectionData['hops'] = [];
    let current = new URL(start);
    // Último destino realmente consultado: una redirección bloqueada no se visita ni se informa como destino.
    let reached = new URL(start);
    let tls: TlsInfo | null = null;
    let finished = false;
    let blocked = false;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let address: ResolvedAddress;
      try {
        assertAllowed(current);
        address = await resolvePublic(current.hostname, resolver);
      } catch (error) {
        // El primer destino bloqueado invalida todo; una redirección bloqueada deja lo observado hasta ahí.
        if (hop === 0 || !(error instanceof BlockedHostError)) throw error;
        blocked = true;
        break;
      }
      reached = current;
      const result = await requester(current, address, this.options.timeoutMs, signal);
      hops.push({ origin: current.origin, status: result.status });
      if (hop === 0) tls = result.tls;
      if (result.status < 300 || result.status >= 400 || !result.location) {
        finished = true;
        break;
      }
      const next = new URL(result.location, current);
      next.search = '';
      next.hash = '';
      current = next;
    }

    const findings: Finding[] = [];
    const finding = (code: Finding['code'], detail: string) => findings.push({ code, source: SOURCE, checkedAt, observedBy: 'service', detail });
    if (tls && !tls.authorized) finding('CERTIFICATE_PROBLEM', `Certificado no válido (${tls.error ?? 'sin detalle'})`);
    const startDomain = describeHost(start.hostname).registrableDomain;
    const finalDomain = describeHost(reached.hostname).registrableDomain;
    const crossDomainRedirect = startDomain !== finalDomain;
    if (crossDomainRedirect) finding('CROSS_DOMAIN_REDIRECT', `Redirige a otro dominio: ${finalDomain ?? reached.hostname}`);

    const limitations = ['Lo observado por este servicio puede diferir de lo que ve la persona (sesión, ubicación o dispositivo).'];
    if (blocked) limitations.push('Una redirección apunta a una dirección interna o no permitida: no se siguió.');
    else if (!finished) limitations.push(`Se cortó después de ${MAX_REDIRECTS} redirecciones.`);
    return {
      source: SOURCE,
      checkedAt,
      coverage: finished ? 'complete' : 'partial',
      ttlMs: CONNECTION_TTL_MS,
      limitations,
      errors: blocked ? ['blocked_destination'] : [],
      data: { hops, finalOrigin: reached.origin, https: start.protocol === 'https:', tls, crossDomainRedirect },
      findings,
    };
  }
}

/** Solo http(s) a puertos estándar, sin credenciales y a hosts públicos. */
function assertAllowed(url: URL): void {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BlockedHostError('scheme');
  if (url.username || url.password) throw new BlockedHostError('credentials');
  if (url.port !== '' && url.port !== '80' && url.port !== '443') throw new BlockedHostError('port');
  if (describeHost(url.hostname).internal) throw new BlockedHostError('internal_host');
}

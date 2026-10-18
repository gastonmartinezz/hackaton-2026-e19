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
}

export interface HopResult {
  status: number;
  location: string | null;
  tls: TlsInfo | null;
}

/** Hace UNA petición a `url` conectando a `address` (ya validada). No sigue redirecciones. */
export type HopRequester = (url: URL, address: ResolvedAddress, timeoutMs: number, signal: AbortSignal) => Promise<HopResult>;

/**
 * Petición real con node:http(s). Conecta a la IP validada (sin segunda resolución DNS), sin
 * cookies ni credenciales, y corta en cuanto llegan los encabezados: nunca descarga el cuerpo.
 */
const nodeHopRequester: HopRequester = (url, address, timeoutMs, signal) =>
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
        const authError = socket.authorizationError as unknown;
        tls = {
          authorized: socket.authorized,
          error: authError ? String((authError as { code?: string }).code ?? authError).slice(0, 80) : null,
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
  private readonly cache = new TtlCache<SourceResult>();
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
  inspect(url: URL): Promise<SourceResult> {
    const checkedAt = new Date((this.options.now ?? Date.now)()).toISOString();
    // SITE_CHECK_CONNECTION=false
    if (!this.options.enabled) return Promise.resolve(unavailable(['disabled']));
    return this.cache.getOrLoad(
      cacheKey('connection', url.toString()),
      async () => {
        try {
          this.budget.take();
          return await withTimeout(this.options.timeoutMs, (signal) => this.follow(url, checkedAt, signal));
        } catch (error) {
          return unavailable([errorKind(error)]);
        }
      },
      (result) => result.ttlMs,
    );
  }

  private async follow(start: URL, checkedAt: string, signal: AbortSignal): Promise<SourceResult> {
    const resolver = this.options.resolver ?? systemResolver;
    const requester = this.options.requester ?? nodeHopRequester;
    let current = new URL(start);
    // Último destino realmente consultado: una redirección bloqueada no se visita ni se informa como destino.
    let reached = new URL(start);
    // Los certificados no válidos se registran en cualquier salto.
    const badCertificates: string[] = [];
    let finished = false;
    let blocked = false;
    let unreachable = false;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let address: ResolvedAddress;
      try {
        assertAllowed(current);
        address = await resolvePublic(current.hostname, resolver);
      } catch (error) {
        // El primer destino que falla invalida todo; una redirección bloqueada o que no resuelve
        // deja lo observado hasta ahí (certificados y redirecciones de los saltos anteriores).
        if (hop === 0) throw error;
        if (error instanceof BlockedHostError) blocked = true;
        else unreachable = true;
        break;
      }
      let result: HopResult;
      try {
        result = await requester(current, address, this.options.timeoutMs, signal);
      } catch (error) {
        if (hop === 0 || signal.aborted) throw error;
        unreachable = true;
        break;
      }
      reached = current;
      if (result.tls && !result.tls.authorized) badCertificates.push(`${current.origin} (${result.tls.error ?? 'sin detalle'})`);
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
    if (badCertificates.length > 0) finding('CERTIFICATE_PROBLEM', `Certificado no válido en ${badCertificates.join(', ')}`.slice(0, 300));
    const startDomain = describeHost(start.hostname).registrableDomain;
    const finalDomain = describeHost(reached.hostname).registrableDomain;
    if (startDomain !== finalDomain) finding('CROSS_DOMAIN_REDIRECT', `Redirige a otro dominio: ${finalDomain ?? reached.hostname}`);

    // Parcial si una redirección apunta a un destino bloqueado (no se sigue), no responde (queda lo observado
    // hasta ahí) o se superan las MAX_REDIRECTS.
    return {
      coverage: finished ? 'complete' : 'partial',
      ttlMs: CONNECTION_TTL_MS,
      errors: blocked ? ['blocked_destination'] : unreachable ? ['redirect_unreachable'] : [],
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

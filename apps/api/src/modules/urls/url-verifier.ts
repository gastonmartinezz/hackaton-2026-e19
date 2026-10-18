import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/** Por qué una URL no se puede mostrar. Va a los logs y, en texto, al reintento con Claude. */
export type UrlRejection =
  | 'invalid_url'
  | 'scheme'
  | 'credentials'
  | 'port'
  | 'ip_literal'
  | 'local_name'
  | 'private_address'
  | 'dns'
  | 'http_status'
  | 'redirect_loop'
  | 'timeout'
  | 'network';

export type UrlCheck = { ok: true } | { ok: false; reason: UrlRejection; status?: number };

export interface UrlCheckOptions {
  /** Tiempo total por URL, redirecciones incluidas. */
  timeoutMs: number;
  maxRedirects: number;
  /** Cuánto se recuerda un resultado positivo; los negativos, la cuarta parte. */
  cacheTtlMs: number;
  /** http: solo si la especificación lo habilita con una razón visible (S03). Por defecto, solo https. */
  allowHttp: boolean;
}

export interface HeadResult {
  status: number;
  location?: string;
}

/** Puntos de entrada a la red, inyectables en pruebas. */
export interface UrlCheckDeps {
  /** Resuelve un nombre a todas sus direcciones. */
  resolve: (hostname: string) => Promise<string[]>;
  /** Pide la URL sin leer el cuerpo y devuelve status y Location. */
  request: (url: URL, method: 'HEAD' | 'GET', signal: AbortSignal) => Promise<HeadResult>;
  now: () => number;
}

export const USER_AGENT = 'Mostrame-LinkCheck/1.0 (verifica que un enlace exista antes de mostrarlo a la persona)';

const MAX_CACHE_ENTRIES = 1000;
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

/** Redes a las que el servidor nunca se conecta: privadas, loopback, link-local, reservadas y de documentación. */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

/** true si la dirección es privada, loopback, link-local o reservada (incluye IPv4 mapeadas en IPv6). */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Comprueba que una URL que propone Claude exista de verdad antes de mostrarla (S03).
 * Solo https (http si se habilita), sin credenciales ni puertos raros, sin IPs literales
 * ni nombres que resuelvan a redes privadas, en cada salto de redirección. HEAD y, si el
 * sitio no lo acepta, GET sin leer el cuerpo. Válida = respuesta final 2xx.
 */
export class UrlVerifier {
  private readonly cache = new Map<string, { result: UrlCheck; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<UrlCheck>>();

  constructor(
    private readonly options: UrlCheckOptions,
    private readonly deps: UrlCheckDeps = defaultDeps(),
  ) {}

  async verify(raw: string): Promise<UrlCheck> {
    const now = this.deps.now();
    const cached = this.cache.get(raw);
    if (cached && cached.expiresAt > now) return cached.result;
    const pending = this.inFlight.get(raw);
    if (pending) return pending;

    const check = this.check(raw).finally(() => this.inFlight.delete(raw));
    this.inFlight.set(raw, check);
    const result = await check;
    this.remember(raw, result);
    return result;
  }

  private remember(raw: string, result: UrlCheck): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    // Un sitio caído puede volver: los negativos duran menos.
    const ttl = result.ok ? this.options.cacheTtlMs : Math.ceil(this.options.cacheTtlMs / 4);
    this.cache.set(raw, { result, expiresAt: this.deps.now() + ttl });
  }

  private async check(raw: string): Promise<UrlCheck> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, reason: 'invalid_url' };
    }
    const signal = AbortSignal.timeout(this.options.timeoutMs);
    const visited = new Set<string>();

    try {
      for (let hop = 0; hop <= this.options.maxRedirects; hop++) {
        const rejected = await this.rejectTarget(url);
        if (rejected) return rejected;
        if (visited.has(url.href)) return { ok: false, reason: 'redirect_loop' };
        visited.add(url.href);

        let result = await this.deps.request(url, 'HEAD', signal);
        // Hay sitios que no aceptan HEAD (405/501) o lo responden distinto: se prueba GET sin leer el cuerpo.
        if (result.status >= 400) result = await this.deps.request(url, 'GET', signal);

        if (result.status >= 200 && result.status < 300) return { ok: true };
        if (result.status >= 300 && result.status < 400 && result.location) {
          url = new URL(result.location, url);
          continue;
        }
        return { ok: false, reason: 'http_status', status: result.status };
      }
      return { ok: false, reason: 'redirect_loop' };
    } catch (error) {
      if (signal.aborted) return { ok: false, reason: 'timeout' };
      if (error instanceof BlockedAddressError) return { ok: false, reason: 'private_address' };
      if (error instanceof TypeError) return { ok: false, reason: 'invalid_url' };
      return { ok: false, reason: 'network' };
    }
  }

  /** Validaciones de un salto, antes de conectarse. */
  private async rejectTarget(url: URL): Promise<UrlCheck | null> {
    const allowed = this.options.allowHttp ? ['https:', 'http:'] : ['https:'];
    if (!allowed.includes(url.protocol)) return { ok: false, reason: 'scheme' };
    if (url.username || url.password) return { ok: false, reason: 'credentials' };
    if (url.port !== '') return { ok: false, reason: 'port' };

    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (isIP(hostname) !== 0) return { ok: false, reason: 'ip_literal' };
    if (!hostname.includes('.') || hostname === 'localhost' || LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      return { ok: false, reason: 'local_name' };
    }

    let addresses: string[];
    try {
      addresses = await this.deps.resolve(hostname);
    } catch {
      return { ok: false, reason: 'dns' };
    }
    if (addresses.length === 0) return { ok: false, reason: 'dns' };
    // Si alguna dirección es privada, no se usa: el sistema podría elegir esa al conectarse.
    if (addresses.some(isBlockedAddress)) return { ok: false, reason: 'private_address' };
    return null;
  }
}

class BlockedAddressError extends Error {
  override readonly name = 'BlockedAddressError';
}

/**
 * lookup para http/https que vuelve a validar al conectarse: entre la comprobación y la
 * conexión el DNS podría responder otra cosa (DNS rebinding).
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true })
    .then((records) => {
      const safe = records.filter((record) => !isBlockedAddress(record.address));
      if (safe.length !== records.length || safe.length === 0) {
        callback(new BlockedAddressError('Dirección bloqueada'), '', 0);
        return;
      }
      if (options.all) callback(null, safe);
      else callback(null, safe[0]!.address, safe[0]!.family);
    })
    .catch((error: NodeJS.ErrnoException) => callback(error, '', 0));
};

function defaultDeps(): UrlCheckDeps {
  return {
    resolve: async (hostname) => (await dnsLookup(hostname, { all: true })).map((record) => record.address),
    request: (url, method, signal) =>
      new Promise<HeadResult>((resolve, reject) => {
        const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
        const req = send(
          url,
          {
            method,
            signal,
            lookup: safeLookup,
            headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.8' },
          },
          (res: IncomingMessage) => {
            // No se lee el cuerpo: alcanza con el status y Location.
            res.destroy();
            const location = res.headers.location;
            resolve({ status: res.statusCode ?? 0, ...(location ? { location } : {}) });
          },
        );
        req.on('error', reject);
        req.end();
      }),
    now: Date.now,
  };
}

/** Texto técnico corto del motivo, para el reintento con Claude (sin datos de la persona). */
export function describeRejection(check: Exclude<UrlCheck, { ok: true }>): string {
  switch (check.reason) {
    case 'http_status':
      return check.status === 404 ? 'la página no existe (404)' : `el sitio respondió ${check.status}`;
    case 'dns':
      return 'el dominio no existe';
    case 'timeout':
      return 'el sitio no respondió a tiempo';
    case 'network':
      return 'no se pudo conectar con el sitio';
    case 'scheme':
      return 'solo se aceptan direcciones https';
    case 'redirect_loop':
      return 'demasiadas redirecciones';
    default:
      return 'la dirección no está permitida';
  }
}

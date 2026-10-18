/**
 * Qué direcciones se envían a revisar. Las páginas internas, locales, de redes
 * privadas y de desarrollo nunca salen del equipo: se muestran como «Página
 * local, sin revisar». La URL se depura de secretos antes de cualquier envío.
 */
import { sanitizeUrl } from '@asistente/privacy';

export type Eligibility =
  /** Se puede revisar: URL depurada, hostname y dominio registrable aproximado. */
  | { kind: 'eligible'; url: string; hostname: string; registrableDomain: string }
  /** localhost, redes privadas, nombres internos o de prueba. */
  | { kind: 'local' }
  /** Dirección pública que el contrato no puede representar (p. ej. IPv6 literal). */
  | { kind: 'unsupported' }
  /** about:blank, páginas internas o esquemas no web: no hay sitio que revisar. */
  | { kind: 'none' };

/** Sufijos de nombres internos o reservados para pruebas (RFC 2606/6761/6762, home.arpa). */
const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'home.arpa', 'test', 'invalid'];

/**
 * Sufijos públicos de dos niveles frecuentes para el público objetivo. Es una
 * aproximación: el backend recalcula el dominio registrable con la lista completa.
 */
const SECOND_LEVEL = new Set(
  [
    'com', 'gob', 'gub', 'gov', 'org', 'net', 'edu', 'mil', 'int', 'tur', 'coop', 'mutual', 'musica', 'senasa', 'nom', 'co', 'ac', 'or', 'ne', 'go',
  ].flatMap((sld) => ['ar', 'br', 'mx', 'uy', 'py', 'cl', 'pe', 'co', 'bo', 'ec', 've', 'uk', 'au', 'nz', 'jp', 'za', 'es'].map((cc) => `${sld}.${cc}`)),
);

export function checkEligibility(raw: string): Eligibility {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'none' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'none' };
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) return { kind: 'none' };
  if (isLocalHostname(hostname)) return { kind: 'local' };
  if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.length > 253) return { kind: 'unsupported' };
  url.hostname = hostname;
  const clean = sanitizeUrl(url.toString());
  if (!clean) return { kind: 'none' };
  return { kind: 'eligible', url: clean, hostname, registrableDomain: registrableDomain(hostname) };
}

export function isLocalHostname(hostname: string): boolean {
  const host = canonicalHost(hostname.toLowerCase().replace(/\.$/, ''));
  if (host.startsWith('[')) return isLocalIpv6(host.slice(1, -1));
  const ipv4 = parseIpv4(host);
  if (ipv4) return isPrivateIpv4(ipv4);
  // Un nombre sin punto solo resuelve en una red interna.
  if (!host.includes('.')) return true;
  return LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * Forma canónica del host según el parser WHATWG (el mismo que usa Chromium): 0177.0.0.1,
 * 0x7f.0.0.1, 127.1 o 2130706433 pasan a 127.0.0.1. Si no se puede parsear, queda igual.
 */
function canonicalHost(host: string): string {
  if (host.startsWith('[')) return host;
  try {
    return new URL(`http://${host}/`).hostname;
  } catch {
    return host;
  }
}

function parseIpv4(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

function isPrivateIpv4([a, b]: number[]): boolean {
  if (a === undefined || b === undefined) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isLocalIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  // IPv4 mapeada (::ffff:127.0.0.1 o ::ffff:7f00:1).
  const mapped = /^::ffff:(.+)$/.exec(h)?.[1];
  if (mapped) {
    const v4 = parseIpv4(mapped);
    if (v4) return isPrivateIpv4(v4);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
    if (hex) {
      const high = parseInt(hex[1]!, 16);
      return isPrivateIpv4([high >> 8, high & 0xff]);
    }
  }
  return false;
}

/** eTLD+1 aproximado. Las IP públicas se devuelven tal cual. */
export function registrableDomain(hostname: string): string {
  if (parseIpv4(hostname)) return hostname;
  const labels = hostname.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  const take = SECOND_LEVEL.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join('.');
}

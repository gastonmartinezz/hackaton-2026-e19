import { domainToUnicode } from 'node:url';
import { parse } from 'tldts';
import { isBlockedAddress } from './net-guard.js';

export interface HostInfo {
  /** ASCII (punycode) en minúsculas, sin corchetes ni punto final. */
  hostname: string;
  /** Forma Unicode, para detectar caracteres engañosos. */
  unicode: string;
  /** eTLD+1 según la Public Suffix List (incluye la sección privada: github.io, web.app…). */
  registrableDomain: string | null;
  /** Sufijo público ("gob.ar", "com.ar", "web.app"). */
  publicSuffix: string | null;
  /** Dominio registrable sin sufijo ("anses" en anses.gob.ar). */
  label: string | null;
  /** Lo que está a la izquierda del dominio registrable ("www", "argentina.gob.ar" en argentina.gob.ar.evil.com). */
  subdomain: string;
  isIp: boolean;
  /** Local, privado o sin sufijo público: se excluye del análisis externo. */
  internal: boolean;
}

// Sufijos de uso especial o de redes internas que no deben consultarse afuera.
const INTERNAL_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'test', 'example', 'invalid', 'onion', 'home.arpa'];

export function describeHost(raw: string): HostInfo {
  const hostname = raw.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const parsed = parse(hostname, { allowPrivateDomains: true });
  const isIp = parsed.isIp === true;
  const unicode = isIp ? hostname : domainToUnicode(hostname) || hostname;
  const internalSuffix = INTERNAL_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  const knownSuffix = parsed.isIcann === true || parsed.isPrivate === true;
  const internal = isIp ? isBlockedAddress(hostname) : internalSuffix || !knownSuffix || !parsed.domain;
  return {
    hostname,
    unicode,
    registrableDomain: isIp ? null : parsed.domain,
    publicSuffix: isIp ? null : parsed.publicSuffix,
    label: isIp ? null : parsed.domainWithoutSuffix,
    subdomain: isIp ? '' : (parsed.subdomain ?? ''),
    isIp,
    internal,
  };
}

/** Coincidencia por límites de dominio: `a.b` cubre `x.a.b` pero nunca `xa.b` ni `a.b.evil.com`. */
export function hostMatches(hostname: string, domain: string, scope: 'exact' | 'subdomains'): boolean {
  if (hostname === domain) return true;
  return scope === 'subdomains' && hostname.endsWith(`.${domain}`);
}

// Caracteres de otros alfabetos que se ven como letras latinas (subconjunto de los confusables de Unicode TR39).
const CONFUSABLES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  і: 'i', ї: 'i', ј: 'j', ԁ: 'd', ԛ: 'q', ԝ: 'w', ѕ: 's', һ: 'h', ӏ: 'l', ɡ: 'g', ı: 'i', ℓ: 'l',
  α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ω: 'w',
};

/** Esqueleto visual: sin tildes, confusables a ASCII y trucos tipográficos (0→o, 1→l, rn→m, vv→w). */
export function skeleton(text: string): string {
  return [...text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()]
    .map((char) => CONFUSABLES[char] ?? char)
    .join('')
    .replaceAll('0', 'o')
    .replaceAll('1', 'l')
    .replaceAll('rn', 'm')
    .replaceAll('vv', 'w');
}

/** Latín mezclado con cirílico o griego dentro de una misma etiqueta. */
export function hasMixedScripts(label: string): boolean {
  return /\p{Script=Latin}/u.test(label) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(label);
}

/** Distancia de edición con transposiciones (Damerau-Levenshtein restringida). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, d[i - 2]![j - 2]! + 1);
      d[i]![j] = value;
    }
  }
  return d[a.length]![b.length]!;
}

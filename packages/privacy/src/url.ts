/**
 * Depuración de URLs antes de enviarlas (protección de sitios). Las URLs pueden
 * llevar secretos y datos personales en el path, la query y el fragmento
 * (tokens de recuperación, correos, números de documento, sesiones). La política
 * es conservadora: se conserva la forma de la dirección y se ocultan los valores.
 */
import { sanitizeLabel } from './index';

const REDACTED = '[dato]';
const MAX_URL_LENGTH = 2048;
const MAX_QUERY_PARAMS = 20;
const MAX_PATH_SEGMENTS = 30;

/**
 * Segmento o clave que puede ser un secreto o un dato personal. Con `keywords`
 * también cuenta un segmento que nombra una credencial ("token", "clave"): en el
 * path suele venir pegado al valor; como nombre de parámetro de la query no.
 */
export function looksSecret(raw: string, { keywords = true } = {}): boolean {
  const text = safeDecode(raw);
  if (!text) return false;
  if (/[@=]/.test(text)) return true;
  if ((text.match(/\d/g) ?? []).length >= 5) return true;
  if (text.length >= 8 && /\d/.test(text) && /[A-Za-z]/.test(text) && /^[\w.~+/-]+$/.test(text)) return true;
  // Hex de 8 o más caracteres aunque no tenga dígitos (deadbeefcafebabe): tokens y hashes.
  if (/^[a-f0-9]{8,}$/i.test(text)) return true;
  // Cadenas opacas largas (base64, hex, JWT) aunque no mezclen letras y números.
  // Un slug de palabras ("como-sacar-turno") no cuenta.
  const slug = text.split(/[-_]/).every((word) => /^\p{L}{0,20}$/u.test(word));
  if (text.length >= 24 && !slug) return true;
  if (!keywords) return false;
  return /(?:^|[^a-z])(?:token|session|sessionid|sid|auth|apikey|api_key|password|passwd|clave|contrasena|secret|otp|code|codigo)(?:$|[^a-z])/i.test(
    text.normalize('NFD').replace(/\p{Diacritic}/gu, ''),
  );
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function sanitizePath(path: string): string {
  const segments = path.split('/').slice(0, MAX_PATH_SEGMENTS + 1);
  return segments.map((segment) => (segment && looksSecret(segment) ? REDACTED : segment)).join('/');
}

/** Conserva las claves (salvo que parezcan secretos) y oculta todos los valores. */
function sanitizeQuery(search: string): string {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return '';
  const parts = raw
    .split('&')
    .filter(Boolean)
    .slice(0, MAX_QUERY_PARAMS)
    .map((pair) => {
      const index = pair.indexOf('=');
      const key = index === -1 ? pair : pair.slice(0, index);
      const value = index === -1 ? null : pair.slice(index + 1);
      const safeKey = looksSecret(key, { keywords: false }) || key.length > 40 ? REDACTED : key;
      if (value === null) return safeKey;
      if (value === '') return `${safeKey}=`;
      // Un destino dentro de la query (redirect=…) es una señal útil: solo su origen.
      const nested = nestedOrigin(safeDecode(value));
      return `${safeKey}=${nested ?? REDACTED}`;
    });
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function nestedOrigin(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return encodeURIComponent(url.origin);
  } catch {
    return null;
  }
}

/**
 * Fragmento: un ancla simple ("#horarios") se conserva; una ruta de aplicación
 * ("#/cuenta/123") se depura como path y query; cualquier otra cosa
 * (access_token=…, correos) se reemplaza entera.
 */
function sanitizeFragment(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return '';
  const text = safeDecode(raw);
  if (/^[\p{L}\p{N}_-]{1,40}$/u.test(text) && !looksSecret(text)) return `#${raw}`;
  const route = /^(!?\/[^?]*)(\?.*)?$/.exec(raw);
  if (route) return `#${sanitizePath(route[1]!)}${sanitizeQuery(route[2] ?? '')}`;
  return `#${REDACTED}`;
}

/**
 * URL http(s) depurada, o null si no es http(s) o no se puede interpretar.
 * Sin usuario ni contraseña; path, query y fragmento sin secretos.
 */
export function sanitizeUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const origin = `${url.protocol}//${url.host}`;
  let result = `${origin}${sanitizePath(url.pathname)}${sanitizeQuery(url.search)}${sanitizeFragment(url.hash)}`;
  if (result.length > MAX_URL_LENGTH) result = `${origin}${sanitizePath(url.pathname)}`;
  if (result.length > MAX_URL_LENGTH) result = `${origin}/`;
  return result;
}

const URL_LIKE = /^(?:https?:\/\/)?(?:www\.)?[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?::\d+)?(?:[/?#]\S*)?$/iu;

/**
 * Texto de un enlace. Si el texto es una dirección ("www.banco.com/ingresar"),
 * se conserva solo su hostname: sirve para comparar con el destino real sin
 * enviar path ni query. Si no, se depura como cualquier etiqueta.
 */
export function sanitizeLinkText(raw: string, maxLength = 200): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (URL_LIKE.test(text) && !text.includes('@')) {
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      return url.hostname.slice(0, maxLength);
    } catch {
      // sigue como etiqueta
    }
  }
  return sanitizeLabel(text, maxLength);
}

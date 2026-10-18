import type { PageSummary } from '@hackaton/contracts';

/**
 * Segunda depuración en el backend. El navegador ya debería haber quitado secretos y datos
 * personales; acá se vuelve a hacer con una política conservadora, porque lo que sale de este
 * módulo llega a proveedores externos y a la IA. Mismo criterio que `@asistente/privacy`
 * (que no se importa porque se distribuye como fuente TypeScript para el navegador).
 */

/** Segmentos de path que parecen secretos o datos personales. */
const SECRET_SEGMENT = [
  /@/, // correos
  /\d{5,}/, // documentos, teléfonos, números de cuenta o tarjeta
  /^(?=.*\d)(?=.*[a-z])[a-z0-9_-]{16,}$/i, // tokens, ids de sesión, claves
  /^[a-z0-9_-]{24,}$/i, // hashes y tokens largos sin dígitos
  /^ey[a-z0-9_-]+\.[a-z0-9_-]+/i, // JWT
];

const REDACTED_SEGMENT = 'redactado';

/**
 * URL lista para analizar: solo http(s), sin usuario/contraseña, sin query ni fragmento
 * y con los segmentos sospechosos del path reemplazados. Null si no es una URL web válida.
 */
export function sanitizeUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname
    .split('/')
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return REDACTED_SEGMENT;
      }
      return SECRET_SEGMENT.some((pattern) => pattern.test(decoded)) ? REDACTED_SEGMENT : segment;
    })
    .join('/');
  return url;
}

/** Una URL escrita en el texto se reduce a su hostname: path y query pueden llevar datos. */
const urlToHost = (match: string) => {
  try {
    return new URL(match.startsWith('www.') ? `http://${match}` : match).hostname;
  } catch {
    return '[enlace]';
  }
};

/**
 * Valor que sigue a una palabra de credencial («clave: x», «mi contraseña es x», «token=xyz»).
 * Mismo criterio que `@asistente/privacy` (que no se puede importar desde el build de la API):
 * se oculta el resto de la línea, porque no hay forma de saber dónde termina el secreto. El
 * navegador manda el texto por líneas, así que la segunda pasada es idempotente.
 */
const CREDENTIAL = String.raw`contraseñas?|claves?(?: fiscal(?:es)?)?|passwords?|passwd|tokens?|api[ _-]?keys?|pins?`;
const WORD_START = String.raw`(?<![\p{L}\p{N}_])`;
const WORD_END = String.raw`(?![\p{L}\p{N}_])`;
const CREDENTIAL_VALUE = new RegExp(
  String.raw`${WORD_START}(${CREDENTIAL})${WORD_END}([^\S\n]*(?::|=|${WORD_START}(?:es|son|is|are)${WORD_END})[^\S\n]*)[^\n]*\S`,
  'giu',
);

const TEXT_PATTERNS: ReadonlyArray<readonly [RegExp, string | ((match: string) => string)]> = [
  [/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, urlToHost],
  [/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, '[correo]'],
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{8,}\b/g, '[dato]'],
];

/** Texto sin correos, URLs completas, tokens ni números largos (documentos, tarjetas, cuentas, teléfonos). */
export function redactText(input: string, maxLength: number): string {
  let text = input.normalize('NFC').replace(/[­​-‏‪-‮⁠-⁯﻿]/g, '');
  text = text.replace(CREDENTIAL_VALUE, '$1$2[dato]');
  for (const [pattern, replacement] of TEXT_PATTERNS) text = text.replace(pattern, replacement as (match: string) => string);
  text = text.replace(/(?:\+\s?)?\d(?:[\d\s().\-/]*\d)?/g, (match) => (match.replace(/\D/g, '').length >= 5 ? '[número]' : match));
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

const redactOptional = (text: string | undefined, max: number) => {
  if (text === undefined) return undefined;
  const redacted = redactText(text, max);
  return redacted || undefined;
};

/** Resumen de página re-sanitizado. Los enlaces y formularios con URL inválida se descartan. */
export function sanitizePage(page: PageSummary): PageSummary {
  return {
    title: redactOptional(page.title, 200),
    language: page.language,
    text: redactText(page.text, 4000),
    declaredBrand: redactOptional(page.declaredBrand, 120),
    forms: page.forms.map((form) => ({
      method: form.method,
      action: form.action === null ? null : (sanitizeUrl(form.action)?.toString() ?? null),
      fields: form.fields.map((field) => ({
        type: field.type,
        label: redactOptional(field.label, 120),
        autocomplete: field.autocomplete?.toLowerCase().replace(/[^a-z0-9 -]/g, '').slice(0, 60) || undefined,
      })),
    })),
    links: page.links.flatMap((link) => {
      const href = sanitizeUrl(link.href);
      const text = redactText(link.text, 200);
      return href && text ? [{ text, href: href.toString() }] : [];
    }),
  };
}

/**
 * Minimización y redacción local (S05). Se aplica antes de que cualquier texto
 * salga del dispositivo. Las detecciones son imperfectas: la política es
 * conservadora y omite contenido dudoso en lugar de intentar "arreglarlo".
 */

/** Palabras que anuncian una credencial, en singular y plural. */
const CREDENTIAL = String.raw`contraseñas?|claves?(?: fiscal(?:es)?)?|passwords?|passwd|tokens?|api[ _-]?keys?|pins?`;
// Límites de palabra Unicode: `\b` de JavaScript no considera letra a la ñ ni a las vocales con tilde.
const WORD_START = String.raw`(?<![\p{L}\p{N}_])`;
const WORD_END = String.raw`(?![\p{L}\p{N}_])`;
/** Separadores con los que los sitios arman títulos y menús ("Inicio - Banco | Cuenta"). */
const TITLE_SEPARATOR = /\s+[-–—|·:]\s+/;
/** Primera palabra de credencial y todo lo que sigue. */
const CREDENTIAL_AND_REST = new RegExp(String.raw`(${WORD_START}(?:${CREDENTIAL})${WORD_END})[\s\S]*$`, 'iu');

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // URLs: pueden llevar tokens o datos personales en path y query.
  [/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, '[enlace]'],
  // Correos.
  [/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, '[correo]'],
  // Valor que sigue a una palabra de credencial ("clave: x", "mi contraseña es x", "password\nx").
  // Un secreto puede tener espacios, puntos, guiones o venir en otra línea, y no hay forma de
  // saber dónde termina: se oculta todo lo que sigue. Los textos que pasan por acá son de una
  // línea (chat, etiquetas, títulos), así que en la práctica se pierde solo el resto de esa línea.
  // Separadores: ":", "=", "es"/"son", "is"/"are" o un salto de línea. Un espacio solo no
  // alcanza ("olvidé mi contraseña del banco" es un pedido, no un secreto).
  [
    new RegExp(
      String.raw`${WORD_START}(${CREDENTIAL})${WORD_END}([^\S\n]*(?::|=|${WORD_START}(?:es|son|is|are)${WORD_END})\s*|[^\S\n]*\n\s*)[\s\S]*\S`,
      'giu',
    ),
    '$1$2[dato]',
  ],
  // Cadenas de 8 o más caracteres con letras y números mezclados: claves, tokens, códigos, IBAN.
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{8,}\b/g, '[dato]'],
];

/** Números de 5 o más dígitos con separadores: teléfonos, documentos, tarjetas, CBU. */
function redactNumbers(text: string): string {
  return text.replace(/(?:\+\s?)?\d(?:[\d\s().\-/]*\d)?/g, (match) => {
    const digits = match.replace(/\D/g, '').length;
    return digits >= 5 ? '[número]' : match;
  });
}

const PLACEHOLDER = /\[(?:enlace|correo|dato|número)\]/g;

/** Saludos y textos personalizados típicos ("Hola, Ana", "Bienvenido Juan"). */
const PERSONALIZED = /^\s*(?:hola|bienvenid[oa]s?|buen[oa]s? (?:días|tardes|noches)|hi|hello|welcome)\b/i;
const ACCOUNT_HINT = /\b(?:mi cuenta de|sesión iniciada como|conectad[oa] como|signed in as|logged in as)\b/i;

export interface RedactOptions {
  maxLength?: number;
}

/**
 * Devuelve el texto depurado. Reemplaza correos, números largos, tokens y URLs,
 * normaliza espacios y trunca.
 */
/**
 * Forma canónica antes de buscar patrones. Los saltos de línea se conservan: una
 * palabra de credencial al final de una línea anuncia que el valor viene en la
 * siguiente. Los caracteres de formato invisibles se quitan sin dejar espacio:
 * si no, "contra\u200bseña" quedaría como "contra seña" y escaparía a los patrones.
 */
function normalizeText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');
}

export function redactText(input: string, { maxLength = 120 }: RedactOptions = {}): string {
  let text = normalizeText(input);
  for (const [pattern, replacement] of PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  text = redactNumbers(text);
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return text;
}

/**
 * Indica si una etiqueta debe omitirse por completo: textos personalizados o
 * etiquetas que, después de redactar, son mayormente datos.
 */
export function isDoubtfulLabel(redacted: string): boolean {
  if (PERSONALIZED.test(redacted) || ACCOUNT_HINT.test(redacted)) return true;
  const placeholders = redacted.match(PLACEHOLDER) ?? [];
  if (placeholders.length === 0) return false;
  const rest = redacted.replace(PLACEHOLDER, '').replace(/[\s\p{P}]/gu, '');
  return placeholders.length >= 2 || rest.length < 4;
}

/** Etiqueta lista para enviar, o cadena vacía si es dudosa. */
export function sanitizeLabel(raw: string, maxLength = 120): string {
  const redacted = redactText(raw, { maxLength });
  return isDoubtfulLabel(redacted) ? '' : redacted;
}

/**
 * Título del documento listo para enviar. Los sitios suelen armarlo por partes
 * ("Mi cuenta - Hola, Marta | Banco"): se descartan las partes dudosas y se
 * conserva el resto, o cadena vacía si no queda nada.
 */
export function sanitizeTitle(raw: string, maxLength = 200): string {
  // Después de una palabra de credencial puede venir el valor con cualquier separador
  // ("Contraseña - x", "clave: a.b - c"), así que el título se corta ahí.
  // Se normaliza antes de cortar, para que un carácter invisible no parta la palabra.
  const parts = redactText(normalizeText(raw).replace(CREDENTIAL_AND_REST, '$1'), { maxLength: 1000 })
    .split(TITLE_SEPARATOR)
    .map((part) => sanitizeLabel(part, maxLength))
    .filter(Boolean);
  return redactText(parts.join(' - '), { maxLength });
}

/**
 * Devuelve solo el origen (esquema, host y puerto) de una URL http(s). Descarta
 * credenciales, path, query y fragmento. Devuelve null para otros esquemas.
 */
export function sanitizeOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Minimiza la intención escrita por el usuario antes de enviarla. */
export function minimizeIntent(text: string, maxLength = 500): string {
  return redactText(text, { maxLength });
}

/**
 * Busca valores sensibles conocidos dentro de un payload serializado. Pensado
 * para pruebas y para una comprobación defensiva antes de enviar.
 */
export function findLeaks(payload: unknown, secrets: readonly string[]): string[] {
  const serialized = JSON.stringify(payload).toLowerCase();
  return secrets.filter((secret) => secret.length > 0 && serialized.includes(secret.toLowerCase()));
}
export * from './url';

// Conversión de los pasos y la evidencia que devuelve el modelo al formato del
// contrato. El resultado se valida después contra el contrato en cada servicio.
import type { StepOutput } from './schemas.js';

/**
 * `field: null` → sin field. Un field sobre un paso teórico (element null) se
 * descarta: no hay lugar donde escribir. `safeToClick` solo queda si es true,
 * en un paso real y que no pide un dato.
 */
export function toGuideSteps(steps: StepOutput[]) {
  return steps.map(({ field, safeToClick, ...step }) => {
    const real = step.element !== null;
    if (field && real) return { ...step, field };
    return safeToClick && real && !field ? { ...step, safeToClick: true as const } : step;
  });
}

const MAX_EVIDENCE = 200;

/**
 * La evidencia de que la tarea terminó, solo si aparece tal cual en el texto
 * visible del HTML recibido (texto de los elementos y sus aria-label). Sin
 * distinguir mayúsculas y con espacios normalizados. Si no aparece, null: el
 * front pregunta «¿Pudiste terminar?» en lugar de decir «Listo».
 */
export function verifiedEvidence(evidence: string | null, html: string): string | null {
  if (!evidence) return null;
  const quote = unquote(evidence.trim());
  if (!quote || quote.length > MAX_EVIDENCE) return null;
  return normalize(visibleText(html)).includes(normalize(quote)) ? quote : null;
}

const QUOTES: ReadonlyArray<[string, string]> = [['«', '»'], ['“', '”'], ['"', '"'], ["'", "'"]];

/** El modelo a veces devuelve la cita entre comillas: se quitan solo si la envuelven entera. */
function unquote(value: string): string {
  const pair = QUOTES.find(([open, close]) => value.length >= 2 && value.startsWith(open) && value.endsWith(close));
  return pair ? value.slice(1, -1).trim() : value;
}

/**
 * Texto de los nodos y de los aria-label del HTML, separados por espacios. Sin
 * scripts, estilos, plantillas, comentarios ni elementos ocultos (hidden,
 * aria-hidden): lo que el navegador no muestra no prueba nada.
 */
function visibleText(html: string): string {
  const shown = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<([a-z][\w-]*)\b[^>]*\s(?:hidden|aria-hidden="true")[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const labels = [...shown.matchAll(/\saria-label="([^"]*)"/g)].map((match) => match[1]);
  const text = shown.replace(/<[^>]*>/g, ' ');
  return [text, ...labels].map(decodeEntities).join(' ');
}

function decodeEntities(value: string | undefined): string {
  return (value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Un número fuera de rango no corta la verificación: se ignora. */
function codePoint(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');
}

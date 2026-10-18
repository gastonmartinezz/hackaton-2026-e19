// Conversión de los pasos y la evidencia que devuelve el modelo al formato del
// contrato. El resultado se valida después contra el contrato en cada servicio.
import type { StepOutput } from './schemas.js';

/** `field: null` → sin field. Un field sobre un paso teórico (element null) se descarta: no hay lugar donde escribir. */
export function toGuideSteps(steps: StepOutput[]) {
  return steps.map(({ field, ...step }) => (field && step.element !== null ? { ...step, field } : step));
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

/** Texto de los nodos y de los aria-label del HTML sintético, separados por espacios. */
function visibleText(html: string): string {
  const labels = [...html.matchAll(/\saria-label="([^"]*)"/g)].map((match) => match[1]);
  const text = html.replace(/<[^>]*>/g, ' ');
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

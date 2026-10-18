/**
 * Leer en voz alta (POST /v1/speak): qué texto se manda. Solo texto escrito
 * por Guíame (instrucción, pregunta, motivo). Nunca valores de formularios
 * ni citas textuales de la página (por ejemplo la evidencia de «Listo»), que
 * pueden traer datos personales. Funciones puras, usadas por la interfaz y
 * revisadas de nuevo en el proceso principal.
 */
import { SPEAK_MAX_CHARS } from '@hackaton/contracts';

export { SPEAK_MAX_CHARS };

/** Una línea, sin espacios de más ni caracteres de control. */
export function normalizeSpeech(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Recorta a `max` caracteres sin cortar palabras (si una sola palabra no entra, se corta). */
export function clipForSpeech(text: string, max = SPEAK_MAX_CHARS): string {
  const clean = normalizeSpeech(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : clean.slice(0, max)).trim();
}

/** Une frases de Guíame y descarta las vacías. */
export function joinSpeech(...parts: Array<string | null | undefined | false>): string {
  return clipForSpeech(
    parts
      .filter((p): p is string => typeof p === 'string' && normalizeSpeech(p) !== '')
      .map((p) => {
        const t = normalizeSpeech(p);
        return /[.!?…:]$/.test(t) ? t : `${t}.`;
      })
      .join(' '),
  );
}

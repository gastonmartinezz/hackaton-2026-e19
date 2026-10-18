/**
 * TEMPORAL — campos opcionales que la UI pidió al backend y todavía no están en
 * @hackaton/contracts (ramas feat/interpret-respuestas-sugeridas y
 * feat/next-step-evidencia). Se leen con cuidado porque pueden faltar. Borrar
 * este archivo cuando los campos lleguen al contrato y usar los tipos de ahí.
 */
import { z } from 'zod';
import { SPEAK_MAX_CHARS } from '../../shared/speech';

const QuestionExtras = z.object({
  answers: z.array(z.string().trim().min(1).max(60)).min(2).max(4).optional().catch(undefined),
  reason: z.string().trim().min(1).max(200).optional().catch(undefined),
});

const NextStepExtras = z.object({ evidence: z.string().trim().min(1).max(200).optional().catch(undefined) });

/** Cita textual de la página que prueba que la tarea terminó (solo con `done: true`). */
export function nextStepEvidence(response: object): string | null {
  const parsed = NextStepExtras.safeParse(response);
  return parsed.success ? (parsed.data.evidence ?? null) : null;
}

/** Respuestas sugeridas y motivo de una `question` de /v1/interpret. */
export function questionExtras(response: object): { answers: string[]; reason: string | null } {
  const parsed = QuestionExtras.safeParse(response);
  return { answers: parsed.success ? (parsed.data.answers ?? []) : [], reason: parsed.success ? (parsed.data.reason ?? null) : null };
}

/**
 * TEMPORAL — POST /v1/speak (leer en voz alta). Todavía no está en
 * @hackaton/contracts: llega con la rama feature/voz-openai-api. Cuando se
 * mergee, borrar este bloque y usar `SpeakRequest` y las constantes `SPEAK_*`
 * de @hackaton/contracts en api/http.ts, api/client.ts, api/mock.ts,
 * main/speech.ts y shared/speech.ts.
 *
 * Contrato acordado: cuerpo JSON `{ text }` (recortado, de 1 a 600
 * caracteres) → 200 binario `audio/mpeg` (MP3) en streaming. Errores con
 * ApiError: BAD_REQUEST, AI_UNAVAILABLE (`retryable: false` = voz apagada en
 * el servidor), TIMEOUT y RATE_LIMITED.
 */
export { SPEAK_MAX_CHARS };
export const SPEAK_CONTENT_TYPE = 'audio/mpeg';
export const SpeakRequest = z.object({ text: z.string().trim().min(1).max(SPEAK_MAX_CHARS) });
export type SpeakRequest = z.infer<typeof SpeakRequest>;

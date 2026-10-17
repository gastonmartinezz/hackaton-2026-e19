/**
 * TEMPORAL — campos opcionales que la UI pidió al backend y todavía no están en
 * @hackaton/contracts (ramas feat/interpret-respuestas-sugeridas y
 * feat/next-step-evidencia). Se leen con cuidado porque pueden faltar. Borrar
 * este archivo cuando los campos lleguen al contrato y usar los tipos de ahí.
 */
import { z } from 'zod';

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
 * TEMPORAL — respuesta de POST /v1/transcribe (dictado del buscador). Todavía
 * no está en @hackaton/contracts: llega con la rama feature/voice-api. Cuando
 * se mergee, borrar este esquema y usar `TranscribeResponse` de
 * @hackaton/contracts en api/http.ts, api/client.ts y api/mock.ts.
 *
 * Contrato acordado: cuerpo binario `audio/wav` (PCM16 LE, mono, 16 kHz, de
 * 0,3 s a 30 s; ver shared/wav.ts) → 200 `{ text }` con hasta 1000
 * caracteres. `text: ""` significa que no se entendió nada.
 */
export const TranscribeResponse = z.object({ text: z.string().max(1000) });
export type TranscribeResponse = z.infer<typeof TranscribeResponse>;

import { z } from 'zod';
import { Limits, SessionId, ShortText } from './common.js';
import { GuideStep, Metadata } from './options.js';

/**
 * Informa el avance de la guía y pide los pasos que siguen: al empezar una
 * opción, al llegar a un paso teórico (element: null), al terminar los pasos
 * recibidos o después de una navegación. Se llama hasta que devuelve done.
 */
export const NextStepRequest = z.strictObject({
  sessionId: SessionId,
  /** id de la opción elegida, devuelta antes por /v1/options en esta sesión. */
  optionId: ShortText(60),
  /** El paso teórico que se esperaba. */
  expectedStep: GuideStep,
  /** Pasos que la persona completó desde la última llamada. */
  completedSteps: z.array(GuideStep).max(Limits.maxSteps),
  /** Fragmentos de HTML después de que la persona realizó la acción. */
  html: z.string().min(1).max(Limits.maxHtmlLength),
  metadata: Metadata.optional(),
});
export type NextStepRequest = z.infer<typeof NextStepRequest>;

export const NextStepResponse = z.strictObject({
  sessionId: SessionId,
  steps: z.array(GuideStep).max(Limits.maxSteps),
  /** true cuando la tarea terminó y no hay más pasos. */
  done: z.boolean(),
  /**
   * Solo con `done: true`: texto visible de la página, citado tal cual, que
   * prueba que la tarea terminó. Sin él, el front pregunta «¿Pudiste terminar?».
   */
  evidence: ShortText(200).optional(),
});
export type NextStepResponse = z.infer<typeof NextStepResponse>;

import { z } from 'zod';
import { Limits, SessionId, ShortText } from './common.js';
import { GuideStep, Metadata } from './options.js';

/** Se llama cuando la guía llega a un paso teórico (element: null). */
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
});
export type NextStepResponse = z.infer<typeof NextStepResponse>;

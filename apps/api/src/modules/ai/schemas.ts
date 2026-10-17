// Esquemas de SALIDA DEL MODELO. Son internos: el servicio los valida contra
// los contratos públicos antes de responder al front.
import { z } from 'zod';

export const InterpretOutput = z.object({
  type: z.enum(['redirect', 'question', 'options']),
  message: z.string(),
  /** Solo con type "redirect". */
  url: z.string().nullable(),
  /** Solo con type "options". */
  options: z.array(z.object({ title: z.string(), url: z.string(), reason: z.string() })),
  /** Uso interno: objetivo entendido y motivo de la decisión. Se guardan en la sesión, no van al front. */
  goal: z.string(),
  reason: z.string(),
});
export type InterpretOutput = z.infer<typeof InterpretOutput>;

const StepOutput = z.object({
  /** "#id" de un elemento del HTML recibido, o null si el paso es teórico. */
  element: z.string().nullable(),
  instruction: z.string(),
  presentation: z.enum(['highlight', 'scrollAndHighlight']),
  waitFor: z.enum(['userInteraction', 'navigation', 'userConfirmation']),
});

export const OptionsOutput = z.object({
  options: z.array(z.object({ id: z.string(), title: z.string(), steps: z.array(StepOutput) })),
});
export type OptionsOutput = z.infer<typeof OptionsOutput>;

export const NextStepOutput = z.object({
  steps: z.array(StepOutput),
  done: z.boolean(),
});
export type NextStepOutput = z.infer<typeof NextStepOutput>;

/** Códigos que la IA puede sumar en /v1/site-check: solo de contenido y como riesgo medio. */
export const SiteCheckConcernCode = z.enum(['BRAND_IMPERSONATION', 'SENSITIVE_DATA_REQUEST', 'LINK_TEXT_MISMATCH', 'URGENCY_OR_THREAT', 'FORM_SENDS_TO_OTHER_DOMAIN']);

export const SiteCheckOutput = z.object({
  /** Explicación complementaria para la persona. No controla etiquetas ni acciones. */
  explanation: z.string(),
  /** Pedido sospechoso concreto que las reglas no detectaron, o null. */
  concern: z.object({ code: SiteCheckConcernCode, detail: z.string() }).nullable(),
});
export type SiteCheckOutput = z.infer<typeof SiteCheckOutput>;

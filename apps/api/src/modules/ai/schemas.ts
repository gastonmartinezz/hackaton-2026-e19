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

/**
 * Salida de la IA en /v1/site-check. Solo IDENTIFICA: qué organización dice ser la página y qué pide.
 * Nunca aprueba: la organización se busca después en las fuentes de autoridad.
 */
export const SiteCheckOutput = z.object({
  /** Explicación complementaria para la persona. No controla etiquetas ni acciones. */
  explanation: z.string(),
  /** Organización que la página dice ser (marca, organismo o empresa), o null. */
  declaredOrganization: z.string().nullable(),
  organizationKind: z.enum(['government', 'financial_entity', 'company', 'other', 'none']),
  /** País de la organización declarada (ISO 3166-1 alfa-2), o null. */
  country: z.string().nullable(),
  /** Qué pide la página: contraseñas o claves, pagos o datos de tarjeta, códigos de verificación. */
  requests: z.object({ credentials: z.boolean(), payment: z.boolean(), verificationCodes: z.boolean() }),
});
export type SiteCheckOutput = z.infer<typeof SiteCheckOutput>;

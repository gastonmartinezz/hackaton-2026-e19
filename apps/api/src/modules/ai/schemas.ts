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
  /** Solo con type "question": respuestas posibles (2 a 4, cortas) para mostrar como botones; si no, vacío. */
  answers: z.array(z.string()),
  /** Solo con type "question": por qué se pregunta, en una frase que ve la persona; si no, null. */
  why: z.string().nullable(),
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
  /** Solo en pasos que piden un dato de un formulario; si no, null. */
  field: z.object({ question: z.string(), sensitive: z.boolean() }).nullable(),
  /** true si Guíame puede tocar este botón o enlace por la persona cuando ella lo confirma. */
  safeToClick: z.boolean(),
});
export type StepOutput = z.infer<typeof StepOutput>;

export const OptionsOutput = z.object({
  options: z.array(z.object({ id: z.string(), title: z.string(), steps: z.array(StepOutput) })),
  /** Con request: el id de la opción que hace lo que pidió la persona, o null si ninguna. Sin request, null. */
  requestedOptionId: z.string().nullable(),
});
export type OptionsOutput = z.infer<typeof OptionsOutput>;

/** Si cada página que propuso interpret es, por su título real, de lo que pidió la persona. */
export const PageCheckOutput = z.object({
  pages: z.array(z.object({ url: z.string(), matches: z.boolean(), reason: z.string() })),
});
export type PageCheckOutput = z.infer<typeof PageCheckOutput>;

/** Qué opción de las que ya se mostraron hace lo que pidió la persona, o null si ninguna. */
export const MatchOutput = z.object({
  optionId: z.string().nullable(),
  /** false si no es un pedido de algo para hacer (pide repetir, saluda, ruido, no se entiende). */
  isRequest: z.boolean(),
});
export type MatchOutput = z.infer<typeof MatchOutput>;

export const NextStepOutput = z.object({
  steps: z.array(StepOutput),
  done: z.boolean(),
  /** Solo con done: texto visible del HTML, citado tal cual, que prueba que terminó; si no, null. */
  evidence: z.string().nullable(),
  /** true si sin el paso a paso investigado no se sabe cómo seguir desde esta página (se busca y se vuelve a pedir). */
  needsProcedure: z.boolean(),
});
export type NextStepOutput = z.infer<typeof NextStepOutput>;

/**
 * Paso a paso investigado de la opción elegida (tarea `procedure`). Se guarda
 * en la sesión y guía a nextStep por las secciones y páginas del trámite.
 */
export const ProcedureOutput = z.object({
  /** Qué es la tarea y qué se obtiene al terminar. */
  summary: z.string(),
  steps: z.array(z.object({ title: z.string(), detail: z.string() })),
  /** Cómo confirma el sitio que terminó (mensaje, comprobante, número de trámite). */
  completion: z.string(),
  /** URLs de las páginas consultadas (vacío si no hubo búsqueda). */
  sources: z.array(z.string()),
});
export type ProcedureOutput = z.infer<typeof ProcedureOutput>;

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

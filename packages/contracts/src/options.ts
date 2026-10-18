import { z } from 'zod';
import { Limits, SessionId, ShortText } from './common.js';

/**
 * Dato de un formulario que el paso pide. Guíame lo pregunta en voz alta
 * (`question`) y la persona responde. Si no es sensible, Guíame escribe lo que
 * la persona dictó y le pide que lo revise; si es sensible (claves, PIN,
 * códigos, tarjeta, datos bancarios, documento), solo pone el cursor en el
 * lugar y la persona lo escribe. El valor nunca vuelve al backend.
 */
export const FieldAsk = z.strictObject({
  question: ShortText(200),
  sensitive: z.boolean(),
});
export type FieldAsk = z.infer<typeof FieldAsk>;

/**
 * Paso de la guía. `element` es el id de un elemento del HTML recibido (ej. "#el-3"),
 * o null si el paso es teórico: el elemento todavía no existe en la página.
 */
export const GuideStep = z.strictObject({
  element: ShortText(Limits.maxSelectorLength).nullable(),
  instruction: ShortText(300),
  presentation: z.enum(['highlight', 'scrollAndHighlight']),
  waitFor: z.enum(['userInteraction', 'navigation', 'userConfirmation']),
  /** Solo en pasos que piden un dato de un formulario (element apunta a ese lugar). */
  field: FieldAsk.optional(),
});
export type GuideStep = z.infer<typeof GuideStep>;

export const PageOption = z.strictObject({
  id: ShortText(60),
  title: ShortText(120),
  steps: z.array(GuideStep).min(1).max(Limits.maxSteps),
});
export type PageOption = z.infer<typeof PageOption>;

/** Datos que el front conoce del sitio. Se acumulan en la sesión: lo nuevo pisa lo anterior. */
export const Metadata = z.strictObject({
  page: z
    .strictObject({
      title: ShortText(200).optional(),
      language: z.string().min(2).max(10).optional(),
    })
    .optional(),
});
export type Metadata = z.infer<typeof Metadata>;

export const OptionsRequest = z.strictObject({
  /** La que devolvió /v1/interpret. Si falta (página abierta sin chat), el backend crea una. */
  sessionId: SessionId.optional(),
  /** Fragmentos de HTML que el front considera relevantes. */
  html: z.string().min(1).max(Limits.maxHtmlLength),
  metadata: Metadata.optional(),
  /** Lo que la persona quiere hacer en esta página (por ejemplo, lo que escribió en «¿No está lo que buscás?»). */
  goal: ShortText(Limits.maxMessageLength).optional(),
  /**
   * Lo que la persona pidió con sus palabras (escrito o dicho) porque no estaba
   * entre las opciones. El backend investiga cómo se hace en este sitio y
   * devuelve esa tarea como primera opción, con el camino desde esta página.
   */
  request: ShortText(Limits.maxMessageLength).optional(),
});
export type OptionsRequest = z.infer<typeof OptionsRequest>;

export const OptionsResponse = z.strictObject({
  sessionId: SessionId,
  options: z.array(PageOption).max(10),
  /**
   * Solo con `request`: el id de la opción que hace lo que pidió la persona
   * (va primera). Ausente si ninguna lo hace: el front muestra las opciones y
   * no empieza ninguna sola.
   */
  requestedOptionId: ShortText(60).optional(),
});
export type OptionsResponse = z.infer<typeof OptionsResponse>;

import { z } from 'zod';
import { Limits, ShortText } from './common.js';

/** Selector CSS generado por Claude a partir del HTML recibido. */
export const ElementSelector = ShortText(Limits.maxSelectorLength);

export const OptionsRequest = z.strictObject({
  /** Ausente en la primera llamada; el backend crea la sesión. */
  sessionId: z.string().min(1).max(64).optional(),
  /** id de la opción elegida por la persona. */
  goal: ShortText(60).optional(),
  /** Fragmentos de HTML que el front considera relevantes. */
  html: z.string().min(1).max(Limits.maxHtmlLength),
});
export type OptionsRequest = z.infer<typeof OptionsRequest>;

export const PageOption = z.strictObject({
  id: ShortText(60),
  title: ShortText(120),
  initialElement: ElementSelector,
});
export type PageOption = z.infer<typeof PageOption>;

export const GuideStep = z.strictObject({
  element: ElementSelector,
  presentation: z.enum(['highlight', 'scrollAndHighlight']),
  instruction: ShortText(300),
  waitFor: z.enum(['userInteraction', 'navigation', 'userConfirmation']),
});
export type GuideStep = z.infer<typeof GuideStep>;

export const Guide = z.strictObject({
  goal: ShortText(60),
  step: GuideStep,
});
export type Guide = z.infer<typeof Guide>;

export const OptionsResponse = z.strictObject({
  sessionId: z.string(),
  options: z.array(PageOption).max(10),
  /** null si Claude no encuentra un paso posible en el HTML recibido. */
  guide: Guide.nullable(),
});
export type OptionsResponse = z.infer<typeof OptionsResponse>;

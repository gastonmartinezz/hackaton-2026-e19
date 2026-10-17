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
});
export type InterpretOutput = z.infer<typeof InterpretOutput>;

export const OptionsOutput = z.object({
  options: z.array(z.object({ id: z.string(), title: z.string(), initialElement: z.string() })),
  guide: z
    .object({
      goal: z.string(),
      step: z.object({
        element: z.string(),
        presentation: z.enum(['highlight', 'scrollAndHighlight']),
        instruction: z.string(),
        waitFor: z.enum(['userInteraction', 'navigation', 'userConfirmation']),
      }),
    })
    .nullable(),
});
export type OptionsOutput = z.infer<typeof OptionsOutput>;

// TEMPORAL: respuestas simuladas deterministas para desarrollar y probar sin
// llamar a Claude (AI_PROVIDER=mock). También sirven al front para integrar.
// No se permite en producción.
import type { InterpretRequest } from '@hackaton/contracts';
import type { z } from 'zod';
import type { AiTask, StructuredModel, StructuredRequest } from './model.js';
import type { InterpretOutput, OptionsOutput } from './schemas.js';

type Handler = (input: any) => unknown;

export const defaultMockHandlers: Record<AiTask, Handler> = {
  // Primer mensaje: pregunta. Con más contexto: redirige.
  interpret: (input: InterpretRequest): InterpretOutput =>
    input.messages.length === 1
      ? { type: 'question', message: '¿Me contás un poco más qué querés hacer?', url: null, options: [] }
      : { type: 'redirect', message: 'Te llevo a este sitio.', url: 'https://www.example.com/', options: [] },

  // Usa el primer id="..." del HTML como elemento.
  options: (input: { html: string; goal?: string }): OptionsOutput => {
    const id = /\sid="([A-Za-z][\w-]*)"/.exec(input.html)?.[1];
    if (!id) return { options: [], guide: null };
    const selector = `#${id}`;
    return {
      options: [{ id: 'start', title: 'Empezar', initialElement: selector }],
      guide: {
        goal: input.goal ?? 'start',
        step: {
          element: selector,
          presentation: 'highlight',
          instruction: 'Hacé clic acá para empezar.',
          waitFor: 'userInteraction',
        },
      },
    };
  },
};

export class MockModel implements StructuredModel {
  constructor(private readonly handlers: Record<AiTask, Handler> = defaultMockHandlers) {}

  async generate<S extends z.ZodType>(request: StructuredRequest<S>): Promise<z.infer<S>> {
    // Valida igual que con Claude para que los mocks no diverjan del esquema.
    return request.schema.parse(this.handlers[request.task](request.input));
  }
}

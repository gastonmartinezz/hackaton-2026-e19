// TEMPORAL: respuestas simuladas deterministas para desarrollar y probar sin
// llamar a Claude (AI_PROVIDER=mock). También sirven al front para integrar.
// No se permite en producción.
import type { InterpretRequest } from '@hackaton/contracts';
import type { z } from 'zod';
import type { AiTask, StructuredModel, StructuredRequest } from './model.js';
import type { InterpretOutput, NextStepOutput, OptionsOutput, SiteCheckOutput } from './schemas.js';

type Handler = (input: any) => unknown;

const firstId = (html: string) => /\sid="([A-Za-z][\w-]*)"/.exec(html)?.[1];

export const defaultMockHandlers: Record<AiTask, Handler> = {
  // Primer mensaje: pregunta. Con más contexto: redirige.
  interpret: (input: InterpretRequest): InterpretOutput =>
    input.messages.length === 1
      ? {
          type: 'question',
          message: '¿Me contás un poco más qué querés hacer?',
          url: null,
          options: [],
          goal: 'Sin definir',
          reason: 'Falta información.',
        }
      : {
          type: 'redirect',
          message: 'Te llevo a este sitio.',
          url: 'https://www.example.com/',
          options: [],
          goal: 'Objetivo simulado',
          reason: 'Respuesta simulada.',
        },

  // Una opción: primer paso sobre el primer id="..." del HTML y un segundo paso teórico.
  options: (input: { html: string }): OptionsOutput => {
    const id = firstId(input.html);
    if (!id) return { options: [] };
    return {
      options: [
        {
          id: 'start',
          title: 'Empezar',
          steps: [
            {
              element: `#${id}`,
              instruction: 'Hacé clic acá para empezar.',
              presentation: 'highlight',
              waitFor: 'userInteraction',
            },
            {
              element: null,
              instruction: 'Seguí con el paso siguiente.',
              presentation: 'highlight',
              waitFor: 'userInteraction',
            },
          ],
        },
      ],
    };
  },

  // Con un id en el HTML: un paso real. Sin ids: la tarea terminó.
  nextStep: (input: { html: string }): NextStepOutput => {
    const id = firstId(input.html);
    if (!id) return { steps: [], done: true };
    return {
      steps: [
        { element: `#${id}`, instruction: 'Ahora hacé clic acá.', presentation: 'highlight', waitFor: 'userInteraction' },
      ],
      done: false,
    };
  },

  // Explicación fija según el riesgo calculado por reglas; no identifica organizaciones ni pedidos
  // (con el mock solo cuentan las reglas determinísticas sobre declaredBrand y formularios).
  siteCheck: (input: { risk: string }): SiteCheckOutput => ({
    explanation:
      input.risk === 'high'
        ? 'Encontramos señales de que este sitio podría ser una estafa. No ingreses contraseñas, códigos ni datos de tarjeta.'
        : input.risk === 'medium'
          ? 'Encontramos algunas señales para tener en cuenta. Revisá con cuidado antes de ingresar datos.'
          : 'No encontramos señales de estafa en las comprobaciones realizadas.',
    declaredOrganization: null,
    organizationKind: 'none',
    country: null,
    requests: { credentials: false, payment: false, verificationCodes: false },
  }),
};

export class MockModel implements StructuredModel {
  constructor(private readonly handlers: Record<AiTask, Handler> = defaultMockHandlers) {}

  async generate<S extends z.ZodType>(request: StructuredRequest<S>): Promise<z.infer<S>> {
    // Valida igual que con Claude para que los mocks no diverjan del esquema.
    return request.schema.parse(this.handlers[request.task](request.input));
  }
}

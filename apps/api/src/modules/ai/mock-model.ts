// TEMPORAL: respuestas simuladas deterministas para desarrollar y probar sin
// llamar a Claude (AI_PROVIDER=mock). También sirven al front para integrar.
// No se permite en producción.
import type { InterpretRequest } from '@hackaton/contracts';
import type { z } from 'zod';
import type { AiTask, StructuredModel, StructuredRequest } from './model.js';
import type { InterpretOutput, MatchOutput, NextStepOutput, OptionsOutput, ProcedureOutput, SiteCheckOutput } from './schemas.js';

type Handler = (input: any) => unknown;

const firstId = (html: string) => /\sid="([A-Za-z][\w-]*)"/.exec(html)?.[1];

interface NextStepInput {
  html: string;
  procedure?: unknown;
  completedSteps?: Array<{ element: string | null; field?: unknown }>;
  context?: { history: Array<{ type: string; completedSteps?: Array<{ element: string | null; field?: unknown }> }> };
}

/** Lugares de datos que la persona ya completó en la sesión: el mock no vuelve a pedirlos. */
function completedFields(input: NextStepInput): Set<string> {
  const steps = [...(input.completedSteps ?? []), ...(input.context?.history ?? []).flatMap((entry) => entry.completedSteps ?? [])];
  return new Set(steps.flatMap((step) => (step.field && step.element ? [step.element] : [])));
}

/** Primer lugar para escribir del HTML: `<input>` de texto (no botones, casilleros ni opciones) o `<textarea>`. */
function firstTextbox(html: string, skip: ReadonlySet<string>): { id: string; label: string; sensitive: boolean } | undefined {
  for (const match of html.matchAll(/<(input|textarea)\b([^>]*)>/g)) {
    const attrs = match[2] ?? '';
    const type = /\stype="([^"]*)"/.exec(attrs)?.[1] ?? 'text';
    if (match[1] === 'input' && ['submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'hidden'].includes(type)) continue;
    const id = /\sid="([A-Za-z][\w-]*)"/.exec(attrs)?.[1];
    if (!id || skip.has(`#${id}`)) continue;
    return { id, label: /\saria-label="([^"]*)"/.exec(attrs)?.[1] || 'el espacio', sensitive: type === 'password' };
  }
  return undefined;
}

/** Texto del primer título del HTML (evidencia simulada de que terminó). */
const firstHeading = (html: string) => /<h\d\b[^>]*>([^<]+)<\/h\d>/.exec(html)?.[1]?.trim() ?? null;

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
  // Con request (algo que la persona pidió con sus palabras), esa opción se llama como el pedido.
  options: (input: { html: string; request?: string }): OptionsOutput => {
    const id = firstId(input.html);
    if (!id) return { options: [], requestedOptionId: null };
    return {
      requestedOptionId: input.request ? 'request' : null,
      options: [
        {
          id: input.request ? 'request' : 'start',
          title: input.request ? input.request.slice(0, 120) : 'Empezar',
          steps: [
            {
              element: `#${id}`,
              instruction: 'Hacé clic acá para empezar.',
              presentation: 'highlight',
              waitFor: 'userInteraction',
              field: null,
              safeToClick: false,
            },
            {
              element: null,
              instruction: 'Seguí con el paso siguiente.',
              presentation: 'highlight',
              waitFor: 'userInteraction',
              field: null,
              safeToClick: false,
            },
          ],
        },
      ],
    };
  },

  // Con un lugar para escribir que falta: un paso de datos (sensible si es una contraseña). Con otro id: un
  // clic. Sin ids pendientes: la tarea terminó, con el primer título como evidencia. Lo ya completado no se repite.
  // Al empezar una opción sin paso a paso investigado, pide investigarlo (needsProcedure).
  nextStep: (input: NextStepInput): NextStepOutput => {
    const needsProcedure = input.procedure == null && (input.completedSteps?.length ?? 0) === 0;
    const filled = completedFields(input);
    const textbox = firstTextbox(input.html, filled);
    if (textbox) {
      return {
        steps: [
          {
            element: `#${textbox.id}`,
            instruction: `Escribí el dato en «${textbox.label}».`,
            presentation: 'scrollAndHighlight',
            waitFor: 'userConfirmation',
            field: textbox.sensitive
              ? { question: `Ese dato lo escribís vos en «${textbox.label}».`, sensitive: true }
              : { question: `¿Qué escribo en «${textbox.label}»?`, sensitive: false },
            safeToClick: false,
          },
        ],
        done: false,
        evidence: null,
        needsProcedure,
      };
    }
    const id = [...input.html.matchAll(/\sid="([A-Za-z][\w-]*)"/g)].map((match) => match[1]).find((candidate) => !filled.has(`#${candidate}`));
    if (!id) return { steps: [], done: true, evidence: firstHeading(input.html), needsProcedure };
    return {
      steps: [{ element: `#${id}`, instruction: 'Ahora hacé clic acá.', presentation: 'highlight', waitFor: 'userInteraction', field: null, safeToClick: true }],
      done: false,
      evidence: null,
      needsProcedure,
    };
  },

  // Paso a paso fijo, sin búsqueda.
  // Una opción cuyo título comparte al menos la mitad de sus palabras con el pedido; si no, ninguna.
  match: (input: { request: string; options: Array<{ id: string; title: string }> }): MatchOutput => {
    const words = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const said = new Set(words(input.request));
    const found = input.options.find((o) => {
      const title = words(o.title);
      return title.length > 0 && title.filter((w) => said.has(w)).length / title.length >= 0.5;
    });
    return { optionId: found?.id ?? null, isRequest: said.size >= 2 };
  },

  procedure: (input: { option?: { title: string }; request?: string }): ProcedureOutput => ({
    summary: `Simulación del paso a paso de «${input.option?.title ?? input.request ?? ''}».`,
    steps: [
      { title: 'Empezar la tarea', detail: 'Hacer clic en el botón de la opción.' },
      { title: 'Completar los datos', detail: 'Pide los datos del formulario.' },
      { title: 'Confirmar', detail: 'Enviar el formulario y esperar la confirmación.' },
    ],
    completion: 'La página muestra un título de confirmación.',
    sources: [],
  }),

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

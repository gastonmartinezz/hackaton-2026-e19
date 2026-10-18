/**
 * TEMPORAL — backend simulado para probar el cliente sin el servidor de Agustin
 * (sección 0, regla 4). Respeta el contrato de @hackaton/contracts (sesión
 * desde /v1/interpret, guía por opción y /v1/next-step).
 * NO es una implementación paralela del servidor: heurísticas mínimas y fijas,
 * sin Claude. Se reemplaza configurando ASISTENTE_API_URL (el backend real
 * también tiene modo mock con AI_PROVIDER=mock).
 */
import { randomUUID } from 'node:crypto';
import type {
  GuideStep,
  InterpretRequest,
  InterpretResponse,
  NextStepRequest,
  NextStepResponse,
  OptionsRequest,
  OptionsResponse,
  PageOption,
  SiteCheckRequest,
  SiteCheckResponse,
  SiteOption,
} from '@hackaton/contracts';
import { ApiFailure, type ApiClient } from './client';
import { mockSiteCheck, mockSiteCheckDelay, unverifiedSiteCheck } from './mock-site-check';

export interface MockOptions {
  /** Origen del servidor local de páginas de prueba, si está activo. */
  fixturesOrigin: string | null;
  latencyMs?: number;
  /**
   * Respuestas de demostración de Protección de sitios («Sitio oficial» para bancos inventados, etc.). Solo en
   * desarrollo: una versión empaquetada sin backend responde «No pudimos verificarlo» y nunca inventa oficialidad.
   */
  demoSiteCheck?: boolean;
}

interface MockSession {
  /** Opciones devueltas por /v1/options en esta sesión. */
  options: Set<string>;
}

export class MockApiClient implements ApiClient {
  readonly isMock = true;
  readonly #sessions = new Map<string, MockSession>();

  constructor(private readonly config: MockOptions) {}

  async interpret(request: InterpretRequest, signal: AbortSignal): Promise<InterpretResponse> {
    await this.#wait(signal);
    const sessionId = this.#session(request.sessionId);
    return { sessionId, ...interpretMock(request, this.#sites()) };
  }

  async options(request: OptionsRequest, signal: AbortSignal): Promise<OptionsResponse> {
    await this.#wait(signal);
    const sessionId = this.#session(request.sessionId);
    const options = buildOptions(parse(request.html));
    for (const option of options) this.#sessions.get(sessionId)!.options.add(option.id);
    return { sessionId, options };
  }

  /** Las guías del simulador terminan después del último paso teórico. */
  async nextStep(request: NextStepRequest, signal: AbortSignal): Promise<NextStepResponse> {
    await this.#wait(signal);
    const session = this.#sessions.get(request.sessionId);
    if (!session) throw new ApiFailure('SESSION_NOT_FOUND', false);
    if (!session.options.has(request.optionId)) throw new ApiFailure('BAD_REQUEST', false);
    // TEMPORAL: `evidence` todavía no está en el contrato (ver api/pending-contract.ts).
    // Cita el título de la página si confirma algo; si no, no hay evidencia.
    const heading = parse(request.html).find((e) => /^h[1-6]$/.test(e.tag))?.label ?? '';
    const evidence = /confirm|registr|reservad|gracias|éxito/i.test(heading) ? heading.slice(0, 200) : undefined;
    const response: NextStepResponse & { evidence?: string } = { sessionId: request.sessionId, steps: [], done: true, ...(evidence ? { evidence } : {}) };
    return response;
  }

  /** Protección de sitios: estados según el hostname de las páginas de demostración. */
  async siteCheck(request: SiteCheckRequest, signal: AbortSignal): Promise<SiteCheckResponse> {
    if (this.config.demoSiteCheck === false) {
      await this.#wait(signal, 0);
      return unverifiedSiteCheck(request);
    }
    await this.#wait(signal, mockSiteCheckDelay(request.hostname));
    return mockSiteCheck(request);
  }

  /** Devuelve la sesión indicada (o una nueva si no se indicó ninguna). */
  #session(id: string | undefined): string {
    if (id) {
      if (!this.#sessions.has(id)) throw new ApiFailure('SESSION_NOT_FOUND', false);
      return id;
    }
    const created = `s-${randomUUID().slice(0, 8)}`;
    this.#sessions.set(created, { options: new Set() });
    return created;
  }

  #sites(): SiteOption[] {
    const fixtures = this.config.fixturesOrigin;
    const sites: SiteOption[] = [];
    if (fixtures) {
      sites.push(
        { title: 'Biblioteca de prueba — Horarios', url: `${fixtures}/horarios.html`, reason: 'Tiene una sección de horarios y contacto.' },
        { title: 'Catálogo de prueba — Buscador', url: `${fixtures}/buscar.html`, reason: 'Permite buscar dentro del sitio.' },
        { title: 'Turnos de prueba — Formulario', url: `${fixtures}/formulario.html`, reason: 'Tiene un formulario para pedir turno.' },
        { title: 'Protección de sitios — Demostración', url: `${fixtures}/proteccion.html`, reason: 'Páginas para ver cada estado de la revisión.' },
      );
    }
    sites.push({ title: 'Wikipedia en español', url: 'https://es.wikipedia.org/', reason: 'Sitio real para probar navegación.' });
    return sites;
  }

  async #wait(signal: AbortSignal, extraMs = 0): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, (this.config.latencyMs ?? 350) + extraMs);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new ApiFailure('ABORTED', false));
        },
        { once: true },
      );
    });
  }
}

/**
 * Reglas fijas para recorrer las tres respuestas:
 * - texto muy corto o sin una tarea reconocible → `question`
 * - coincide con un solo sitio → `redirect`
 * - coincide con varios (o "opciones") → `options`
 */
type MockInterpretation = DistributiveOmit<InterpretResponse, 'sessionId'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function interpretMock(request: InterpretRequest, sites: SiteOption[]): MockInterpretation {
  const users = request.messages.filter((m) => m.role === 'user');
  const text = normalize(users.map((m) => m.content).join(' '));
  const words = keywords(text);
  const matches = sites.filter((site) => words.some((w) => normalize(`${site.title} ${site.reason}`).includes(w)));
  const wantsOptions = /\b(opciones|sitios|varios)\b/.test(text);

  if (wantsOptions || matches.length > 1) {
    const options = (matches.length > 1 ? matches : sites).slice(0, 5);
    if (options.length >= 2) return { type: 'options', message: 'Encontré estos sitios. Elegí uno para abrirlo.', options };
  }
  if (matches.length === 1) return { type: 'redirect', message: `Te llevo a ${matches[0]!.title}.`, url: matches[0]!.url };
  // «No estoy seguro»: no se insiste, se recomiendan sitios.
  if (normalize(users.at(-1)?.content ?? '') === 'no estoy seguro')
    return { type: 'options', message: 'Por lo que buscaste, estos sitios son los que mejor se ajustan.', options: sites.slice(0, 5) };
  if (users.length >= 3) return { type: 'options', message: 'No estoy seguro; estos sitios pueden servirte.', options: sites.slice(0, 5) };
  if (users.length > 1) return { type: 'question', message: '¿Podés contarme un poco más?' };
  // TEMPORAL: answers y reason todavía no están en el contrato (ver api/pending-contract.ts).
  const question: MockInterpretation & { answers: string[]; reason: string } = {
    type: 'question',
    message: '¿Qué querés hacer?',
    answers: ['Ver horarios', 'Buscar un libro', 'Pedir un turno'],
    reason: 'Cada cosa se hace en un sitio distinto.',
  };
  return question;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function keywords(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5);
}

/* ------------------------- /v1/options sobre el HTML ------------------------- */

interface MockElement {
  id: string;
  tag: string;
  type?: string | undefined;
  label: string;
  disabled: boolean;
  /** Sección contenedora más cercana. */
  parent?: string | undefined;
}

const SECTION_TAGS = new Set(['main', 'nav', 'search', 'form', 'header', 'footer', 'aside', 'section', 'dialog']);
const VOID_TAGS = new Set(['input']);
const FIELD = (e: MockElement) => (e.tag === 'input' && !['submit', 'button', 'reset', 'image'].includes(e.type ?? '')) || e.tag === 'select' || e.tag === 'textarea';
const CLICKABLE = (e: MockElement) => e.tag === 'a' || e.tag === 'button' || (e.tag === 'input' && ['submit', 'button'].includes(e.type ?? ''));

/** Lee el HTML sintético del cliente (bien formado y con un id por elemento). */
function parse(html: string): MockElement[] {
  const elements: MockElement[] = [];
  const stack: string[] = [];
  const pattern = /<(\/?)([a-z0-9]+)([^>]*)>([^<]*)/gi;
  for (const match of html.matchAll(pattern)) {
    const [, closing, rawTag, attrs = '', text = ''] = match;
    const tag = rawTag!.toLowerCase();
    if (closing) {
      if (SECTION_TAGS.has(tag)) stack.pop();
      continue;
    }
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
    const id = attr('id');
    if (id) {
      elements.push({
        id,
        tag,
        type: attr('type'),
        label: decode(attr('aria-label') ?? text).trim(),
        disabled: /\bdisabled\b/.test(attrs),
        parent: stack.at(-1),
      });
    }
    if (SECTION_TAGS.has(tag) && !VOID_TAGS.has(tag)) stack.push(id ?? '');
  }
  return elements;
}

function decode(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const step = (element: MockElement, instruction: string, waitFor: GuideStep['waitFor']): GuideStep => ({
  element: `#${element.id}`,
  presentation: 'scrollAndHighlight',
  instruction: instruction.slice(0, 300),
  waitFor,
});

/** Paso teórico final: el resultado aparece después de la última acción. */
const check = (instruction: string): GuideStep => ({ element: null, presentation: 'highlight', instruction, waitFor: 'userConfirmation' });

function buildOptions(page: MockElement[]): PageOption[] {
  const enabled = page.filter((e) => !e.disabled);
  const options: PageOption[] = [];

  const search = enabled.find((e) => e.type === 'search' || (FIELD(e) && /busc|search/i.test(e.label)));
  if (search) {
    const button = enabled.find((e) => CLICKABLE(e) && e.parent === search.parent);
    const steps = [step(search, `Escribí lo que buscás en «${search.label || 'Buscar'}».`, 'userInteraction')];
    if (button) steps.push(step(button, `Ahora hacé clic en «${button.label}».`, 'userInteraction'));
    options.push({ id: `search-${search.id}`, title: 'Buscar en este sitio', steps: [...steps, check('Revisá los resultados.')] });
  }

  for (const form of page.filter((e) => e.tag === 'form')) {
    const fields = enabled.filter((e) => e.parent === form.id && FIELD(e));
    const submit = enabled.find((e) => e.parent === form.id && CLICKABLE(e));
    if (fields.length < 2) continue;
    const steps = fields.map((field) => step(field, `Completá «${field.label || 'este campo'}».`, 'userInteraction'));
    if (submit) steps.push(step(submit, `Cuando esté todo, hacé clic en «${submit.label}».`, 'navigation'));
    options.push({ id: `form-${form.id}`, title: `Completar: ${form.label || 'formulario'}`.slice(0, 120), steps: [...steps, check('Revisá el mensaje de confirmación.')].slice(0, 15) });
  }

  for (const link of enabled.filter((e) => CLICKABLE(e) && e.label.length >= 3 && e.parent !== search?.parent).slice(0, 6)) {
    options.push({
      id: `go-${link.id}`,
      title: `Ir a «${link.label}»`.slice(0, 120),
      steps: [step(link, `Hacé clic en «${link.label}».`, 'navigation'), check('Revisá la página que se abrió.')],
    });
  }
  return options.slice(0, 10);
}

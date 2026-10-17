/**
 * TEMPORAL — backend simulado para probar el cliente sin el servidor de Agustin
 * (sección 0, regla 4). Respeta el contrato propuesto en @hackaton/contracts.
 * NO es una implementación paralela del servidor: heurísticas mínimas y fijas,
 * sin Claude ni buscador. Se reemplaza configurando ASISTENTE_API_URL.
 */
import {
  SCHEMA_VERSION,
  type DestinationCandidate,
  type GuideDecision,
  type GuidanceNextRequest,
  type PageElement,
  type PageOption,
  type PageOptionsRequest,
  type PageSnapshot,
} from '@hackaton/contracts';
import { ApiFailure, type ApiClient } from './client';

export interface MockOptions {
  /** Origen del servidor local de páginas de prueba, si está activo. */
  fixturesOrigin: string | null;
  latencyMs?: number;
}

export class MockApiClient implements ApiClient {
  readonly isMock = true;

  constructor(private readonly options: MockOptions) {}

  async interpretIntent(request: Parameters<ApiClient['interpretIntent']>[0], signal: AbortSignal) {
    await this.#wait(signal);
    const clarifications = request.clarifications ?? [];
    const text = normalize([request.intent, ...clarifications.map((c) => c.answer)].join(' '));
    const needsCountry = /\b(documento|dni|pasaporte|renovar|tramite)\b/.test(text) && !/\b(argentina|uruguay|chile|espana|mexico|peru|colombia|paraguay|bolivia)\b/.test(text);
    if (needsCountry && clarifications.length === 0) {
      return { schemaVersion: SCHEMA_VERSION, requestId: request.requestId, status: 'needsClarification' as const, question: '¿En qué país querés hacer el trámite?' };
    }
    const goal = [request.intent, ...clarifications.map((c) => c.answer)].join(' — ').slice(0, 500);
    return { schemaVersion: SCHEMA_VERSION, requestId: request.requestId, status: 'goal' as const, goal };
  }

  async searchDestinations(request: Parameters<ApiClient['searchDestinations']>[0], signal: AbortSignal) {
    await this.#wait(signal);
    const fixtures = this.options.fixturesOrigin;
    const candidates: DestinationCandidate[] = [];
    if (fixtures) {
      candidates.push(
        { id: 'c-horarios', title: 'Biblioteca de prueba — Horarios', url: `${fixtures}/horarios.html`, description: 'Página local de prueba con información y horarios.', reason: 'Tiene una sección de horarios y contacto.', verifiedOfficial: false },
        { id: 'c-buscar', title: 'Catálogo de prueba — Buscador', url: `${fixtures}/buscar.html`, description: 'Página local de prueba con un buscador interno.', reason: 'Permite buscar dentro del sitio.', verifiedOfficial: false },
        { id: 'c-turno', title: 'Turnos de prueba — Formulario', url: `${fixtures}/formulario.html`, description: 'Formulario local de prueba. No envía datos a ningún lado.', reason: 'Tiene un formulario para pedir turno.', verifiedOfficial: false },
      );
    }
    candidates.push({ id: 'c-wiki', title: 'Wikipedia en español', url: 'https://es.wikipedia.org/', description: 'Enciclopedia libre.', reason: 'Sitio real para probar navegación.', verifiedOfficial: false });

    const goal = normalize(request.goal);
    const score = (c: DestinationCandidate) => keywords(goal).filter((k) => normalize(`${c.title} ${c.description} ${c.reason}`).includes(k)).length;
    const best = [...candidates].sort((a, b) => score(b) - score(a))[0];
    return { schemaVersion: SCHEMA_VERSION, requestId: request.requestId, candidates, recommendedId: best && score(best) > 0 ? best.id : null };
  }

  async pageOptions(request: PageOptionsRequest, signal: AbortSignal): Promise<unknown> {
    await this.#wait(signal);
    const { snapshot } = request;
    const correlation = correlate(request.requestId, snapshot);
    const options = buildOptions(snapshot, request.goal ?? '');
    if (options.length === 0) {
      return { ...correlation, status: 'unsupported', message: 'No encontré controles para ayudarte en esta página.' };
    }
    return { ...correlation, status: 'options', primary: options.slice(0, 3), secondary: options.slice(3, 8) };
  }

  async guidanceNext(request: GuidanceNextRequest, signal: AbortSignal): Promise<unknown> {
    await this.#wait(signal);
    return { ...correlate(request.requestId, request.snapshot), ...nextStep(request) };
  }

  async endSession(): Promise<void> {}

  async #wait(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.options.latencyMs ?? 350);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new ApiFailure('aborted', false));
      }, { once: true });
    });
  }
}

function correlate(requestId: string, snapshot: PageSnapshot) {
  return { schemaVersion: SCHEMA_VERSION, requestId, navigationId: snapshot.navigationId, revision: snapshot.revision };
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function keywords(text: string): string[] {
  return normalize(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
}

const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'spinbutton']);

function buildOptions(snapshot: PageSnapshot, goal: string): PageOption[] {
  const els = snapshot.elements.filter((e) => e.enabled);
  const options: PageOption[] = [];

  const search = els.find((e) => e.role === 'searchbox' || (e.role === 'textbox' && /busc|search/i.test(e.label)));
  if (search) {
    const button = els.find((e) => e.role === 'button' && e.sectionId === search.sectionId && e.id !== search.id);
    options.push({ id: `search-${search.id}`, title: 'Buscar en este sitio', description: 'Te muestro dónde escribir y cómo buscar.', evidenceElementIds: button ? [search.id, button.id] : [search.id] });
  }

  for (const form of snapshot.elements.filter((e) => e.role === 'form')) {
    const fields = els.filter((e) => e.sectionId === form.id && FIELD_ROLES.has(e.role));
    if (fields.length >= 2) {
      options.push({ id: `form-${form.id}`, title: `Completar: ${form.label || 'formulario'}`.slice(0, 80), description: 'Te guío campo por campo. Lo que escribas queda en tu computadora.', evidenceElementIds: [form.id] });
    }
  }

  const goalWords = keywords(goal);
  const links = els
    .filter((e) => (e.role === 'link' || e.role === 'button') && e.label.length >= 3 && e.id !== search?.id)
    .map((e) => ({ e, score: goalWords.filter((k) => normalize(e.label).includes(k)).length }))
    .sort((a, b) => b.score - a.score);
  for (const { e } of links.slice(0, 6)) {
    options.push({ id: `go-${e.id}`, title: `Ir a «${e.label}»`.slice(0, 80), description: 'Te muestro dónde hacer clic.', evidenceElementIds: [e.id] });
  }
  return options;
}

type Body = Omit<Extract<GuideDecision, { status: 'guide' }>, 'schemaVersion' | 'requestId' | 'navigationId' | 'revision'> | { status: 'completed' | 'needsClarification' | 'unsupported'; message: string };

function nextStep(request: GuidanceNextRequest): Body {
  const { snapshot, option, previousStep, stepCount } = request;
  const byId = new Map(snapshot.elements.map((e) => [e.id, e]));
  const outcome = previousStep?.outcome ?? 'none';
  const [kind, ...rest] = (option?.id ?? '').split('-');
  const refId = rest.join('-');

  if (outcome === 'targetNotVisible' || outcome === 'targetStale') {
    if (stepCount > 6) return { status: 'unsupported', message: 'No logro señalarte el lugar en esta página. Probá desplazarte o volver al inicio.' };
  }

  if (kind === 'go') {
    const target = byId.get(refId);
    if (stepCount === 0 && target) return guide(target, `Hacé clic en «${target.label}».`, 'navigation');
    return { status: 'completed', message: 'Parece que llegaste. Si no es lo que buscabas, tocá «Volver».' };
  }

  if (kind === 'search') {
    const box = byId.get(refId) ?? snapshot.elements.find((e) => e.role === 'searchbox');
    const button = box && snapshot.elements.find((e) => e.role === 'button' && e.sectionId === box.sectionId);
    if (stepCount === 0 && box) return guide(box, `Escribí lo que buscás en «${box.label || 'Buscar'}».`, 'interaction');
    if (stepCount === 1 && button) return guide(button, `Ahora hacé clic en «${button.label}».`, 'pageChange');
    return { status: 'completed', message: 'Listo: estos son los resultados. ¿Encontraste lo que buscabas?' };
  }

  if (kind === 'form') {
    const fields = snapshot.elements.filter((e) => e.sectionId === refId && FIELD_ROLES.has(e.role) && e.enabled);
    const submit = snapshot.elements.find((e) => e.sectionId === refId && e.role === 'button');
    if (outcome === 'validationError' && fields[0]) {
      return guide(fields[0], 'La página marcó un error. Revisá los campos resaltados por el sitio, empezando por este.', 'interaction');
    }
    if (fields.length === 0 && stepCount > 0) return { status: 'completed', message: 'La página cambió. Si ves un mensaje de confirmación, el trámite de prueba terminó.' };
    const field = fields[stepCount];
    if (field) return guide(field, `Completá «${field.label || 'este campo'}».`, 'interaction');
    if (submit && stepCount === fields.length) return guide(submit, `Cuando esté todo, hacé clic en «${submit.label}».`, 'pageChange');
    return { status: 'needsClarification', message: '¿Ves un mensaje de confirmación? Si es así, tocá «Ya lo hice».' };
  }

  return { status: 'unsupported', message: 'No sé cómo ayudarte con esa tarea en esta página.' };
}

function guide(target: PageElement, instruction: string, expectedSignal: 'interaction' | 'navigation' | 'pageChange'): Body {
  return { status: 'guide', instruction: instruction.slice(0, 300), targetElementId: target.id, presentation: 'scrollAndHighlight', expectedSignal };
}

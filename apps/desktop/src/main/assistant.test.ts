// @vitest-environment happy-dom
/**
 * Recorrido del cliente completo (extractor real + HTML sintético + máquina de
 * estados + orquestador) contra el backend simulado y páginas de prueba.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OptionsRequest, type GuideStep, type NextStepRequest } from '@hackaton/contracts';
import { extractSnapshot, resolveSelector, snapshotToHtml, type ElementRegistry } from '@asistente/page-analyzer';
import { findLeaks } from '@asistente/privacy';
import { isSensitiveField } from '@asistente/guidance';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure, ApiSession, type ApiClient } from './api/client';
import { MockApiClient } from './api/mock';
import { Assistant, type PagePort } from './assistant';
import { DICTATABLE_TYPES, dictatedValue, matchListOption } from '../shared/dictation';
import { isField } from '../preload/page/highlighter';

const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/pages');

function load(page: string) {
  const html = readFileSync(join(FIXTURES, page), 'utf8');
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`http://127.0.0.1:4321/${page}?nombre=Marta`);
  document.body.innerHTML = html.replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
}

/** Hace lo mismo que el preload de la página, sin Electron. */
class FakePage implements PagePort {
  registry: ElementRegistry | undefined;
  html = '';
  shown: string[] = [];
  focused: string[] = [];
  async extract(pageId: string, navigationId: string, revision: number) {
    const result = extractSnapshot(document, { pageId, navigationId, revision, previous: this.registry });
    this.registry = result.registry;
    this.html = snapshotToHtml(result.snapshot);
    return { snapshot: result.snapshot, notes: result.notes };
  }
  async show(navigationId: string, selector: string) {
    const registry = this.registry?.navigationId === navigationId ? this.registry : undefined;
    const elementId = registry ? resolveSelector(selector, this.html, document, (node) => registry.idOf(node)) : undefined;
    if (!elementId || !registry?.resolve(elementId)) return { result: 'stale' as const };
    this.shown.push(elementId);
    const element = registry.resolve(elementId)!;
    const type = element.localName === 'select' ? 'select' : element.localName === 'textarea' ? 'textarea' : (element.getAttribute('type') ?? 'text');
    return {
      result: 'shown' as const,
      elementId,
      clickable: ['button', 'a'].includes(element.localName),
      field: isField(element),
      fillable: element.localName === 'select' || DICTATABLE_TYPES.has(type),
      sensitive: isSensitiveField({ inputType: element.getAttribute('type') ?? undefined, name: element.getAttribute('name') ?? undefined }),
    };
  }
  /** Como el preload: escribe lo dictado sin que cuente como interacción de la persona. */
  async fill(navigationId: string, elementId: string, said: string) {
    const element = this.registry?.navigationId === navigationId ? this.registry.resolve(elementId) : undefined;
    if (!element) return 'stale' as const;
    if (element instanceof HTMLSelectElement) {
      const index = matchListOption(said, Array.from(element.options, (o) => o.text));
      if (index === null) return 'noMatch' as const;
      element.selectedIndex = index;
      return 'filled' as const;
    }
    const value = dictatedValue(said, element.getAttribute('type') ?? 'text');
    if (value === null) return 'noMatch' as const;
    (element as HTMLInputElement).value = value;
    return 'filled' as const;
  }
  focus(_navigationId: string, elementId: string) {
    this.focused.push(elementId);
  }
  clicked: string[] = [];
  /** Como el preload: toca el control señalado (el clic lo informa el observador; acá lo hace la prueba). */
  async click(navigationId: string, elementId: string) {
    const element = this.registry?.navigationId === navigationId ? this.registry.resolve(elementId) : undefined;
    if (!element) return 'stale' as const;
    this.clicked.push(elementId);
    (element as HTMLElement).click();
    return 'clicked' as const;
  }
  clear() {}
  cancelPending() {}
}

const mockApi = (latencyMs = 0) => new MockApiClient({ fixturesOrigin: null, latencyMs });

/** Envuelve el cliente para registrar todo lo que saldría del dispositivo. */
function recording(api: ApiClient, overrides: Partial<ApiClient> = {}) {
  const sent: Array<OptionsRequest | NextStepRequest> = [];
  const wrapped: ApiClient = {
    isMock: true,
    interpret: (r, s) => api.interpret(r, s),
    options: (r, s) => (sent.push(r), (overrides.options ?? api.options.bind(api))(r, s)),
    nextStep: (r, s) => (sent.push(r), (overrides.nextStep ?? api.nextStep.bind(api))(r, s)),
    transcribe: (w, s) => api.transcribe(w, s),
    speak: (r, s) => api.speak(r, s),
    siteCheck: (r, s) => api.siteCheck(r, s),
  };
  return { api: wrapped, sent };
}

function setup(api: ApiClient = mockApi(), session = new ApiSession()) {
  const page = new FakePage();
  const assistant = new Assistant({ api, session, page, onChange: () => {}, settleMs: 0, afterClickMs: 0 });
  const until = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 2000, interval: 5 });
  const target = () => page.registry!.resolve(assistant.state.step!.targetElementId!) as HTMLElement;
  const shownStep = () => assistant.state.phase === 'waitingForUser' && assistant.state.step?.targetElementId !== undefined;
  return { page, assistant, until, target, shownStep, session };
}

const step = (element: string | null, waitFor: GuideStep['waitFor'] = 'userInteraction'): GuideStep => ({
  element,
  instruction: element ? `Usá ${element}.` : 'Seguí en la página nueva.',
  presentation: 'highlight',
  waitFor,
});

describe('Assistant', () => {
  it('guía un formulario hasta terminar: dicta lo no sensible, el documento lo escribe la persona y no transmite valores', async () => {
    load('formulario.html');
    // La sesión la crea el chat (/v1/interpret) en el mismo simulador.
    const session = new ApiSession();
    const mock = mockApi();
    session.begin().commit((await mock.interpret({ messages: [{ role: 'user', content: 'turno' }] }, new AbortController().signal)).sessionId);
    const rec = recording(mock);
    const { assistant, until, target, page, shownStep } = setup(rec.api, session);

    assistant.expectDestination('pedir turno');
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    await until(() => assistant.state.phase === 'choosing');
    expect(assistant.state.goal).toBe('pedir turno');
    const form = assistant.state.options.find((o) => o.id.startsWith('form-'));
    expect(form).toBeDefined();

    // Al elegir, la guía le pide los pasos reales a /v1/next-step.
    assistant.select(form!.id);
    expect(assistant.state.phase).toBe('guiding');

    // Nombre: Guíame lo pregunta, la persona lo dice y Guíame lo escribe; avanza al confirmar.
    await until(() => shownStep() && target().id === 'nombre');
    expect(assistant.ask).toMatchObject({ mode: 'dictate', filled: false });
    expect(assistant.ask!.question).toMatch(/Nombre y apellido/);
    // Entrar al lugar no alcanza para avanzar.
    assistant.interaction(assistant.state.step!.targetElementId!, 'click');
    expect(target().id).toBe('nombre');
    expect(await assistant.fill('Marta Gómez.')).toBe('filled');
    expect((target() as HTMLInputElement).value).toBe('Marta Gómez');
    expect(assistant.ask).toMatchObject({ filled: true });
    assistant.confirmDone();

    // Documento: dato sensible. No se dicta: el cursor queda ahí y avanza cuando la persona termina de escribir.
    await until(() => shownStep() && target().id === 'doc');
    expect(assistant.ask).toMatchObject({ mode: 'type' });
    expect(page.focused).toContain(assistant.state.step!.targetElementId);
    expect(await assistant.fill('30123456')).toBe('notAllowed');
    (target() as HTMLInputElement).value = '30123456';
    assistant.interaction(assistant.state.step!.targetElementId!, 'change');

    // Sede: una lista; lo dicho elige la opción.
    await until(() => shownStep() && target().localName === 'select');
    expect(await assistant.fill('la del centro')).toBe('filled');
    expect((target() as HTMLSelectElement).value).toBe('Centro');
    assistant.confirmDone();

    await until(() => shownStep() && target().localName === 'button');
    expect(assistant.state.step!.waitFor).toBe('navigation');
    expect(assistant.ask).toBeNull();
    // Un clic no alcanza cuando se espera una navegación.
    assistant.interaction(assistant.state.step!.targetElementId!, 'click');
    expect(assistant.state.phase).toBe('waitingForUser');

    assistant.navigationStarted();
    load('confirmacion.html');
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    await until(() => assistant.state.phase === 'completed');
    expect(assistant.evidence).toMatch(/Turno confirmado/);

    expect(page.shown.length).toBe(4);
    const [options, first, last] = rec.sent as [OptionsRequest, NextStepRequest, NextStepRequest];
    expect(rec.sent).toHaveLength(3);
    expect(options.sessionId).toBe(session.id);
    expect(options.goal).toBe('pedir turno');
    expect(first).toMatchObject({ sessionId: session.id, optionId: form!.id, completedSteps: [] });
    expect(last.completedSteps).toHaveLength(4);
    expect(last.completedSteps[0]!.field).toMatchObject({ sensitive: false });
    // Sale solo el sitio (origen), nunca la ruta, la consulta ni lo que escribió la persona.
    expect(findLeaks(rec.sent, ['Marta Gómez', '30123456', 'Centro', 'Marta', '/formulario', 'formulario.html', 'nombre='])).toEqual([]);
    expect(options.metadata?.page?.origin).toBe('http://127.0.0.1:4321');
  });

  it('después de un clic espera antes del paso siguiente: si la página cambia, no lo muestra ni lo cuenta como hecho', async () => {
    load('horarios.html');
    const mock = mockApi();
    let links: GuideStep[] = [];
    let calls = 0;
    const { api, sent } = recording(mock, {
      options: async (r, s) => {
        const response = await mock.options(r, s);
        links = response.options.filter((o) => o.id.startsWith('go-')).slice(0, 2).map((o) => ({ ...o.steps[0]!, waitFor: 'userInteraction' as const }));
        return { ...response, options: [{ id: 'x', title: 'X', steps: links }] };
      },
      nextStep: async (r) => (++calls === 1 ? { sessionId: r.sessionId, steps: links, done: false } : { sessionId: r.sessionId, steps: [], done: false }),
    });
    const page = new FakePage();
    const assistant = new Assistant({ api, session: new ApiSession(), page, onChange: () => {}, settleMs: 0, afterClickMs: 40 });
    const until = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 2000, interval: 5 });
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    assistant.select('x');
    await until(() => assistant.state.phase === 'waitingForUser' && assistant.state.step?.targetElementId !== undefined);

    assistant.interaction(assistant.state.step!.targetElementId!, 'click');
    // El paso siguiente queda en espera: no se señala (ni se lee) todavía.
    expect(assistant.settling).toBe(true);
    expect(page.shown).toHaveLength(1);
    assistant.navigationStarted();
    await new Promise((r) => setTimeout(r, 60));
    expect(page.shown).toHaveLength(1);

    assistant.navigated({ sameDocument: false, aiEnabled: true });
    await until(() => sent.length === 3);
    // Se informa solo el clic que hizo la persona; el paso que nunca se mostró no cuenta.
    expect((sent[2] as NextStepRequest).completedSteps).toHaveLength(1);
  });

  it('durante la espera después de un clic, lo que hace la persona sobre el control siguiente cuenta al mostrarlo y «Ya lo hice» no salta pasos', async () => {
    load('horarios.html');
    const mock = mockApi();
    let links: GuideStep[] = [];
    const { api } = recording(mock, {
      options: async (r, s) => {
        const response = await mock.options(r, s);
        links = response.options.filter((o) => o.id.startsWith('go-')).slice(0, 3).map((o) => ({ ...o.steps[0]!, waitFor: 'userInteraction' as const }));
        return { ...response, options: [{ id: 'x', title: 'X', steps: links }] };
      },
      nextStep: async (r) => ({ sessionId: r.sessionId, steps: links, done: false }),
    });
    const page = new FakePage();
    const assistant = new Assistant({ api, session: new ApiSession(), page, onChange: () => {}, settleMs: 0, afterClickMs: 30 });
    const until = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 2000, interval: 5 });
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    assistant.select('x');
    await until(() => assistant.state.phase === 'waitingForUser' && assistant.state.step?.targetElementId !== undefined);
    assistant.interaction(assistant.state.step!.targetElementId!, 'click');
    expect(assistant.settling).toBe(true);
    // «Ya lo hice» de la indicación anterior no cuenta para la que todavía no se mostró.
    assistant.confirmDone();
    expect(assistant.state.step).toEqual(links[1]);
    // La persona ya hizo clic en el control siguiente: se toma en cuenta al mostrarlo.
    const next = resolveSelector(links[1]!.element!, page.html, document, (n) => page.registry!.idOf(n))!;
    assistant.interaction(next, 'click');
    await until(() => assistant.state.step?.instruction === links[2]!.instruction);
    // Solo los clics en el sitio, en pasado (sin la opción elegida).
    expect(assistant.done).toHaveLength(2);
    expect(assistant.done[0]).toMatch(/^Hiciste clic en «/);
  });

  it('si la navegación después del clic no termina ni falla, el paso siguiente se muestra igual', async () => {
    load('horarios.html');
    const mock = mockApi();
    let links: GuideStep[] = [];
    const { api } = recording(mock, {
      options: async (r, s) => {
        const response = await mock.options(r, s);
        links = response.options.filter((o) => o.id.startsWith('go-')).slice(0, 2).map((o) => ({ ...o.steps[0]!, waitFor: 'userInteraction' as const }));
        return { ...response, options: [{ id: 'x', title: 'X', steps: links }] };
      },
      nextStep: async (r) => ({ sessionId: r.sessionId, steps: links, done: false }),
    });
    const page = new FakePage();
    const assistant = new Assistant({ api, session: new ApiSession(), page, onChange: () => {}, settleMs: 0, afterClickMs: 20, navigationWatchdogMs: 40 });
    const until = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 2000, interval: 5 });
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    assistant.select('x');
    await until(() => assistant.state.phase === 'waitingForUser' && assistant.state.step?.targetElementId !== undefined);
    assistant.interaction(assistant.state.step!.targetElementId!, 'click');
    // Una descarga: empieza la navegación y no llega ni la carga ni el fallo.
    assistant.navigationStarted();
    await until(() => !assistant.settling && page.shown.length === 2);
  });

  it('si después del clic la página no carga, el paso siguiente se muestra igual', async () => {
    load('horarios.html');
    const mock = mockApi();
    let links: GuideStep[] = [];
    const { api } = recording(mock, {
      options: async (r, s) => {
        const response = await mock.options(r, s);
        links = response.options.filter((o) => o.id.startsWith('go-')).slice(0, 2).map((o) => ({ ...o.steps[0]!, waitFor: 'userInteraction' as const }));
        return { ...response, options: [{ id: 'x', title: 'X', steps: links }] };
      },
      nextStep: async (r) => ({ sessionId: r.sessionId, steps: links, done: false }),
    });
    const page = new FakePage();
    const assistant = new Assistant({ api, session: new ApiSession(), page, onChange: () => {}, settleMs: 0, afterClickMs: 40 });
    const until = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 2000, interval: 5 });
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    assistant.select('x');
    await until(() => assistant.state.phase === 'waitingForUser' && assistant.state.step?.targetElementId !== undefined);
    assistant.interaction(assistant.state.step!.targetElementId!, 'click');
    assistant.navigationStarted();
    assistant.loadFailed();
    expect(assistant.settling).toBe(false);
    await until(() => page.shown.length === 2);
  });

  it('un pedido que no estaba entre las opciones va a /v1/options y la guía empieza sola con esa tarea', async () => {
    load('buscar.html');
    const { api, sent } = recording(mockApi());
    const { assistant, until, shownStep } = setup(api);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze('cambiar mi dirección', 'cambiar mi dirección');
    await until(shownStep);
    expect((sent[0] as OptionsRequest).request).toBe('cambiar mi dirección');
    expect(sent.map((r) => ('optionId' in r ? 'next-step' : 'options'))).toEqual(['options', 'next-step']);
    expect(assistant.state.option).toBe(assistant.state.options[0]);
    // «Volver un paso» muestra las demás opciones de la página.
    assistant.back();
    expect(assistant.state.phase).toBe('choosing');
  });

  it('toca el botón por la persona solo si lo confirma, la IA lo marcó seguro y no hay riesgo alto', async () => {
    load('horarios.html');
    const mock = mockApi();
    let links: GuideStep[] = [];
    const { api } = recording(mock, {
      options: async (r, s) => {
        const response = await mock.options(r, s);
        const go = response.options.filter((o) => o.id.startsWith('go-'));
        // El simulador marca sus enlaces como seguros: el segundo paso se deja sin marcar.
        const { safeToClick: _, ...unmarked } = go[1]!.steps[0]!;
        links = [{ ...go[0]!.steps[0]!, waitFor: 'userInteraction', safeToClick: true }, { ...unmarked, waitFor: 'userInteraction' }];
        return { ...response, options: [{ id: 'x', title: 'X', steps: links }] };
      },
      nextStep: async (r) => ({ sessionId: r.sessionId, steps: links, done: false }),
    });
    const { assistant, until, page } = setup(api);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    assistant.select('x');
    await until(() => assistant.state.phase === 'waitingForUser' && assistant.state.step?.targetElementId !== undefined);
    expect(assistant.offerClick).toBe(true);

    // Con riesgo alto no se ofrece ni se toca.
    assistant.setRiskHold(true);
    await until(() => !assistant.offerClick);
    expect(await assistant.clickForMe()).toBe('notAllowed');
    assistant.setRiskHold(false);
    assistant.repeat();
    await until(() => assistant.offerClick);

    // La persona confirma: se toca solo el control señalado y el paso avanza como si lo hubiera tocado ella.
    const target = assistant.state.step!.targetElementId!;
    expect(await assistant.clickForMe()).toBe('clicked');
    expect(page.clicked).toEqual([target]);
    assistant.interaction(target, 'click');
    await until(() => assistant.state.step?.instruction === links[1]!.instruction && assistant.state.step?.targetElementId !== undefined);
    // El paso siguiente no está marcado como seguro: lo toca la persona.
    expect(assistant.offerClick).toBe(false);
    expect(await assistant.clickForMe()).toBe('notAllowed');
    expect(page.clicked).toHaveLength(1);
  });

  it('nunca ofrece tocar pagar o comprar, aunque la IA lo haya marcado seguro', async () => {
    load('horarios.html');
    const mock = mockApi();
    let steps: GuideStep[] = [];
    const { api } = recording(mock, {
      options: async (r, s) => {
        const response = await mock.options(r, s);
        const go = response.options.find((o) => o.id.startsWith('go-'))!;
        steps = [{ ...go.steps[0]!, instruction: 'Hacé clic en «Pagar».', waitFor: 'userInteraction', safeToClick: true }];
        return { ...response, options: [{ id: 'x', title: 'X', steps }] };
      },
      nextStep: async (r) => ({ sessionId: r.sessionId, steps, done: false }),
    });
    const { assistant, until } = setup(api);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    assistant.select('x');
    await until(() => assistant.state.phase === 'waitingForUser' && assistant.state.step?.targetElementId !== undefined);
    expect(assistant.offerClick).toBe(false);
    expect(await assistant.clickForMe()).toBe('notAllowed');
  });

  it('un pedido en la página no pisa el objetivo del recorrido: va aparte, como request', async () => {
    load('buscar.html');
    const { api, sent } = recording(mockApi());
    const { assistant, until, shownStep } = setup(api);
    assistant.expectDestination('renovar la cédula');
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    await until(() => assistant.state.phase === 'choosing');
    // Como en app.ts (askOnPage): con objetivo, solo se manda el pedido.
    assistant.analyze(undefined, 'quiero cambiar mi dirección');
    await until(shownStep);
    const asked = sent[1] as OptionsRequest;
    expect(asked).toMatchObject({ goal: 'renovar la cédula', request: 'quiero cambiar mi dirección' });
    expect(assistant.state.goal).toBe('renovar la cédula');
  });

  it('con pasos reales recibidos de /v1/next-step sigue guiando', async () => {
    load('buscar.html');
    const mock = mockApi();
    const { api, sent } = recording(mock, {
      options: async (r, s) => {
        const response = await mock.options(r, s);
        return { ...response, options: [{ id: response.options[0]!.id, title: 'Buscar', steps: [step(null)] }] };
      },
      nextStep: async (r) => {
        const search = (await mock.options({ sessionId: r.sessionId, html: r.html }, new AbortController().signal)).options[0]!;
        return { sessionId: r.sessionId, steps: [search.steps[0]!], done: false };
      },
    });
    const { assistant, until, shownStep } = setup(api);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    assistant.select(assistant.state.options[0]!.id);
    await until(shownStep);
    expect(assistant.state.step!.instruction).toMatch(/Escribí lo que buscás/);
    expect(sent.map((r) => ('optionId' in r ? 'next-step' : 'options'))).toEqual(['options', 'next-step']);
    expect((sent[1] as NextStepRequest).completedSteps).toEqual([]);
  });

  it('lleva «Ya hiciste» en pasado y guarda la evidencia de /v1/next-step (TEMPORAL: campo pendiente del contrato)', async () => {
    load('buscar.html');
    const mock = mockApi();
    const { api } = recording(mock, {
      options: async (r, s) => {
        const response = await mock.options(r, s);
        return { ...response, options: [{ id: response.options[0]!.id, title: 'Buscar', steps: [{ ...step(null), instruction: 'Tocá «Buscar».' }] }] };
      },
      nextStep: async (r) => ({ sessionId: r.sessionId, steps: [], done: true, evidence: 'Tu turno quedó registrado' }),
    });
    const { assistant, until } = setup(api);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    assistant.select(assistant.state.options[0]!.id);
    // Elegir la opción es responderle a Guíame: no suma al contador (R5).
    expect(assistant.done).toEqual([]);
    await until(() => assistant.state.phase === 'completed');
    expect(assistant.evidence).toBe('Tu turno quedó registrado');

    // «Todavía no»: se vuelve a mirar la página y la evidencia anterior no vale.
    assistant.resume();
    expect(assistant.evidence).toBeNull();
    await until(() => assistant.state.phase === 'completed');
    assistant.exit();
    expect(assistant.done).toEqual([]);
  });

  it('envía el metadato de la página depurado', async () => {
    load('horarios.html');
    document.title = 'Horarios - Hola, Marta';
    const { api, sent } = recording(mockApi());
    const { assistant, until } = setup(api);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    expect(findLeaks(sent, ['Marta'])).toEqual([]);
    expect((sent[0] as OptionsRequest).metadata).toEqual({ page: { title: 'Horarios', origin: 'http://127.0.0.1:4321' } });
    document.title = 'Biblioteca - Horarios';
    assistant.analyze();
    await until(() => sent.length === 2 && assistant.state.phase === 'choosing');
    expect((sent[1] as OptionsRequest).metadata).toEqual({ page: { title: 'Biblioteca - Horarios', origin: 'http://127.0.0.1:4321' } });
  });

  it('envía como goal lo que la persona pide en la página y nunca un objetivo vacío', async () => {
    load('horarios.html');
    const { api, sent } = recording(mockApi());
    const { assistant, until } = setup(api);
    assistant.expectDestination('');
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    await until(() => assistant.state.phase === 'choosing');
    expect(sent[0]).not.toHaveProperty('goal');

    // «¿No está lo que buscás?» → askOnPage → analyze(goal).
    assistant.analyze('quiero iniciar sesion');
    await until(() => sent.length === 2 && assistant.state.phase === 'choosing');
    expect((sent[1] as OptionsRequest).goal).toBe('quiero iniciar sesion');
    expect(OptionsRequest.safeParse(sent[1]).success).toBe(true);

    // Reintentar sin texto nuevo conserva el pedido.
    assistant.analyze();
    await until(() => sent.length === 3 && assistant.state.phase === 'choosing');
    expect((sent[2] as OptionsRequest).goal).toBe('quiero iniciar sesion');
  });

  it('descarta respuestas tardías de una navegación anterior', async () => {
    load('horarios.html');
    const api = mockApi(40);
    const spy = vi.spyOn(api, 'options');
    const { assistant, until } = setup(api);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze('horarios');
    await until(() => spy.mock.calls.length === 1);

    assistant.navigationStarted();
    load('buscar.html');
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    await until(() => assistant.state.phase === 'choosing');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(assistant.state.options.some((o) => o.id.startsWith('search-'))).toBe(true);
  });

  it('un selector que no encuentra nada no señala la página y termina en error', async () => {
    load('horarios.html');
    const mock = mockApi();
    const { api } = recording(mock, {
      options: async (r, s) => ({ ...(await mock.options(r, s)), options: [{ id: 'x', title: 'X', steps: [step('#el-9999')] }] }),
      nextStep: async (r) => ({ sessionId: r.sessionId, steps: [step('#el-9999')], done: false }),
    });
    const { assistant, until, page } = setup(api);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    assistant.select('x');
    await until(() => assistant.state.phase === 'error');
    expect(page.shown).toEqual([]);
  });

  it('si la sesión venció al pedir opciones, empieza otra', async () => {
    load('buscar.html');
    const session = new ApiSession();
    session.begin().commit('s-vieja');
    const { api, sent } = recording(mockApi());
    const { assistant, until } = setup(api, session);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    expect(sent.map((r) => r.sessionId)).toEqual(['s-vieja', undefined]);
    expect(session.id).toMatch(/^s-/);
    expect(session.id).not.toBe('s-vieja');
  });

  it('next-step usa la sesión de sus opciones aunque la compartida cambie en el medio', async () => {
    load('horarios.html');
    const mock = mockApi();
    const session = new ApiSession();
    let calls = 0;
    const { api, sent } = recording(mock, {
      options: async (r, s) => ({ ...(await mock.options(r, s)), options: [{ id: 'x', title: 'X', steps: [step('#el-1'), step(null)] }] }),
      nextStep: async (r) => (++calls === 1 ? { sessionId: r.sessionId, steps: [step('#el-1', 'userConfirmation')], done: false } : { sessionId: r.sessionId, steps: [], done: true }),
    });
    const { assistant, until, shownStep } = setup(api, session);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    const guideSession = session.id;
    // Otra solicitud (por ejemplo, el chat) reinicia la sesión compartida.
    session.reset();
    session.begin().commit('s-otra');
    assistant.select('x');
    await until(shownStep);
    assistant.confirmDone();
    await until(() => assistant.state.phase === 'completed');
    expect((sent[1] as NextStepRequest).sessionId).toBe(guideSession);
    expect((sent[2] as NextStepRequest).sessionId).toBe(guideSession);
    expect(session.id).toBe('s-otra');
  });

  it('next-step guarda la sesión que devuelve el backend para la llamada siguiente', async () => {
    load('horarios.html');
    const mock = mockApi();
    const session = new ApiSession();
    let calls = 0;
    const { api, sent } = recording(mock, {
      options: async (r, s) => ({ ...(await mock.options(r, s)), options: [{ id: 'x', title: 'X', steps: [step(null)] }] }),
      nextStep: async (r) =>
        ++calls === 1 ? { sessionId: 's-renovada', steps: [step(null)], done: false } : { sessionId: r.sessionId, steps: [], done: true },
    });
    const { assistant, until } = setup(api, session);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    assistant.select('x');
    await until(() => assistant.state.phase === 'waitingForUser');
    assistant.confirmDone();
    await until(() => assistant.state.phase === 'completed');
    expect((sent[2] as NextStepRequest).sessionId).toBe('s-renovada');
    expect(session.id).toBe('s-renovada');
  });

  it('si la sesión venció a mitad de la guía, vuelve a analizar la página', async () => {
    load('horarios.html');
    const mock = mockApi();
    const { api } = recording(mock, {
      options: async (r, s) => ({ ...(await mock.options(r, s)), options: [{ id: 'x', title: 'X', steps: [step(null)] }] }),
      nextStep: async () => {
        throw new ApiFailure('SESSION_NOT_FOUND', false);
      },
    });
    const spy = vi.spyOn(api, 'options');
    const { assistant, until } = setup(api);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    assistant.select('x');
    await until(() => spy.mock.calls.length === 2 && assistant.state.phase === 'choosing');
  });

  it('un fallo del backend deja la página usable y permite reintentar', async () => {
    load('horarios.html');
    const mock = mockApi();
    let fail = true;
    const { api } = recording(mock, {
      options: async (r, s) => {
        if (fail) throw new ApiFailure('NETWORK', false);
        return mock.options(r, s);
      },
    });
    const { assistant, until } = setup(api);
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'error');
    expect(assistant.state.message).toMatch(/intentá de nuevo/i);
    fail = false;
    assistant.retry();
    await until(() => assistant.state.phase === 'choosing');
  });

  it('con la ayuda desactivada en el sitio no analiza la página', async () => {
    load('horarios.html');
    const api = mockApi();
    const spy = vi.spyOn(api, 'options');
    const { assistant } = setup(api);
    assistant.expectDestination('horarios');
    assistant.navigated({ sameDocument: false, aiEnabled: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(assistant.state.phase).toBe('idle');
    expect(spy).not.toHaveBeenCalled();
  });

  it('con riesgo alto pausa las indicaciones que piden datos y las retoma al levantarse', async () => {
    load('formulario.html');
    const { assistant, until, page, shownStep } = setup();
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    const form = assistant.state.options.find((o) => o.id.startsWith('form-'))!;

    assistant.setRiskHold(true);
    assistant.select(form.id);
    await until(() => assistant.paused);
    expect(assistant.state.phase).toBe('waitingForUser');
    expect(page.shown).toHaveLength(0);
    // Mientras está pausada no avanza ni por interacción ni por «Ya lo hice».
    assistant.confirmDone();
    expect(assistant.state.stepCount).toBe(1);

    assistant.setRiskHold(false);
    await until(() => shownStep());
    expect(assistant.paused).toBe(false);
    expect(page.shown).toHaveLength(1);
  });

  it('la pausa por riesgo gana sobre un señalamiento que todavía estaba en curso', async () => {
    load('formulario.html');
    const { assistant, until, page } = setup();
    // El primer señalamiento queda esperando hasta que lo liberemos.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const show = page.show.bind(page);
    page.show = async (navigationId: string, selector: string) => {
      await gate;
      return show(navigationId, selector);
    };
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    const form = assistant.state.options.find((o) => o.id.startsWith('form-'))!;
    assistant.select(form.id);
    await until(() => assistant.state.phase === 'waitingForUser');

    assistant.setRiskHold(true);
    expect(assistant.paused).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(assistant.paused).toBe(true);
    expect(assistant.targetVisible).toBeNull();
    expect(assistant.target).toBeNull();
    expect(assistant.state.step?.targetElementId).toBeUndefined();
  });

  it('con riesgo alto sigue guiando la navegación', async () => {
    load('horarios.html');
    const { assistant, until, shownStep } = setup();
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    assistant.analyze();
    await until(() => assistant.state.phase === 'choosing');
    const link = assistant.state.options.find((o) => o.id.startsWith('go-'))!;
    assistant.setRiskHold(true);
    assistant.select(link.id);
    await until(() => shownStep());
    expect(assistant.paused).toBe(false);
  });
});

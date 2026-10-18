// @vitest-environment happy-dom
/**
 * Recorrido del cliente completo (extractor real + HTML sintético + máquina de
 * estados + orquestador) contra el backend simulado y páginas de prueba.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuideStep, NextStepRequest, OptionsRequest } from '@hackaton/contracts';
import { extractSnapshot, resolveSelector, snapshotToHtml, type ElementRegistry } from '@asistente/page-analyzer';
import { findLeaks } from '@asistente/privacy';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure, ApiSession, type ApiClient } from './api/client';
import { MockApiClient } from './api/mock';
import { Assistant, type PagePort } from './assistant';

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
    return { result: 'shown' as const, elementId };
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
  const assistant = new Assistant({ api, session, page, onChange: () => {}, settleMs: 0 });
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
  it('guía un formulario con la sesión del chat, termina con /v1/next-step y no transmite valores', async () => {
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

    assistant.select(form!.id);
    const typed = ['Marta Gómez', '30123456'];
    for (const value of typed) {
      await until(() => shownStep() && target().localName === 'input');
      const input = target() as HTMLInputElement;
      input.value = value;
      assistant.interaction(assistant.state.step!.targetElementId!);
    }
    await until(() => shownStep() && target().localName === 'select');
    assistant.interaction(assistant.state.step!.targetElementId!);

    await until(() => shownStep() && target().localName === 'button');
    expect(assistant.state.step!.waitFor).toBe('navigation');
    // Un clic no alcanza cuando se espera una navegación.
    assistant.interaction(assistant.state.step!.targetElementId!);
    expect(assistant.state.phase).toBe('waitingForUser');

    assistant.navigationStarted();
    load('confirmacion.html');
    assistant.navigated({ sameDocument: false, aiEnabled: true });
    await until(() => assistant.state.phase === 'completed');

    expect(page.shown.length).toBe(4);
    const [options, next] = rec.sent as [OptionsRequest, NextStepRequest];
    expect(rec.sent).toHaveLength(2);
    expect(options.sessionId).toBe(session.id);
    expect(next).toMatchObject({ sessionId: session.id, optionId: form!.id, expectedStep: { element: null } });
    expect(next.completedSteps).toHaveLength(4);
    expect(findLeaks(rec.sent, [...typed, 'Marta', '/formulario', 'nombre=', '127.0.0.1'])).toEqual([]);
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
    expect(assistant.done).toEqual(['Elegiste «Buscar»']);
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
    expect((sent[0] as OptionsRequest).metadata).toEqual({ page: { title: 'Horarios' } });
    document.title = 'Biblioteca - Horarios';
    assistant.analyze();
    await until(() => sent.length === 2 && assistant.state.phase === 'choosing');
    expect((sent[1] as OptionsRequest).metadata).toEqual({ page: { title: 'Biblioteca - Horarios' } });
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
    const { api, sent } = recording(mock, {
      options: async (r, s) => ({ ...(await mock.options(r, s)), options: [{ id: 'x', title: 'X', steps: [step('#el-1'), step(null)] }] }),
      nextStep: async (r) => ({ sessionId: r.sessionId, steps: [], done: true }),
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

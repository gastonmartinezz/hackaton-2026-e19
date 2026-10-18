import { describe, expect, it } from 'vitest';
import type { StructuredModel, StructuredRequest } from '../src/modules/ai/model.js';
import { defaultMockHandlers } from '../src/modules/ai/mock-model.js';
import { SYSTEM_PROMPTS } from '../src/modules/ai/prompts.js';
import { toGuideSteps, verifiedEvidence } from '../src/modules/ai/steps.js';
import { NextStepService } from '../src/modules/next-step/next-step.service.js';
import { OptionsService } from '../src/modules/options/options.service.js';
import { ProcedureResearcher } from '../src/modules/procedure/procedure.service.js';
import { SessionStore } from '../src/modules/sessions/session-store.js';

const OWNER = 'token';
const step = { element: '#el-1', instruction: 'Hacé clic en «Agenda».', presentation: 'highlight', waitFor: 'userInteraction' } as const;

/** Modelo que guarda cada solicitud y responde con los mocks de siempre. */
function capturingModel() {
  const requests: Array<StructuredRequest<any>> = [];
  const model: StructuredModel = {
    async generate(request) {
      requests.push(request);
      return request.schema.parse(defaultMockHandlers[request.task](request.input));
    },
  };
  return { model, requests };
}

function sessionWithOption(sessions: SessionStore) {
  const sessionId = sessions.create(OWNER);
  sessions.append(sessionId, OWNER, { type: 'interpret', response: 'redirect', goal: 'Sacar un turno', reason: 'x', urls: ['https://agenda.ejemplo.gub.uy/'] });
  sessions.append(sessionId, OWNER, { type: 'options', options: [{ id: 'turno', title: 'Sacar un turno', steps: [step] }] });
  return sessionId;
}

describe('NextStepService: paso a paso investigado', () => {
  it('con GUIDE_WEB_SEARCH on usa la búsqueda web y el prompt con búsqueda', async () => {
    const { model, requests } = capturingModel();
    const sessions = new SessionStore(60_000);
    const sessionId = sessionWithOption(sessions);
    await new NextStepService(model, sessions, new ProcedureResearcher(model, { webSearch: true, webSearchMaxUses: 2 })).next(
      { sessionId, optionId: 'turno', expectedStep: step, completedSteps: [], html: '<button id="el-1">Agenda</button>', metadata: { page: { title: 'Agenda' } } },
      OWNER,
    );
    const procedure = requests.find((r) => r.task === 'procedure')!;
    expect(procedure.system).toBe(SYSTEM_PROMPTS.procedureWithSearch);
    expect(procedure.webSearch).toEqual({ maxUses: 2, userLocation: {} });
    expect((procedure.input as { site: unknown }).site).toEqual({ title: 'Agenda', urls: ['https://agenda.ejemplo.gub.uy/'] });
    // Primero se investiga y después se piden los pasos.
    expect(requests.map((r) => r.task)).toEqual(['procedure', 'nextStep']);
    sessions.close();
  });

  it('con GUIDE_WEB_SEARCH off arma el paso a paso sin buscar', async () => {
    const { model, requests } = capturingModel();
    const sessions = new SessionStore(60_000);
    const sessionId = sessionWithOption(sessions);
    await new NextStepService(model, sessions, new ProcedureResearcher(model, { webSearch: false, webSearchMaxUses: 3 })).next(
      { sessionId, optionId: 'turno', expectedStep: step, completedSteps: [], html: '<button id="el-1">Agenda</button>' },
      OWNER,
    );
    const procedure = requests.find((r) => r.task === 'procedure')!;
    expect(procedure.system).toBe(SYSTEM_PROMPTS.procedure);
    expect(procedure.webSearch).toBeUndefined();
    expect(sessions.context(sessionId, OWNER)!.history.filter((e) => e.type === 'procedure')).toHaveLength(1);
    sessions.close();
  });
});

describe('toGuideSteps', () => {
  it('saca field null y el field de los pasos teóricos', () => {
    const field = { question: '¿Cuál es tu correo?', sensitive: false };
    expect(
      toGuideSteps([
        { ...step, field: null },
        { ...step, element: '#el-2', field },
        { ...step, element: null, field },
      ]),
    ).toEqual([step, { ...step, element: '#el-2', field }, { ...step, element: null }]);
  });
});

describe('verifiedEvidence', () => {
  const html = '<main aria-label="Confirmaci&oacute;n"><h2 id="el-1">Turno   confirmado</h2><input id="el-2" aria-label="Número &quot;A-12&quot;"></main>';

  it('acepta el texto visible o una etiqueta, sin distinguir mayúsculas ni espacios', () => {
    expect(verifiedEvidence('turno confirmado', html)).toBe('turno confirmado');
    expect(verifiedEvidence('Número "A-12"', html)).toBe('Número "A-12"');
    expect(verifiedEvidence('  «Turno confirmado»  ', html)).toBe('Turno confirmado');
  });

  it('descarta lo que no está en la página, lo vacío y lo demasiado largo', () => {
    expect(verifiedEvidence('Pago aprobado', html)).toBeNull();
    expect(verifiedEvidence(null, html)).toBeNull();
    expect(verifiedEvidence('«»', html)).toBeNull();
    expect(verifiedEvidence('x'.repeat(201), `<h2>${'x'.repeat(201)}</h2>`)).toBeNull();
  });

  it('no acepta texto que el navegador no muestra: scripts, estilos, comentarios ni elementos ocultos', () => {
    const hidden =
      '<h2 id="el-1">Datos</h2><script>var t = "Pago aprobado";</script><style>.x{content:"Turno confirmado"}</style>' +
      '<!-- Reserva confirmada --><div hidden>Compra realizada</div><p aria-hidden="true">Trámite finalizado</p>';
    for (const quote of ['Pago aprobado', 'Turno confirmado', 'Reserva confirmada', 'Compra realizada', 'Trámite finalizado'])
      expect(verifiedEvidence(quote, hidden)).toBeNull();
    expect(verifiedEvidence('Datos', hidden)).toBe('Datos');
  });

  it('no se rompe con entidades numéricas fuera de rango', () => {
    expect(verifiedEvidence('hola', '<h2>hola &#99999999; &#x41;</h2>')).toBe('hola');
  });

  it('no toma como visible lo que está dentro de las etiquetas (ids)', () => {
    expect(verifiedEvidence('el-1', html)).toBeNull();
  });
});

describe('OptionsService: algo que no estaba entre las opciones', () => {
  it('investiga el pedido, lo devuelve como primera opción y deja el paso a paso para next-step', async () => {
    const { model, requests } = capturingModel();
    const sessions = new SessionStore(60_000);
    const sessionId = sessions.create(OWNER);
    const researcher = new ProcedureResearcher(model, { webSearch: true, webSearchMaxUses: 2 });
    const html = '<nav id="el-1" aria-label="Menú"><a id="el-2" href="#">Trámites</a></nav>';
    const response = await new OptionsService(model, sessions, researcher).options({ sessionId, html, request: 'Cambiar mi dirección' }, OWNER);

    expect(requests.map((r) => r.task)).toEqual(['procedure', 'options']);
    expect(requests[0]!.input).toMatchObject({ request: 'Cambiar mi dirección' });
    expect(requests[0]!.webSearch).toEqual({ maxUses: 2, userLocation: {} });
    expect(requests[1]!.system).toBe(SYSTEM_PROMPTS.optionsForRequest);
    expect(requests[1]!.input).toMatchObject({ request: 'Cambiar mi dirección', procedure: { summary: expect.any(String) } });
    const first = response.options[0]!;
    expect(first.title).toBe('Cambiar mi dirección');

    // Al elegirla, next-step usa el paso a paso ya investigado: no se busca de nuevo.
    requests.length = 0;
    await new NextStepService(model, sessions, researcher).next(
      { sessionId, optionId: first.id, expectedStep: first.steps[0]!, completedSteps: [], html },
      OWNER,
    );
    expect(requests.map((r) => r.task)).toEqual(['nextStep']);
    expect((requests[0]!.input as { procedure: unknown }).procedure).not.toBeNull();
    sessions.close();
  });

  it('sin pedido no investiga nada', async () => {
    const { model, requests } = capturingModel();
    const sessions = new SessionStore(60_000);
    await new OptionsService(model, sessions, new ProcedureResearcher(model)).options({ html: '<button id="el-1">Agenda</button>' }, OWNER);
    expect(requests.map((r) => r.task)).toEqual(['options']);
    expect(requests[0]!.system).toBe(SYSTEM_PROMPTS.options);
    sessions.close();
  });
});

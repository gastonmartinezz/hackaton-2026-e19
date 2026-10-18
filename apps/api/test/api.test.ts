import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultMockHandlers, MockModel } from '../src/modules/ai/mock-model.js';
import type { AiTask } from '../src/modules/ai/model.js';
import type { InterpretOutput } from '../src/modules/ai/schemas.js';
import { auth, html, OTHER_TOKEN, testApp } from './helpers.js';

let app: FastifyInstance;
afterEach(() => app?.close());

const internal = { goal: 'Sacar un turno', reason: 'Es el sitio oficial.' };

const interpretReturning = (output: InterpretOutput) =>
  new MockModel({ ...defaultMockHandlers, interpret: () => output });

/** Mock que registra lo que recibe Claude en cada tarea. */
function recordingModel() {
  const inputs: Record<AiTask, any[]> = { interpret: [], options: [], nextStep: [], siteCheck: [] };
  const record =
    (task: AiTask) =>
    (input: any): unknown => {
      inputs[task].push(input);
      return defaultMockHandlers[task](input);
    };
  const model = new MockModel({
    interpret: record('interpret'),
    options: record('options'),
    nextStep: record('nextStep'),
    siteCheck: record('siteCheck'),
  });
  return { model, inputs };
}

const post = (url: string, payload: object, headers: Record<string, string> = auth) =>
  app.inject({ method: 'POST', url, headers, payload });

describe('infraestructura', () => {
  it('GET /health es público', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', stt: 'off' });
  });

  it('rechaza solicitudes sin token con el formato de error estable', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'POST', url: '/v1/interpret', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED', retryable: false } });
    expect(res.json().error.requestId).toBe(res.headers['x-request-id']);
  });

  it('valida el cuerpo contra el contrato', async () => {
    app = await testApp();
    const res = await post('/v1/interpret', { messages: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('limita la frecuencia por token', async () => {
    app = await testApp({}, { RATE_LIMIT_MAX: '1' });
    const payload = { messages: [{ role: 'user', content: 'Hola' }] };
    const first = await post('/v1/interpret', payload);
    const second = await post('/v1/interpret', payload);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.json().error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });
});

describe('POST /v1/interpret', () => {
  const payload = { messages: [{ role: 'user', content: 'Quiero sacar un turno' }] };

  it.each<[string, InterpretOutput, object]>([
    [
      'redirect',
      { type: 'redirect', message: 'Te llevo.', url: 'https://www.argentina.gob.ar/', options: [], ...internal },
      { type: 'redirect', message: 'Te llevo.', url: 'https://www.argentina.gob.ar/' },
    ],
    [
      'question',
      { type: 'question', message: '¿En qué país?', url: null, options: [], ...internal },
      { type: 'question', message: '¿En qué país?' },
    ],
    [
      'options',
      {
        type: 'options',
        message: 'Encontré estas opciones:',
        url: null,
        options: [
          { title: 'Sitio A', url: 'https://a.example/', reason: 'Oficial' },
          { title: 'Sitio B', url: 'https://b.example/', reason: 'Alternativa' },
        ],
        ...internal,
      },
      {
        type: 'options',
        message: 'Encontré estas opciones:',
        options: [
          { title: 'Sitio A', url: 'https://a.example/', reason: 'Oficial' },
          { title: 'Sitio B', url: 'https://b.example/', reason: 'Alternativa' },
        ],
      },
    ],
  ])('devuelve %s con sessionId y sin los campos internos', async (_, output, expected) => {
    app = await testApp({ model: interpretReturning(output) });
    const res = await post('/v1/interpret', payload);
    expect(res.statusCode).toBe(200);
    const { sessionId, ...body } = res.json();
    expect(sessionId).toMatch(/^s-/);
    expect(body).toEqual(expected);
  });

  it('mantiene la misma sesión durante el chat', async () => {
    app = await testApp();
    const first = await post('/v1/interpret', payload);
    const { sessionId } = first.json();
    const second = await post('/v1/interpret', {
      sessionId,
      messages: [...payload.messages, { role: 'assistant', content: first.json().message }, { role: 'user', content: 'En Argentina' }],
    });
    expect(second.json()).toMatchObject({ sessionId, type: 'redirect' });
  });

  it('pasa a Claude los datos de la persona', async () => {
    const { model, inputs } = recordingModel();
    app = await testApp({ model });
    const user = { location: { country: 'AR', region: 'Córdoba', city: 'Villa María' }, ageRange: '65-74', language: 'es-AR' };
    expect((await post('/v1/interpret', { ...payload, user })).statusCode).toBe(200);
    expect(inputs.interpret[0].user).toEqual(user);

    await post('/v1/interpret', payload);
    expect(inputs.interpret[1].user).toBeNull();
  });

  it('rechaza datos de la persona fuera del contrato', async () => {
    app = await testApp();
    const res = await post('/v1/interpret', { ...payload, user: { location: { street: 'Mitre 123' } } });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza una URL que no es http(s)', async () => {
    app = await testApp({
      model: interpretReturning({ type: 'redirect', message: 'Te llevo.', url: 'javascript:alert(1)', options: [], ...internal }),
    });
    const res = await post('/v1/interpret', payload);
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('AI_INVALID_RESPONSE');
  });

  it('devuelve SESSION_NOT_FOUND con una sesión inexistente', async () => {
    app = await testApp();
    const res = await post('/v1/interpret', { sessionId: 's-no-existe', ...payload });
    expect(res.json().error.code).toBe('SESSION_NOT_FOUND');
  });
});

describe('POST /v1/options', () => {
  it('sin sessionId crea una sesión y devuelve opciones con sus pasos', async () => {
    app = await testApp();
    const res = await post('/v1/options', { html });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toMatch(/^s-/);
    expect(body.options[0].steps[0]).toMatchObject({ element: '#search', presentation: 'highlight' });
    expect(body.options[0].steps[1].element).toBeNull();
  });

  it('continúa la sesión de interpret y le pasa a Claude el recorrido y el metadato', async () => {
    const { model, inputs } = recordingModel();
    app = await testApp({ model });
    const messages = [
      { role: 'user', content: 'Quiero sacar un turno' },
      { role: 'assistant', content: '¿Dónde?' },
      { role: 'user', content: 'En el hospital' },
    ];
    const { sessionId } = (await post('/v1/interpret', { messages })).json();

    const res = await post('/v1/options', { sessionId, html, metadata: { page: { title: 'Hospital - Turnos', language: 'es' } } });

    expect(res.json().sessionId).toBe(sessionId);
    const { context } = inputs.options[0];
    expect(context.chat).toEqual(messages);
    expect(context.metadata).toEqual({ page: { title: 'Hospital - Turnos', language: 'es' } });
    expect(context.history[0]).toMatchObject({
      type: 'interpret',
      response: 'redirect',
      goal: 'Objetivo simulado',
      reason: 'Respuesta simulada.',
      urls: ['https://www.example.com/'],
    });
  });

  it('acumula el metadato: lo nuevo pisa lo anterior', async () => {
    const { model, inputs } = recordingModel();
    app = await testApp({ model });
    const { sessionId } = (await post('/v1/options', { html, metadata: { page: { title: 'Inicio', language: 'es' } } })).json();
    await post('/v1/options', { sessionId, html, metadata: { page: { title: 'Turnos' } } });
    expect(inputs.options[1].context.metadata).toEqual({ page: { title: 'Turnos', language: 'es' } });
  });

  it('devuelve SESSION_NOT_FOUND con una sesión inexistente', async () => {
    app = await testApp();
    const res = await post('/v1/options', { sessionId: 's-no-existe', html });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('SESSION_NOT_FOUND');
  });

  it('no permite usar la sesión de otro token', async () => {
    app = await testApp();
    const { sessionId } = (await post('/v1/options', { html })).json();
    const res = await post('/v1/options', { sessionId, html }, { authorization: `Bearer ${OTHER_TOKEN}` });
    expect(res.json().error.code).toBe('SESSION_NOT_FOUND');
  });

  it('rechaza una opción sin pasos', async () => {
    const model = new MockModel({
      ...defaultMockHandlers,
      options: () => ({ options: [{ id: 'x', title: 'Sin pasos', steps: [] }] }),
    });
    app = await testApp({ model });
    const res = await post('/v1/options', { html });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('AI_INVALID_RESPONSE');
  });
});

describe('POST /v1/next-step', () => {
  const startSession = async () => {
    const body = (await post('/v1/options', { html })).json();
    return { sessionId: body.sessionId as string, option: body.options[0] };
  };

  it('resuelve el paso teórico con el HTML nuevo', async () => {
    app = await testApp();
    const { sessionId, option } = await startSession();
    const res = await post('/v1/next-step', {
      sessionId,
      optionId: option.id,
      expectedStep: option.steps[1],
      completedSteps: [option.steps[0]],
      html: '<select id="el-9"></select>',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sessionId, done: false, steps: [{ element: '#el-9' }] });
  });

  it('informa done cuando la tarea terminó', async () => {
    app = await testApp();
    const { sessionId, option } = await startSession();
    const res = await post('/v1/next-step', {
      sessionId,
      optionId: option.id,
      expectedStep: option.steps[1],
      completedSteps: [],
      html: '<p>Turno confirmado</p>',
    });
    expect(res.json()).toEqual({ sessionId, steps: [], done: true });
  });

  it('le pasa a Claude la opción, el paso esperado, los pasos completados y el recorrido', async () => {
    const { model, inputs } = recordingModel();
    app = await testApp({ model });
    const { sessionId, option } = await startSession();
    await post('/v1/next-step', {
      sessionId,
      optionId: option.id,
      expectedStep: option.steps[1],
      completedSteps: [option.steps[0]],
      html,
      metadata: { page: { title: 'Especialidades' } },
    });

    const input = inputs.nextStep[0];
    expect(input).toMatchObject({ option, expectedStep: option.steps[1], completedSteps: [option.steps[0]] });
    expect(input.context.history).toEqual([{ type: 'options', options: [option] }]);
    expect(input.context.metadata).toEqual({ page: { title: 'Especialidades' } });
  });

  it('guarda los pasos completados en la sesión', async () => {
    const { model, inputs } = recordingModel();
    app = await testApp({ model });
    const { sessionId, option } = await startSession();
    const request = { sessionId, optionId: option.id, expectedStep: option.steps[1], html };
    await post('/v1/next-step', { ...request, completedSteps: [option.steps[0]] });
    await post('/v1/next-step', { ...request, completedSteps: [] });

    expect(inputs.nextStep[1].context.history[1]).toMatchObject({ type: 'nextStep', completedSteps: [option.steps[0]] });
  });

  it('rechaza un optionId que no está en la sesión', async () => {
    app = await testApp();
    const { sessionId, option } = await startSession();
    const res = await post('/v1/next-step', {
      sessionId,
      optionId: 'inventada',
      expectedStep: option.steps[1],
      completedSteps: [],
      html,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('exige una sesión existente', async () => {
    app = await testApp();
    const res = await post('/v1/next-step', {
      sessionId: 's-no-existe',
      optionId: 'start',
      expectedStep: { element: null, instruction: 'x', presentation: 'highlight', waitFor: 'userInteraction' },
      completedSteps: [],
      html,
    });
    expect(res.json().error.code).toBe('SESSION_NOT_FOUND');
  });
});

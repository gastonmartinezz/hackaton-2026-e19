import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultMockHandlers, MockModel } from '../src/modules/ai/mock-model.js';
import type { InterpretOutput } from '../src/modules/ai/schemas.js';
import { auth, html, OTHER_TOKEN, testApp } from './helpers.js';

let app: FastifyInstance;
afterEach(() => app?.close());

const interpretReturning = (output: InterpretOutput) =>
  new MockModel({ ...defaultMockHandlers, interpret: () => output });

describe('infraestructura', () => {
  it('GET /health es público', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
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
    const res = await app.inject({ method: 'POST', url: '/v1/interpret', headers: auth, payload: { messages: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('limita la frecuencia por token', async () => {
    app = await testApp({}, { RATE_LIMIT_MAX: '1' });
    const payload = { messages: [{ role: 'user', content: 'Hola' }] };
    const first = await app.inject({ method: 'POST', url: '/v1/interpret', headers: auth, payload });
    const second = await app.inject({ method: 'POST', url: '/v1/interpret', headers: auth, payload });
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
      { type: 'redirect', message: 'Te llevo.', url: 'https://www.argentina.gob.ar/', options: [] },
      { type: 'redirect', message: 'Te llevo.', url: 'https://www.argentina.gob.ar/' },
    ],
    [
      'question',
      { type: 'question', message: '¿En qué país?', url: null, options: [] },
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
  ])('devuelve %s con la estructura acordada', async (_, output, expected) => {
    app = await testApp({ model: interpretReturning(output) });
    const res = await app.inject({ method: 'POST', url: '/v1/interpret', headers: auth, payload });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expected);
  });

  it('rechaza una URL que no es http(s)', async () => {
    app = await testApp({
      model: interpretReturning({ type: 'redirect', message: 'Te llevo.', url: 'javascript:alert(1)', options: [] }),
    });
    const res = await app.inject({ method: 'POST', url: '/v1/interpret', headers: auth, payload });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('AI_INVALID_RESPONSE');
  });
});

describe('POST /v1/options', () => {
  it('crea una sesión en la primera llamada', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'POST', url: '/v1/options', headers: auth, payload: { html } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toMatch(/^s-/);
    expect(body.options[0]).toMatchObject({ initialElement: '#search' });
    expect(body.guide.step).toMatchObject({ element: '#search', presentation: 'highlight', waitFor: 'userInteraction' });
  });

  it('envía a Claude el historial de la sesión en las siguientes llamadas', async () => {
    const inputs: any[] = [];
    const model = new MockModel({
      ...defaultMockHandlers,
      options: (input) => {
        inputs.push(input);
        return defaultMockHandlers.options(input);
      },
    });
    app = await testApp({ model });

    const first = await app.inject({ method: 'POST', url: '/v1/options', headers: auth, payload: { html } });
    const { sessionId } = first.json();
    const second = await app.inject({
      method: 'POST',
      url: '/v1/options',
      headers: auth,
      payload: { sessionId, goal: 'start', html },
    });

    expect(second.json().sessionId).toBe(sessionId);
    expect(inputs[0].history).toEqual([]);
    expect(inputs[1].history).toEqual([{ goal: undefined, options: first.json().options, guide: first.json().guide }]);
    expect(inputs[1].goal).toBe('start');
  });

  it('devuelve SESSION_NOT_FOUND con una sesión inexistente', async () => {
    app = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/options',
      headers: auth,
      payload: { sessionId: 's-no-existe', html },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('SESSION_NOT_FOUND');
  });

  it('no permite usar la sesión de otro token', async () => {
    app = await testApp();
    const first = await app.inject({ method: 'POST', url: '/v1/options', headers: auth, payload: { html } });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/options',
      headers: { authorization: `Bearer ${OTHER_TOKEN}` },
      payload: { sessionId: first.json().sessionId, html },
    });
    expect(res.json().error.code).toBe('SESSION_NOT_FOUND');
  });

  it('devuelve guide null si no hay paso posible', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'POST', url: '/v1/options', headers: auth, payload: { html: '<p>Hola</p>' } });
    expect(res.json()).toMatchObject({ options: [], guide: null });
  });
});

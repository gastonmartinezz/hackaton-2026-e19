import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { defaultMockHandlers, MockModel } from '../src/modules/ai/mock-model.js';
import type { InterpretOutput } from '../src/modules/ai/schemas.js';
import { InterpretService } from '../src/modules/interpret/interpret.service.js';
import { NO_VALID_SITE_QUESTION, UrlGuard } from '../src/modules/interpret/url-guard.js';
import { SessionStore } from '../src/modules/sessions/session-store.js';
import { auth, fakeVerifier, recordingLogger, testApp } from './helpers.js';

let app: FastifyInstance;
afterEach(() => app?.close());

const internal = { goal: 'Agendarse para la cédula', reason: 'Trámite de la DNIC.' };
const redirect = (url: string): InterpretOutput => ({ type: 'redirect', message: 'Te llevo.', url, options: [], ...internal });
const options = (...urls: string[]): InterpretOutput => ({
  type: 'options',
  message: 'Encontré estas opciones:',
  url: null,
  options: urls.map((url, i) => ({ title: `Sitio ${i + 1}`, url, reason: 'Oficial' })),
  ...internal,
});

/** Mock de Claude que responde en orden y guarda lo que recibe. */
function scripted(...outputs: InterpretOutput[]) {
  const inputs: any[] = [];
  const model = new MockModel({
    ...defaultMockHandlers,
    interpret: (input: unknown) => {
      inputs.push(input);
      return outputs[Math.min(inputs.length - 1, outputs.length - 1)];
    },
  });
  return { model, inputs };
}

const payload = {
  messages: [{ role: 'user', content: 'Quiero agendarme para renovar la cédula' }],
  user: { location: { country: 'UY', city: 'Montevideo' } },
};
const post = () => app.inject({ method: 'POST', url: '/v1/interpret', headers: auth, payload });

describe('POST /v1/interpret: verificación de URLs', () => {
  it('devuelve la URL tal cual si existe, sin reintentar', async () => {
    const { model, inputs } = scripted(redirect('https://www.gub.uy/tramites/cedula-identidad'));
    app = await testApp({ model });
    const res = await post();
    expect(res.json()).toMatchObject({ type: 'redirect', url: 'https://www.gub.uy/tramites/cedula-identidad' });
    expect(inputs).toHaveLength(1);
  });

  it('ante un 404 reintenta con Claude diciéndole qué URL falló y por qué', async () => {
    const { model, inputs } = scripted(redirect('https://www.bps.gub.uy/agendarse'), redirect('https://www.bps.gub.uy/'));
    const urlVerifier = fakeVerifier({ sites: { 'https://www.bps.gub.uy/agendarse': { status: 404 } } });
    app = await testApp({ model, urlVerifier });

    const res = await post();
    expect(res.json()).toMatchObject({ type: 'redirect', url: 'https://www.bps.gub.uy/' });
    expect(inputs).toHaveLength(2);
    expect(inputs[1].failedUrls).toEqual([{ url: 'https://www.bps.gub.uy/agendarse', reason: 'la página no existe (404)' }]);
    // El reintento lleva lo mismo que la primera llamada más failedUrls.
    expect(inputs[1].messages).toEqual(inputs[0].messages);
  });

  it('si el reintento también falla, usa la raíz del dominio si existe', async () => {
    const { model } = scripted(redirect('https://www.bps.gub.uy/agendarse'), redirect('https://www.bps.gub.uy/agenda-web'));
    const urlVerifier = fakeVerifier({
      sites: {
        'https://www.bps.gub.uy/agendarse': { status: 404 },
        'https://www.bps.gub.uy/agenda-web': { status: 404 },
      },
    });
    app = await testApp({ model, urlVerifier });
    expect((await post()).json()).toMatchObject({ type: 'redirect', url: 'https://www.bps.gub.uy/' });
  });

  it.each(['AI_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED', 'AI_INVALID_RESPONSE'] as const)(
    'si el reintento falla con %s, repara la primera respuesta (nunca la devuelve sin verificar)',
    async (code) => {
      let calls = 0;
      const model = new MockModel({
        ...defaultMockHandlers,
        interpret: () => {
          calls++;
          if (calls === 1) return redirect('https://www.bps.gub.uy/agendarse');
          throw new AppError(code, 'falla del reintento');
        },
      });
      const urlVerifier = fakeVerifier({ sites: { 'https://www.bps.gub.uy/agendarse': { status: 404 } } });
      const sessions = new SessionStore(60_000);
      const { logger, entries } = recordingLogger();
      const result = await new InterpretService(model, sessions, new UrlGuard(urlVerifier)).interpret(payload as never, 'owner', logger);
      sessions.close();

      expect(result).toMatchObject({ type: 'redirect', url: 'https://www.bps.gub.uy/' });
      expect(calls).toBe(2);
      // El reintento no se usó: retried queda en false.
      expect(entries.at(-1)?.[0]).toMatchObject({ retried: false, rootFallbacks: 1 });
    },
  );

  it('si el reintento falla de forma recuperable y la raíz tampoco existe, pasa a pregunta', async () => {
    let calls = 0;
    const model = new MockModel({
      ...defaultMockHandlers,
      interpret: () => {
        calls++;
        if (calls === 1) return redirect('https://agenda.bps.gub.uy/');
        throw new AppError('TIMEOUT', 'falla del reintento');
      },
    });
    const urlVerifier = fakeVerifier({ dns: { 'agenda.bps.gub.uy': [] } });
    app = await testApp({ model, urlVerifier });
    expect((await post()).json()).toMatchObject({ type: 'question', message: NO_VALID_SITE_QUESTION });
  });

  it.each([
    ['INTERNAL (configuración de Anthropic)', 'INTERNAL', 500],
    ['AI_REFUSED', 'AI_REFUSED', 422],
  ] as const)('si el reintento falla con %s, el error se propaga', async (_, code, status) => {
    let calls = 0;
    const model = new MockModel({
      ...defaultMockHandlers,
      interpret: () => {
        calls++;
        if (calls === 1) return redirect('https://www.bps.gub.uy/agendarse');
        throw new AppError(code, 'falla del reintento');
      },
    });
    const urlVerifier = fakeVerifier({ sites: { 'https://www.bps.gub.uy/agendarse': { status: 404 } } });
    app = await testApp({ model, urlVerifier });
    const res = await post();
    expect(res.statusCode).toBe(status);
    expect(res.json().error.code).toBe(code);
  });

  it('si tampoco existe la raíz (dominio inventado), lo convierte en una pregunta sin URL', async () => {
    const { model } = scripted(redirect('https://agenda.bps.gub.uy/'));
    const urlVerifier = fakeVerifier({ dns: { 'agenda.bps.gub.uy': [] } });
    app = await testApp({ model, urlVerifier });

    const body = (await post()).json();
    expect(body).toEqual({ sessionId: expect.any(String), type: 'question', message: NO_VALID_SITE_QUESTION });
  });

  it('en options saca las inválidas, cambia por la raíz cuando sirve y no repite sitios', async () => {
    const { model } = scripted(
      options('https://www.ute.com.uy/clientes/pagar', 'https://www.ute.com.uy/', 'https://inventado.ejemplo.uy/x', 'https://www.ose.com.uy/'),
    );
    const urlVerifier = fakeVerifier({
      sites: { 'https://www.ute.com.uy/clientes/pagar': { status: 404 } },
      dns: { 'inventado.ejemplo.uy': [] },
    });
    app = await testApp({ model, urlVerifier });

    const body = (await post()).json();
    expect(body.type).toBe('options');
    expect(body.options.map((option: { url: string }) => option.url)).toEqual(['https://www.ute.com.uy/', 'https://www.ose.com.uy/']);
  });

  it('si en options queda un solo sitio válido, redirige a ese', async () => {
    const { model } = scripted(options('https://www.antel.com.uy/', 'https://inventado.ejemplo.uy/'));
    const urlVerifier = fakeVerifier({ dns: { 'inventado.ejemplo.uy': [] } });
    app = await testApp({ model, urlVerifier });
    expect((await post()).json()).toMatchObject({ type: 'redirect', url: 'https://www.antel.com.uy/', message: 'Te llevo a Sitio 1.' });
  });

  it('una pregunta no pasa por el verificador', async () => {
    const { model } = scripted({ type: 'question', message: '¿Es la primera vez?', url: null, options: [], ...internal });
    const urlVerifier = fakeVerifier();
    app = await testApp({ model, urlVerifier });
    expect((await post()).json()).toMatchObject({ type: 'question' });
    expect(urlVerifier.requests).toEqual([]);
  });

  it('guarda en la sesión solo las URLs verificadas', async () => {
    const { model } = scripted(redirect('https://agenda.bps.gub.uy/'), redirect('https://www.bps.gub.uy/'));
    const urlVerifier = fakeVerifier({ dns: { 'agenda.bps.gub.uy': [] } });
    const sessions = new SessionStore(60_000);
    const service = new InterpretService(model, sessions, new UrlGuard(urlVerifier));
    const result = await service.interpret(payload as never, 'owner');
    const history = sessions.context(result.sessionId, 'owner')!.history;
    expect(history.at(-1)).toMatchObject({ type: 'interpret', urls: ['https://www.bps.gub.uy/'] });
    sessions.close();
  });
});

describe('InterpretService: logs de la verificación', () => {
  it('registra números, motivos y dominios; nunca rutas, parámetros ni el chat', async () => {
    const { model } = scripted(
      redirect('https://www.bps.gub.uy/agendarse?cedula=12345678'),
      redirect('https://www.bps.gub.uy/agendarse?cedula=12345678'),
    );
    const urlVerifier = fakeVerifier({ sites: { 'https://www.bps.gub.uy/agendarse?cedula=12345678': { status: 404 } } });
    const sessions = new SessionStore(60_000);
    const { logger, entries } = recordingLogger();
    await new InterpretService(model, sessions, new UrlGuard(urlVerifier)).interpret(payload as never, 'owner', logger);
    sessions.close();

    const logged = JSON.stringify(entries);
    expect(logged).not.toContain('agendarse');
    expect(logged).not.toContain('12345678');
    expect(logged).not.toContain('renovar la cédula');
    expect(entries.at(-1)).toEqual([
      {
        task: 'interpret',
        type: 'redirect',
        firstPassChecked: 1,
        firstPassValid: 0,
        checked: 2,
        valid: 0,
        invalid: { http_status: 2 },
        invalidDomains: ['www.bps.gub.uy', 'www.bps.gub.uy'],
        retried: true,
        rootFallbacks: 1,
        dropped: 0,
        converted: 'none',
      },
      'interpret urls',
    ]);
  });
});

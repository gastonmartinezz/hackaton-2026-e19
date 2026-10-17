import { TRANSCRIBE_MAX_BYTES } from '@hackaton/contracts';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { MOCK_TRANSCRIPTION, MockTranscriptionProvider } from '../src/modules/transcribe/mock-provider.js';
import type { TranscriptionProvider } from '../src/modules/transcribe/provider.js';
import { cleanTranscript, TranscribeService } from '../src/modules/transcribe/transcribe.service.js';
import { auth, testApp } from './helpers.js';
import { buildWav } from './wav-helpers.js';

let app: FastifyInstance;
afterEach(() => app?.close());

const postWav = (payload: Buffer, headers: Record<string, string> = { ...auth, 'content-type': 'audio/wav' }) =>
  app.inject({ method: 'POST', url: '/v1/transcribe', headers, payload });

describe('POST /v1/transcribe', () => {
  it('devuelve el texto con el proveedor mock', async () => {
    app = await testApp({}, { STT_PROVIDER: 'mock' });
    const res = await postWav(buildWav({ seconds: 2 }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: MOCK_TRANSCRIPTION });
  });

  it('responde 503 no reintentable con STT_PROVIDER=off (el valor por defecto)', async () => {
    app = await testApp();
    const res = await postWav(buildWav());
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatchObject({ code: 'AI_UNAVAILABLE', retryable: false });
  });

  it('responde 503 reintentable mientras el modelo carga', async () => {
    const loading: TranscriptionProvider = { status: 'loading', transcribe: async () => 'nunca' };
    app = await testApp({ transcriber: loading });
    const res = await postWav(buildWav());
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatchObject({ code: 'AI_UNAVAILABLE', retryable: true });
  });

  it('exige el token', async () => {
    app = await testApp({}, { STT_PROVIDER: 'mock' });
    const res = await postWav(buildWav(), { 'content-type': 'audio/wav' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rechaza un WAV con otro formato con 400', async () => {
    app = await testApp({}, { STT_PROVIDER: 'mock' });
    const res = await postWav(buildWav({ channels: 2 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'BAD_REQUEST', retryable: false });
  });

  it('rechaza un audio demasiado corto con 400', async () => {
    app = await testApp({}, { STT_PROVIDER: 'mock' });
    const res = await postWav(buildWav({ seconds: 0.1 }));
    expect(res.statusCode).toBe(400);
  });

  it.each([
    ['JSON', 'application/json', Buffer.from('{"audio":"x"}')],
    ['otro tipo de audio', 'audio/mpeg', Buffer.alloc(1000)],
  ])('rechaza un cuerpo %s con 400', async (_, contentType, payload) => {
    app = await testApp({}, { STT_PROVIDER: 'mock' });
    const res = await postWav(payload, { ...auth, 'content-type': contentType });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('acepta hasta TRANSCRIBE_MAX_BYTES (30 s) y responde 413 por encima', async () => {
    app = await testApp({}, { STT_PROVIDER: 'mock' });
    const max = buildWav({ seconds: 30 });
    expect(max.length).toBe(TRANSCRIBE_MAX_BYTES);
    expect((await postWav(max)).statusCode).toBe(200);

    const res = await postWav(buildWav({ seconds: 31 }));
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', retryable: false });
  });

  it('no cambia el límite de cuerpo del resto de la API', async () => {
    app = await testApp({}, { STT_PROVIDER: 'mock' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/interpret',
      headers: auth,
      payload: { messages: [{ role: 'user', content: 'x'.repeat(600 * 1024) }] },
    });
    expect(res.statusCode).toBe(413);
  });

  it('devuelve texto vacío con silencio, sin llamar al modelo', async () => {
    let calls = 0;
    const provider: TranscriptionProvider = {
      status: 'ready',
      transcribe: async () => {
        calls++;
        return 'Subtítulos realizados por la comunidad de Amara.org';
      },
    };
    app = await testApp({ transcriber: provider });
    const res = await postWav(buildWav({ amplitude: 0 }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: '' });
    expect(calls).toBe(0);
  });

  it('tiene un límite de frecuencia propio', async () => {
    app = await testApp({}, { STT_PROVIDER: 'mock', STT_RATE_LIMIT_MAX: '1' });
    expect((await postWav(buildWav())).statusCode).toBe(200);
    const second = await postWav(buildWav());
    expect(second.statusCode).toBe(429);
    expect(second.json().error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  it('informa el estado del modelo en /health sin fallar', async () => {
    app = await testApp();
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok', stt: 'off' });
    await app.close();

    const failed: TranscriptionProvider = { status: 'failed', transcribe: async () => '' };
    app = await testApp({ transcriber: failed });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', stt: 'failed' });
  });

  it('aparece en el OpenAPI con audio/wav y la respuesta tipada', async () => {
    app = await testApp({}, { STT_PROVIDER: 'mock' });
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    const operation = res.json().paths['/v1/transcribe'].post;
    expect(operation.requestBody.content).toHaveProperty('audio/wav');
    expect(operation.responses['200'].content['application/json'].schema.properties).toHaveProperty('text');
  });
});

/** Logger que guarda todo lo que se registra, para comprobar que no hay contenido. */
function recordingLogger() {
  const entries: unknown[] = [];
  const record = (...args: unknown[]) => void entries.push(args);
  const logger = { info: record, warn: record, error: record, debug: record, trace: record, fatal: record } as unknown as FastifyBaseLogger;
  return { logger, entries };
}

/** Proveedor falso controlable: cada llamada queda pendiente hasta resolverla a mano. */
function manualProvider() {
  const pending: Array<{ resolve: (text: string) => void; signal: AbortSignal }> = [];
  const provider: TranscriptionProvider = {
    status: 'ready',
    transcribe: (_pcm, signal) => new Promise<string>((resolve) => pending.push({ resolve, signal })),
  };
  return { provider, pending };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('TranscribeService', () => {
  const options = { timeoutMs: 1_000, concurrency: 1, maxQueued: 1 };
  const wav = buildWav({ seconds: 1 });

  it('no supera la concurrencia, encola en orden y responde ocupado con la cola llena', async () => {
    const { provider, pending } = manualProvider();
    const service = new TranscribeService(provider, options, recordingLogger().logger);

    const first = service.transcribe(wav);
    const second = service.transcribe(wav);
    await tick();
    expect(pending).toHaveLength(1);

    await expect(service.transcribe(wav)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', retryable: true });

    pending[0]!.resolve(' uno ');
    await expect(first).resolves.toEqual({ text: 'uno' });
    await tick();
    expect(pending).toHaveLength(2);
    pending[1]!.resolve('dos');
    await expect(second).resolves.toEqual({ text: 'dos' });
  });

  it('corta por timeout y libera el lugar recién cuando termina la inferencia', async () => {
    const { provider, pending } = manualProvider();
    const service = new TranscribeService(provider, { ...options, timeoutMs: 30 }, recordingLogger().logger);

    await expect(service.transcribe(wav)).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
    expect(pending[0]!.signal.aborted).toBe(true);

    // La inferencia anterior sigue ocupando el único lugar: la siguiente espera y vence en la cola.
    await expect(service.transcribe(wav)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(pending).toHaveLength(1);

    pending[0]!.resolve('tarde');
    await tick();
    const next = service.transcribe(wav);
    await tick();
    pending[1]!.resolve('a tiempo');
    await expect(next).resolves.toEqual({ text: 'a tiempo' });
  });

  it('saca de la cola a quien cortó la conexión', async () => {
    const { provider, pending } = manualProvider();
    const service = new TranscribeService(provider, options, recordingLogger().logger);

    const first = service.transcribe(wav);
    const gone = new AbortController();
    const second = service.transcribe(wav, { signal: gone.signal });
    gone.abort();
    await expect(second).rejects.toBeInstanceOf(AppError);

    pending[0]!.resolve('uno');
    await first;
    await tick();
    expect(pending).toHaveLength(1);
  });

  it('registra solo métricas: nunca el texto ni el audio', async () => {
    const secret = 'mi DNI es 12345678';
    const { logger, entries } = recordingLogger();
    const service = new TranscribeService(new MockTranscriptionProvider(secret), options, logger);

    await expect(service.transcribe(wav)).resolves.toEqual({ text: secret });
    await expect(service.transcribe(buildWav({ channels: 2 }))).rejects.toBeInstanceOf(AppError);

    const logged = JSON.stringify(entries);
    expect(logged).not.toContain('12345678');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual([{ audioMs: 1000, latencyMs: expect.any(Number), outcome: 'OK' }, 'transcribe']);
    expect(entries[1]).toEqual([{ audioMs: undefined, latencyMs: expect.any(Number), outcome: 'BAD_REQUEST' }, 'transcribe']);
  });
});

describe('cleanTranscript', () => {
  it.each([
    ['  Quiero   sacar un turno. ', 'Quiero sacar un turno.'],
    ['[Música] Hola', 'Hola'],
    ['♪♪', ''],
    ['(música)', ''],
    ['...', ''],
    ['Subtítulos realizados por la comunidad de Amara.org', ''],
    ['¡Gracias por ver el video!', ''],
  ])('%j → %j', (raw, expected) => {
    expect(cleanTranscript(raw)).toBe(expected);
  });

  it('recorta a 1000 caracteres', () => {
    expect(cleanTranscript('a'.repeat(1500))).toHaveLength(1000);
  });
});

import { SPEAK_MAX_CHARS } from '@hackaton/contracts';
import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { MOCK_MP3 } from '../src/modules/speak/mock-provider.js';
import { VOICE_INSTRUCTIONS } from '../src/modules/speak/openai-provider.js';
import type { SpeechProvider } from '../src/modules/speak/provider.js';
import { SpeakService } from '../src/modules/speak/speak.service.js';
import { auth, recordingLogger, testApp, TOKEN } from './helpers.js';
import { buildWav } from './wav-helpers.js';

let app: FastifyInstance;
afterEach(() => app?.close());

const OPENAI_ENV = { OPENAI_API_KEY: 'sk-prueba' };

/** Cliente de OpenAI falso: registra los parámetros y nunca sale a la red. */
function fakeOpenAI({
  text = ' Quiero pagar la factura de OSE. ',
  audio = [Buffer.from('ID3'), Buffer.from('mp3')],
  fail,
}: { text?: string; audio?: Buffer[]; fail?: () => Error } = {}) {
  const calls = { transcriptions: [] as any[], speech: [] as any[] };
  const client = {
    audio: {
      transcriptions: {
        create: async (params: any, options: any) => {
          calls.transcriptions.push({ params, options });
          if (fail) throw fail();
          return { text };
        },
      },
      speech: {
        create: async (params: any, options: any) => {
          calls.speech.push({ params, options });
          if (fail) throw fail();
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              for (const part of audio) controller.enqueue(new Uint8Array(part));
              controller.close();
            },
          });
          return new Response(body, { headers: { 'content-type': 'audio/mpeg' } });
        },
      },
    },
  } as unknown as OpenAI;
  return { client, calls };
}

const postWav = (payload: Buffer) =>
  app.inject({ method: 'POST', url: '/v1/transcribe', headers: { ...auth, 'content-type': 'audio/wav' }, payload });
const postSpeak = (payload: object, headers: Record<string, string> = auth) =>
  app.inject({ method: 'POST', url: '/v1/speak', headers, payload });

describe('configuración de OpenAI', () => {
  const base = { NODE_ENV: 'test', API_ACCESS_TOKENS: TOKEN };

  it('exige OPENAI_API_KEY si STT o TTS usan openai, sin mostrar valores', () => {
    expect(() => loadConfig({ ...base, STT_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(() => loadConfig({ ...base, TTS_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(() => loadConfig({ ...base, STT_PROVIDER: 'openai', ...OPENAI_ENV })).not.toThrow();
  });

  it('apaga la voz por defecto y no permite mocks en producción', () => {
    const config = loadConfig(base);
    expect(config.STT_PROVIDER).toBe('off');
    expect(config.TTS_PROVIDER).toBe('off');
    expect(config.OPENAI_STT_PROMPT).toBe('');
    expect(config.OPENAI_STT_KEYWORDS).toEqual([]);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'x', TTS_PROVIDER: 'mock' }),
    ).toThrow(/TTS_PROVIDER/);
  });

  it('ajusta la concurrencia por defecto al proveedor de voz a texto', () => {
    expect(loadConfig({ ...base, STT_PROVIDER: 'local' }).STT_CONCURRENCY).toBe(1);
    expect(loadConfig({ ...base, STT_PROVIDER: 'openai', ...OPENAI_ENV }).STT_CONCURRENCY).toBe(8);
    expect(loadConfig({ ...base, STT_PROVIDER: 'openai', STT_CONCURRENCY: '3', ...OPENAI_ENV }).STT_CONCURRENCY).toBe(3);
  });
});

describe('POST /v1/transcribe con OpenAI', () => {
  it('manda el WAV tal cual, en español, y limpia el texto', async () => {
    const { client, calls } = fakeOpenAI();
    app = await testApp({ openai: client }, { STT_PROVIDER: 'openai', ...OPENAI_ENV });
    const wav = buildWav({ seconds: 2 });
    const res = await postWav(wav);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: 'Quiero pagar la factura de OSE.' });
    const { params, options } = calls.transcriptions[0];
    expect(params.model).toBe('gpt-transcribe');
    expect(params.languages).toEqual(['es']);
    expect(params).not.toHaveProperty('language');
    expect(params).not.toHaveProperty('prompt');
    expect(params).not.toHaveProperty('keywords');
    expect(params.file.name).toBe('voz.wav');
    expect(Buffer.from(await params.file.arrayBuffer()).equals(wav)).toBe(true);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('usa el prompt y las palabras clave configuradas', async () => {
    const { client, calls } = fakeOpenAI();
    app = await testApp(
      { openai: client },
      { STT_PROVIDER: 'openai', OPENAI_STT_PROMPT: 'Trámites en gub.uy.', OPENAI_STT_KEYWORDS: 'BPS, DGI ,Antel', ...OPENAI_ENV },
    );
    await postWav(buildWav());
    expect(calls.transcriptions[0].params).toMatchObject({ prompt: 'Trámites en gub.uy.', keywords: ['BPS', 'DGI', 'Antel'] });
  });

  it('con gpt-4o-mini-transcribe usa `language` y no manda keywords', async () => {
    const { client, calls } = fakeOpenAI();
    app = await testApp(
      { openai: client },
      { STT_PROVIDER: 'openai', OPENAI_STT_MODEL: 'gpt-4o-mini-transcribe', OPENAI_STT_KEYWORDS: 'BPS', ...OPENAI_ENV },
    );
    await postWav(buildWav());
    const { params } = calls.transcriptions[0];
    expect(params.language).toBe('es');
    expect(params).not.toHaveProperty('languages');
    expect(params).not.toHaveProperty('keywords');
  });

  it('no llama a OpenAI con silencio', async () => {
    const { client, calls } = fakeOpenAI();
    app = await testApp({ openai: client }, { STT_PROVIDER: 'openai', ...OPENAI_ENV });
    expect((await postWav(buildWav({ amplitude: 0 }))).json()).toEqual({ text: '' });
    expect(calls.transcriptions).toHaveLength(0);
  });

  it.each([
    ['saturado (429)', () => new OpenAI.RateLimitError(429, undefined, 'x', new Headers()), 503, 'AI_UNAVAILABLE', true],
    ['caído (500)', () => new OpenAI.InternalServerError(500, undefined, 'x', new Headers()), 503, 'AI_UNAVAILABLE', true],
    ['sin respuesta a tiempo', () => new OpenAI.APIConnectionTimeoutError(), 504, 'TIMEOUT', true],
    ['clave inválida (401)', () => new OpenAI.AuthenticationError(401, undefined, 'x', new Headers()), 500, 'INTERNAL', false],
  ])('traduce OpenAI %s a los códigos existentes', async (_, fail, status, code, retryable) => {
    const { client } = fakeOpenAI({ fail });
    app = await testApp({ openai: client }, { STT_PROVIDER: 'openai', ...OPENAI_ENV });
    const res = await postWav(buildWav());
    expect(res.statusCode).toBe(status);
    expect(res.json().error).toMatchObject({ code, retryable });
  });
});

describe('POST /v1/speak', () => {
  const text = 'Tocá «Iniciar trámite» para renovar la cédula.';

  it('responde 503 no reintentable con TTS_PROVIDER=off (el valor por defecto)', async () => {
    app = await testApp();
    const res = await postSpeak({ text });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatchObject({ code: 'AI_UNAVAILABLE', retryable: false });
  });

  it('devuelve un MP3 válido con el proveedor mock', async () => {
    app = await testApp({}, { TTS_PROVIDER: 'mock' });
    const res = await postSpeak({ text });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload.equals(MOCK_MP3)).toBe(true);
    // Cabecera de cuadro MPEG-1 Layer III.
    expect([...res.rawPayload.subarray(0, 2)]).toEqual([0xff, 0xfb]);
  });

  it('reenvía el audio de OpenAI con la voz, el modelo y las instrucciones del servidor', async () => {
    const { client, calls } = fakeOpenAI({ audio: [Buffer.from('parte-1|'), Buffer.from('parte-2')] });
    app = await testApp({ openai: client }, { TTS_PROVIDER: 'openai', ...OPENAI_ENV });
    const res = await postSpeak({ text: `  ${text}  ` });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.body).toBe('parte-1|parte-2');
    const { params, options } = calls.speech[0];
    expect(params).toEqual({
      model: 'gpt-4o-mini-tts',
      voice: 'marin',
      input: text,
      instructions: VOICE_INSTRUCTIONS,
      response_format: 'mp3',
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['vacío', { text: '   ' }],
    ['demasiado largo', { text: 'a'.repeat(SPEAK_MAX_CHARS + 1) }],
    ['con campos de más', { text: 'Hola', voice: 'cedar' }],
  ])('rechaza un texto %s con 400', async (_, payload) => {
    app = await testApp({}, { TTS_PROVIDER: 'mock' });
    const res = await postSpeak(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('exige el token', async () => {
    app = await testApp({}, { TTS_PROVIDER: 'mock' });
    expect((await postSpeak({ text }, {})).statusCode).toBe(401);
  });

  it('tiene un límite de frecuencia propio', async () => {
    app = await testApp({}, { TTS_PROVIDER: 'mock', TTS_RATE_LIMIT_MAX: '1' });
    expect((await postSpeak({ text })).statusCode).toBe(200);
    const second = await postSpeak({ text });
    expect(second.statusCode).toBe(429);
    expect(second.json().error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  it('traduce un fallo de OpenAI antes del audio a 503 reintentable', async () => {
    const { client } = fakeOpenAI({ fail: () => new OpenAI.InternalServerError(503, undefined, 'x', new Headers()) });
    app = await testApp({ openai: client }, { TTS_PROVIDER: 'openai', ...OPENAI_ENV });
    const res = await postSpeak({ text });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatchObject({ code: 'AI_UNAVAILABLE', retryable: true });
  });

  it('informa el estado en /health', async () => {
    app = await testApp({}, { TTS_PROVIDER: 'mock' });
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok', stt: 'off', tts: 'ready' });
  });
});

describe('SpeakService', () => {
  it('registra solo caracteres, tiempos, bytes y resultado; nunca el texto', async () => {
    const secret = 'Tu cédula 1.234.567-8 vence el mes que viene.';
    const { logger, entries } = recordingLogger();
    const provider: SpeechProvider = {
      speak: async () =>
        (async function* () {
          yield new Uint8Array([1, 2, 3]);
          yield new Uint8Array([4, 5]);
        })(),
    };
    const stream = await new SpeakService(provider, logger).speak(secret);
    const received: Buffer[] = [];
    for await (const chunk of stream) received.push(Buffer.from(chunk));

    expect(Buffer.concat(received)).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    expect(JSON.stringify(entries)).not.toContain('1.234.567-8');
    expect(entries).toEqual([
      [{ chars: secret.length, latencyMs: expect.any(Number), outcome: 'OK', ttfbMs: expect.any(Number), bytes: 5 }, 'speak'],
    ]);
  });

  it('cierra el audio del proveedor si la persona se va', async () => {
    let closed = false;
    const provider: SpeechProvider = {
      speak: async (_text, signal) =>
        (async function* () {
          try {
            yield new Uint8Array([1]);
            await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
          } finally {
            closed = true;
          }
        })(),
    };
    const controller = new AbortController();
    const { logger, entries } = recordingLogger();
    const stream = await new SpeakService(provider, logger).speak('Hola', { signal: controller.signal });
    stream.once('data', () => {
      controller.abort();
      stream.destroy();
    });
    await new Promise((resolve) => stream.once('close', resolve));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closed).toBe(true);
    expect(entries.at(-1)?.[0]).toMatchObject({ outcome: 'CLIENT_CLOSED' });
  });
});

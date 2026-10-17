import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeWav, WAV_MAX_SAMPLES, WAV_MIN_SAMPLES } from '../shared/wav';
import { ApiFailure, type ApiClient } from './api/client';
import { HttpApiClient } from './api/http';
import { MOCK_TRANSCRIPT, MockApiClient } from './api/mock';
import { audioBytes, cleanTranscript, Transcriber } from './voice';

const tone = (amplitude: number, samples = WAV_MIN_SAMPLES * 2) => encodeWav(Float32Array.from({ length: samples }, (_, i) => amplitude * Math.sin(i / 5)));
const base = new URL('https://api.ejemplo.test');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeApi(transcribe: ApiClient['transcribe']): ApiClient {
  return { isMock: true, interpret: vi.fn(), options: vi.fn(), nextStep: vi.fn(), transcribe };
}

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(line));
});
afterEach(() => vi.restoreAllMocks());

describe('Transcriber', () => {
  it('devuelve el texto limpio para el buscador, sin loguearlo', async () => {
    const api = fakeApi(vi.fn(async () => ({ text: '  horarios\nde la   biblioteca ' })));
    await expect(new Transcriber(api).transcribe(tone(0.3))).resolves.toEqual({ status: 'ok', text: 'horarios de la biblioteca' });
    expect(logs.join('\n')).not.toContain('biblioteca');
  });

  it('texto vacío → «no te escuché»', async () => {
    const api = fakeApi(vi.fn(async () => ({ text: '   ' })));
    await expect(new Transcriber(api).transcribe(tone(0.3))).resolves.toEqual({ status: 'empty' });
  });

  it('no manda audio inválido ni datos que no son audio', async () => {
    const transcribe = vi.fn();
    const transcriber = new Transcriber(fakeApi(transcribe));
    for (const raw of ['hola', null, { length: 10 }, new ArrayBuffer(100), encodeWav(new Float32Array(10)), encodeWav(new Float32Array(WAV_MIN_SAMPLES), 44_100)]) {
      await expect(transcriber.transcribe(raw)).resolves.toEqual({ status: 'error', reason: 'failed' });
    }
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('acepta ArrayBuffer o Uint8Array (como llegan por IPC)', async () => {
    const transcribe = vi.fn(async () => ({ text: 'ok' }));
    const transcriber = new Transcriber(fakeApi(transcribe));
    await expect(transcriber.transcribe(new Uint8Array(tone(0.3)))).resolves.toEqual({ status: 'ok', text: 'ok' });
    expect(audioBytes(new Uint8Array(4))).toHaveLength(4);
    expect(audioBytes('x')).toBeNull();
  });

  it('traduce los errores del servidor sin exponer detalles', async () => {
    const failing = (code: ConstructorParameters<typeof ApiFailure>[0]) => new Transcriber(fakeApi(vi.fn(async () => Promise.reject(new ApiFailure(code, false)))));
    await expect(failing('RATE_LIMITED').transcribe(tone(0.3))).resolves.toEqual({ status: 'error', reason: 'busy' });
    for (const code of ['AI_UNAVAILABLE', 'TIMEOUT', 'PAYLOAD_TOO_LARGE', 'BAD_REQUEST', 'INVALID_RESPONSE', 'NETWORK'] as const) {
      await expect(failing(code).transcribe(tone(0.3))).resolves.toEqual({ status: 'error', reason: 'failed' });
    }
  });

  it('cleanTranscript deja una línea de hasta 500 caracteres', () => {
    expect(cleanTranscript('a\u0000b​c')).toBe('a b c');
    expect(cleanTranscript('x'.repeat(1000))).toHaveLength(500);
  });
});

describe('HttpApiClient.transcribe', () => {
  it('manda el WAV como audio/wav a /v1/transcribe y valida { text }', async () => {
    const fetch = vi.fn(async () => json(200, { text: 'renovar documento' }));
    const client = new HttpApiClient({ baseUrl: base, token: 'tok', fetch });
    const wav = new Uint8Array(tone(0.3));
    await expect(client.transcribe(wav, new AbortController().signal)).resolves.toEqual({ text: 'renovar documento' });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.ejemplo.test/v1/transcribe');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('audio/wav');
    expect(headers.authorization).toBe('Bearer tok');
    expect(init.body).toEqual(wav);
  });

  it('rechaza respuestas fuera del contrato', async () => {
    for (const body of [{}, { text: 42 }, { text: 'x'.repeat(1001) }, null]) {
      const client = new HttpApiClient({ baseUrl: base, token: null, fetch: vi.fn(async () => json(200, body)) });
      await expect(client.transcribe(new Uint8Array(tone(0.3)), new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('devuelve los errores de ApiError', async () => {
    const fetch = vi.fn(async () => json(413, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'x', requestId: 'r', retryable: false } }));
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    await expect(client.transcribe(new Uint8Array(tone(0.3)), new AbortController().signal)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('un WAV de 30 s justo en el límite (960 044 bytes) se envía: no aplica el límite JSON de 512 KiB', async () => {
    const fetch = vi.fn(async () => json(200, { text: 'Quiero renovar mi documento' }));
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    const wav = new Uint8Array(encodeWav(new Float32Array(WAV_MAX_SAMPLES)));
    expect(wav.byteLength).toBe(960_044);
    expect(wav.byteLength).toBeGreaterThan(512 * 1024);
    await expect(client.transcribe(wav, new AbortController().signal)).resolves.toEqual({ text: 'Quiero renovar mi documento' });
    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect((init.body as Uint8Array).byteLength).toBe(960_044);
  });

  it('un byte de audio más que 30 s no se envía', async () => {
    const fetch = vi.fn();
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    const tooLong = new Uint8Array(encodeWav(new Float32Array(WAV_MAX_SAMPLES + 1)));
    await expect(client.transcribe(tooLong, new AbortController().signal)).rejects.toBeInstanceOf(ApiFailure);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('no envía audio que no cumple el formato', async () => {
    const fetch = vi.fn();
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    await expect(client.transcribe(new Uint8Array(encodeWav(new Float32Array(10))), new AbortController().signal)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('MockApiClient.transcribe (TEMPORAL)', () => {
  const mock = new MockApiClient({ fixturesOrigin: null, latencyMs: 0 });
  it('con voz devuelve la búsqueda fija; con silencio, texto vacío', async () => {
    await expect(mock.transcribe(new Uint8Array(tone(0.3)), new AbortController().signal)).resolves.toEqual({ text: MOCK_TRANSCRIPT });
    await expect(mock.transcribe(new Uint8Array(tone(0)), new AbortController().signal)).resolves.toEqual({ text: '' });
  });
});

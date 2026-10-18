import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure, type ApiClient } from './api/client';
import { HttpApiClient } from './api/http';
import { MockApiClient, silentMp3 } from './api/mock';
import { Speaker, speakErrorReason } from './speech';

const base = new URL('https://api.ejemplo.test');
const MP3 = new Uint8Array([0xff, 0xfb, 0x10, 0xc0, 0, 0]);
const mp3Response = (body: Uint8Array = MP3, type = 'audio/mpeg') => new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': type } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, code: string, retryable: boolean) => json(status, { error: { code, message: 'x', requestId: 'r', retryable } });

function fakeApi(speak: ApiClient['speak']): ApiClient {
  return { isMock: true, interpret: vi.fn(), options: vi.fn(), nextStep: vi.fn(), transcribe: vi.fn(), speak };
}

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(line));
});
afterEach(() => vi.restoreAllMocks());

describe('Speaker', () => {
  it('devuelve el MP3 y no loguea el texto', async () => {
    const speak = vi.fn(async () => MP3);
    await expect(new Speaker(fakeApi(speak)).speak('Hacé clic en «Sacar turno».')).resolves.toEqual({ status: 'ok', audio: MP3 });
    expect(speak).toHaveBeenCalledWith({ text: 'Hacé clic en «Sacar turno».' }, expect.any(AbortSignal));
    expect(logs.join('\n')).not.toContain('Sacar turno');
  });

  it('recorta a 600 caracteres sin cortar palabras antes de mandar', async () => {
    const speak = vi.fn(async () => MP3);
    await new Speaker(fakeApi(speak)).speak('palabra '.repeat(200));
    const [{ text }] = speak.mock.calls[0] as unknown as [{ text: string }];
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text.endsWith('palabra')).toBe(true);
  });

  it('no manda textos vacíos ni datos que no son texto', async () => {
    const speak = vi.fn();
    const speaker = new Speaker(fakeApi(speak));
    for (const raw of ['', '   ', null, 42, { text: 'x' }]) await expect(speaker.speak(raw)).resolves.toEqual({ status: 'error', reason: 'failed' });
    expect(speak).not.toHaveBeenCalled();
  });

  it('mapea los errores con el retryable del servidor', () => {
    expect(speakErrorReason(new ApiFailure('AI_UNAVAILABLE', false))).toBe('off');
    expect(speakErrorReason(new ApiFailure('AI_UNAVAILABLE', true))).toBe('busy');
    expect(speakErrorReason(new ApiFailure('RATE_LIMITED', true))).toBe('busy');
    for (const code of ['TIMEOUT', 'BAD_REQUEST', 'INVALID_RESPONSE', 'NETWORK'] as const) expect(speakErrorReason(new ApiFailure(code, false))).toBe('failed');
    expect(speakErrorReason(new Error('x'))).toBe('failed');
  });

  it('voz apagada (off): no vuelve a llamar al servidor en esta ejecución', async () => {
    const speak = vi.fn(async () => Promise.reject(new ApiFailure('AI_UNAVAILABLE', false)));
    const speaker = new Speaker(fakeApi(speak));
    await expect(speaker.speak('Hola')).resolves.toEqual({ status: 'error', reason: 'off' });
    await expect(speaker.speak('Hola')).resolves.toEqual({ status: 'error', reason: 'off' });
    expect(speak).toHaveBeenCalledOnce();
  });

  it('«Detener» o una lectura nueva cortan la descarga en curso (stopped)', async () => {
    const speak = vi.fn(
      (_r: unknown, signal: AbortSignal) =>
        new Promise<Uint8Array>((_resolve, reject) => signal.addEventListener('abort', () => reject(new ApiFailure('ABORTED', false)))),
    );
    const speaker = new Speaker(fakeApi(speak));
    const first = speaker.speak('Primera');
    speaker.stop();
    await expect(first).resolves.toEqual({ status: 'error', reason: 'stopped' });
    const second = speaker.speak('Segunda');
    const third = speaker.speak('Tercera');
    await expect(second).resolves.toEqual({ status: 'error', reason: 'stopped' });
    speaker.stop();
    await expect(third).resolves.toEqual({ status: 'error', reason: 'stopped' });
  });
});

describe('HttpApiClient.speak', () => {
  it('manda { text } en JSON, pide audio/mpeg y devuelve los bytes', async () => {
    const fetch = vi.fn(async () => mp3Response());
    const client = new HttpApiClient({ baseUrl: base, token: 'tok', fetch });
    await expect(client.speak({ text: ' Hola ' }, new AbortController().signal)).resolves.toEqual(MP3);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.ejemplo.test/v1/speak');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Hola' });
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.accept).toBe('audio/mpeg');
    expect(headers.authorization).toBe('Bearer tok');
  });

  it('no manda textos fuera del contrato (vacío o más de 600)', async () => {
    const fetch = vi.fn();
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    await expect(client.speak({ text: '  ' }, new AbortController().signal)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(client.speak({ text: 'x'.repeat(601) }, new AbortController().signal)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rechaza respuestas que no son MP3 o están vacías', async () => {
    for (const response of [() => mp3Response(MP3, 'application/json'), () => mp3Response(new Uint8Array(0))]) {
      const client = new HttpApiClient({ baseUrl: base, token: null, fetch: vi.fn(async () => response()) });
      await expect(client.speak({ text: 'Hola' }, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('el retryable de AI_UNAVAILABLE llega hasta el Speaker', async () => {
    const off = new HttpApiClient({ baseUrl: base, token: null, fetch: vi.fn(async () => apiError(503, 'AI_UNAVAILABLE', false)) });
    await expect(new Speaker(off).speak('Hola')).resolves.toEqual({ status: 'error', reason: 'off' });
    const busy = new HttpApiClient({ baseUrl: base, token: null, retries: 0, fetch: vi.fn(async () => apiError(503, 'AI_UNAVAILABLE', true)) });
    await expect(new Speaker(busy).speak('Hola')).resolves.toEqual({ status: 'error', reason: 'busy' });
    const limited = new HttpApiClient({ baseUrl: base, token: null, retries: 0, fetch: vi.fn(async () => apiError(429, 'RATE_LIMITED', true)) });
    await expect(new Speaker(limited).speak('Hola')).resolves.toEqual({ status: 'error', reason: 'busy' });
  });
});

describe('MockApiClient.speak (TEMPORAL)', () => {
  it('devuelve tramas MP3 válidas, más largas cuanto más texto', async () => {
    const mock = new MockApiClient({ fixturesOrigin: null, latencyMs: 0 });
    const short = await mock.speak({ text: 'Hola' }, new AbortController().signal);
    const long = await mock.speak({ text: 'palabra '.repeat(60) }, new AbortController().signal);
    expect([...short.slice(0, 4)]).toEqual([0xff, 0xfb, 0x10, 0xc0]);
    expect(short.byteLength % 104).toBe(0);
    expect(long.byteLength).toBeGreaterThan(short.byteLength);
    expect(silentMp3(1).byteLength).toBe(38 * 104);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UI_SPEECH_CUT_CHANNEL, type SpeechAudioEvent } from '../shared/ipc';
import { ApiFailure, type ApiClient } from './api/client';
import { HttpApiClient } from './api/http';
import { MockApiClient, silentMp3 } from './api/mock';
import { Speaker, SpeechHub, speakErrorReason } from './speech';

const base = new URL('https://api.ejemplo.test');
const A = new Uint8Array([0xff, 0xfb, 0x10, 0xc0]);
const B = new Uint8Array([0, 0, 0, 0]);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, code: string, retryable: boolean) => json(status, { error: { code, message: 'x', requestId: 'r', retryable } });

/** Respuesta en streaming: un pedazo por `enqueue`. */
function streamingResponse(chunks: Uint8Array[], type = 'audio/mpeg') {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': type } });
}

async function* chunks(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield part;
}

/** Pedazos que esperan a que se aborte (descarga colgada). */
async function* hanging(signal: AbortSignal): AsyncGenerator<Uint8Array> {
  yield A;
  await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new ApiFailure('ABORTED', false))));
}

function fakeApi(speak: ApiClient['speak']): ApiClient {
  return { isMock: true, interpret: vi.fn(), options: vi.fn(), nextStep: vi.fn(), transcribe: vi.fn(), speak };
}

/** Junta lo que la vista recibiría y espera el cierre (end o error). */
function sink() {
  const events: SpeechAudioEvent[] = [];
  let close: () => void = () => {};
  const closed = new Promise<void>((resolve) => (close = resolve));
  const push = (event: SpeechAudioEvent) => {
    events.push(event);
    if (event.type !== 'chunk') close();
  };
  return { events, push, closed };
}

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(line));
});
afterEach(() => vi.restoreAllMocks());

describe('Speaker', () => {
  it('resuelve apenas el servidor acepta y reenvía los pedazos en orden; no loguea el texto', async () => {
    const speak = vi.fn(async () => chunks(A, B));
    const out = sink();
    await expect(new Speaker(fakeApi(speak)).speak('Hacé clic en «Sacar turno».', out.push)).resolves.toEqual({ status: 'ok' });
    await out.closed;
    expect(out.events).toEqual([{ type: 'chunk', chunk: A }, { type: 'chunk', chunk: B }, { type: 'end' }]);
    expect(speak).toHaveBeenCalledWith({ text: 'Hacé clic en «Sacar turno».' }, expect.any(AbortSignal));
    expect(logs.join('\n')).not.toContain('Sacar turno');
    expect(logs.join('\n')).toContain('firstMs');
  });

  it('recorta a 600 caracteres sin cortar palabras antes de mandar', async () => {
    const speak = vi.fn(async () => chunks(A));
    await new Speaker(fakeApi(speak)).speak('palabra '.repeat(200), () => {});
    const [{ text }] = speak.mock.calls[0] as unknown as [{ text: string }];
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text.endsWith('palabra')).toBe(true);
  });

  it('no manda textos vacíos ni datos que no son texto', async () => {
    const speak = vi.fn();
    const speaker = new Speaker(fakeApi(speak));
    for (const raw of ['', '   ', null, 42, { text: 'x' }]) await expect(speaker.speak(raw, () => {})).resolves.toEqual({ status: 'error', reason: 'failed' });
    expect(speak).not.toHaveBeenCalled();
  });

  it('mapea los errores con el retryable del servidor; TIMEOUT (504) es «ocupado»', () => {
    expect(speakErrorReason(new ApiFailure('AI_UNAVAILABLE', false))).toBe('off');
    expect(speakErrorReason(new ApiFailure('AI_UNAVAILABLE', true))).toBe('busy');
    expect(speakErrorReason(new ApiFailure('RATE_LIMITED', true))).toBe('busy');
    expect(speakErrorReason(new ApiFailure('TIMEOUT', true))).toBe('busy');
    for (const code of ['BAD_REQUEST', 'INVALID_RESPONSE', 'NETWORK'] as const) expect(speakErrorReason(new ApiFailure(code, false))).toBe('failed');
    expect(speakErrorReason(new Error('x'))).toBe('failed');
  });

  it('voz apagada (off): no vuelve a llamar al servidor en esta ejecución', async () => {
    const speak = vi.fn(async () => Promise.reject(new ApiFailure('AI_UNAVAILABLE', false)));
    const speaker = new Speaker(fakeApi(speak));
    await expect(speaker.speak('Hola', () => {})).resolves.toEqual({ status: 'error', reason: 'off' });
    await expect(speaker.speak('Hola', () => {})).resolves.toEqual({ status: 'error', reason: 'off' });
    expect(speak).toHaveBeenCalledOnce();
  });

  it('un error en medio del streaming llega a la vista como `failed`', async () => {
    async function* broken(): AsyncGenerator<Uint8Array> {
      yield A;
      throw new ApiFailure('NETWORK', false);
    }
    const out = sink();
    await new Speaker(fakeApi(vi.fn(async () => broken()))).speak('Hola', out.push);
    await out.closed;
    expect(out.events).toEqual([{ type: 'chunk', chunk: A }, { type: 'error', reason: 'failed' }]);
  });

  it('«Detener» corta la descarga en medio del streaming (stopped) y no manda más pedazos', async () => {
    const speaker = new Speaker(fakeApi(vi.fn(async (_r, signal: AbortSignal) => hanging(signal))));
    const out = sink();
    await expect(speaker.speak('Hola', out.push)).resolves.toEqual({ status: 'ok' });
    await vi.waitFor(() => expect(out.events).toHaveLength(1));
    speaker.stop();
    await out.closed;
    expect(out.events).toEqual([{ type: 'chunk', chunk: A }, { type: 'error', reason: 'stopped' }]);
  });

  it('«Detener» antes de que el servidor acepte devuelve stopped', async () => {
    const speak = vi.fn(
      (_r: unknown, signal: AbortSignal) =>
        new Promise<AsyncIterable<Uint8Array>>((_resolve, reject) => signal.addEventListener('abort', () => reject(new ApiFailure('ABORTED', false)))),
    );
    const speaker = new Speaker(fakeApi(speak));
    const pending = speaker.speak('Hola', () => {});
    speaker.stop();
    await expect(pending).resolves.toEqual({ status: 'error', reason: 'stopped' });
  });
});

describe('SpeechHub: una sola lectura en toda la app', () => {
  const view = () => ({ send: vi.fn(), isDestroyed: vi.fn(() => false) });

  it('una lectura nueva desde la tarjeta avisa a la ventana que corte (y no a la tarjeta)', async () => {
    const [win, card] = [view(), view()];
    const hub = new SpeechHub(fakeApi(vi.fn(async () => chunks(A))), () => [win, card]);
    await expect(hub.speak(card, 'Hola', () => {})).resolves.toEqual({ status: 'ok' });
    expect(win.send).toHaveBeenCalledWith(UI_SPEECH_CUT_CHANNEL);
    expect(card.send).not.toHaveBeenCalled();
  });

  it('una lectura nueva corta el streaming de la otra vista', async () => {
    const [win, card] = [view(), view()];
    const speak = vi.fn().mockImplementationOnce(async (_r, signal: AbortSignal) => hanging(signal)).mockImplementationOnce(async () => chunks(B));
    const hub = new SpeechHub(fakeApi(speak), () => [win, card]);
    const fromWindow = sink();
    await hub.speak(win, 'Primera', fromWindow.push);
    await vi.waitFor(() => expect(fromWindow.events).toHaveLength(1));
    const fromCard = sink();
    await hub.speak(card, 'Segunda', fromCard.push);
    await Promise.all([fromWindow.closed, fromCard.closed]);
    expect(fromWindow.events.at(-1)).toEqual({ type: 'error', reason: 'stopped' });
    expect(fromCard.events).toEqual([{ type: 'chunk', chunk: B }, { type: 'end' }]);
    expect(win.send).toHaveBeenCalledWith(UI_SPEECH_CUT_CHANNEL);
  });

  it('«Detener» (o empezar con la voz del sistema) desde una vista corta la descarga y avisa a la otra', async () => {
    const [win, card] = [view(), view()];
    const hub = new SpeechHub(fakeApi(vi.fn(async (_r, signal: AbortSignal) => hanging(signal))), () => [win, card]);
    const out = sink();
    await hub.speak(win, 'Hola', out.push);
    hub.stop(card);
    await out.closed;
    expect(out.events.at(-1)).toEqual({ type: 'error', reason: 'stopped' });
    expect(win.send).toHaveBeenCalledWith(UI_SPEECH_CUT_CHANNEL);
  });

  it('salir de la ayuda o Inicio callan todas las vistas; las cerradas se saltean', () => {
    const [win, card] = [view(), view()];
    card.isDestroyed.mockReturnValue(true);
    const hub = new SpeechHub(fakeApi(vi.fn()), () => [win, card]);
    hub.stopAll();
    expect(win.send).toHaveBeenCalledWith(UI_SPEECH_CUT_CHANNEL);
    expect(card.send).not.toHaveBeenCalled();
  });
});

describe('HttpApiClient.speak (streaming)', () => {
  const collect = async (iterable: AsyncIterable<Uint8Array>) => {
    const out: Uint8Array[] = [];
    for await (const chunk of iterable) out.push(chunk);
    return out;
  };

  it('manda { text } en JSON, pide audio/mpeg y entrega los pedazos a medida que llegan', async () => {
    const fetch = vi.fn(async () => streamingResponse([A, B]));
    const client = new HttpApiClient({ baseUrl: base, token: 'tok', fetch });
    const received = await collect(await client.speak({ text: ' Hola ' }, new AbortController().signal));
    expect(received).toEqual([A, B]);
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

  it('rechaza respuestas que no son MP3 o que llegan vacías', async () => {
    const notMp3 = new HttpApiClient({ baseUrl: base, token: null, fetch: vi.fn(async () => streamingResponse([A], 'application/json')) });
    await expect(notMp3.speak({ text: 'Hola' }, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const empty = new HttpApiClient({ baseUrl: base, token: null, fetch: vi.fn(async () => streamingResponse([])) });
    await expect(collect(await empty.speak({ text: 'Hola' }, new AbortController().signal))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('el retryable de AI_UNAVAILABLE y el TIMEOUT del servidor llegan hasta el Speaker', async () => {
    const off = new HttpApiClient({ baseUrl: base, token: null, fetch: vi.fn(async () => apiError(503, 'AI_UNAVAILABLE', false)) });
    await expect(new Speaker(off).speak('Hola', () => {})).resolves.toEqual({ status: 'error', reason: 'off' });
    for (const response of [() => apiError(503, 'AI_UNAVAILABLE', true), () => apiError(429, 'RATE_LIMITED', true), () => apiError(504, 'TIMEOUT', true)]) {
      const client = new HttpApiClient({ baseUrl: base, token: null, retries: 0, fetch: vi.fn(async () => response()) });
      await expect(new Speaker(client).speak('Hola', () => {})).resolves.toEqual({ status: 'error', reason: 'busy' });
    }
  });
});

describe('MockApiClient.speak', () => {
  it('manda tramas MP3 válidas en varios pedazos, más largas cuanto más texto', async () => {
    const mock = new MockApiClient({ fixturesOrigin: null, latencyMs: 0, chunkDelayMs: 0 });
    const join = async (iterable: AsyncIterable<Uint8Array>) => {
      const parts: Uint8Array[] = [];
      for await (const part of iterable) parts.push(part);
      return { parts, bytes: parts.reduce((n, p) => n + p.byteLength, 0) };
    };
    const short = await join(await mock.speak({ text: 'Hola' }, new AbortController().signal));
    const long = await join(await mock.speak({ text: 'palabra '.repeat(60) }, new AbortController().signal));
    expect([...short.parts[0]!.slice(0, 4)]).toEqual([0xff, 0xfb, 0x10, 0xc0]);
    expect(short.parts.length).toBeGreaterThan(1);
    expect(short.bytes % 104).toBe(0);
    expect(long.bytes).toBeGreaterThan(short.bytes);
    expect(silentMp3(1).byteLength).toBe(38 * 104);
  });

  it('«Detener» corta el streaming simulado', async () => {
    const mock = new MockApiClient({ fixturesOrigin: null, latencyMs: 0, chunkDelayMs: 1_000 });
    const controller = new AbortController();
    const iterator = (await mock.speak({ text: 'Hola' }, controller.signal))[Symbol.asyncIterator]();
    await iterator.next();
    const next = iterator.next();
    controller.abort();
    await expect(next).rejects.toMatchObject({ code: 'ABORTED' });
  });
});

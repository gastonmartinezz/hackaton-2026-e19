/**
 * Cliente HTTP contra la API publicada por Agustin. Valida respuestas al
 * recibir y reintenta poco: solo errores de red y los que el servidor marca
 * como `retryable`.
 */
import { randomUUID } from 'node:crypto';
import {
  ApiError,
  InterpretResponse,
  NextStepResponse,
  OptionsResponse,
  SiteCheckResponse,
  SPEAK_CONTENT_TYPE,
  SpeakRequest,
  TRANSCRIBE_CONTENT_TYPE,
  TRANSCRIBE_MAX_BYTES,
  TranscribeResponse,
} from '@hackaton/contracts';
import type { z } from 'zod';
import { isTranscribableWav } from '../../shared/wav';
import { log } from '../log';
import { ApiFailure, type ApiClient } from './client';

/** Cuerpo JSON máximo que acepta el servidor (docs/api.md). */
const MAX_BODY_BYTES = 512 * 1024;
/**
 * /v1/transcribe tiene un límite propio en el servidor (`bodyLimit`): el de
 * 512 KiB no aplica a ese camino. El servidor acepta además
 * TRANSCRIBE_HEADER_HEADROOM_BYTES para WAV con chunks extra, pero el cliente
 * manda siempre la cabecera canónica de 44 bytes: su máximo es
 * TRANSCRIBE_MAX_BYTES (960 044 bytes, un WAV de 30 s).
 */
const MAX_WAV_BODY_BYTES = TRANSCRIBE_MAX_BYTES;
/** MP3 máximo que se acepta de /v1/speak (600 caracteres son menos de un minuto de voz). */
const MAX_SPEECH_AUDIO_BYTES = 4 * 1024 * 1024;

type ReadBody = (response: Response) => Promise<unknown>;
/** Tiempo máximo y reintentos propios de un camino (por ejemplo, /v1/site-check). */
type SendOverrides = { timeoutMs?: number; retries?: number };
const readJson: ReadBody = (response) => response.json().catch(() => null);
/** Tiempo máximo de /v1/site-check; vencido, el indicador pasa a «No pudimos verificarlo». */
const SITE_CHECK_TIMEOUT_MS = 15_000;

export interface HttpClientOptions {
  baseUrl: URL;
  token: string | null;
  /** El backend espera hasta 30 s a Claude y su SDK reintenta: dejar margen. */
  timeoutMs?: number;
  retries?: number;
  fetch?: typeof fetch;
}

export class HttpApiClient implements ApiClient {
  readonly isMock = false;
  readonly #fetch: typeof fetch;

  constructor(private readonly config: HttpClientOptions) {
    this.#fetch = config.fetch ?? fetch;
  }

  async interpret(request: Parameters<ApiClient['interpret']>[0], signal: AbortSignal) {
    return this.#parse(InterpretResponse, await this.#post('/v1/interpret', request, signal));
  }

  async options(request: Parameters<ApiClient['options']>[0], signal: AbortSignal) {
    return this.#parse(OptionsResponse, await this.#post('/v1/options', request, signal));
  }

  async nextStep(request: Parameters<ApiClient['nextStep']>[0], signal: AbortSignal) {
    return this.#parse(NextStepResponse, await this.#post('/v1/next-step', request, signal));
  }

  /** El audio no se guarda ni se loguea: solo viaja en el cuerpo de esta solicitud. */
  async transcribe(wav: Uint8Array, signal: AbortSignal) {
    if (!isTranscribableWav(wav)) throw new ApiFailure('BAD_REQUEST', false);
    return this.#parse(TranscribeResponse, await this.#send('/v1/transcribe', new Uint8Array(wav), TRANSCRIBE_CONTENT_TYPE, MAX_WAV_BODY_BYTES, signal));
  }

  /**
   * El MP3 llega en streaming: se devuelve en pedazos apenas el servidor
   * acepta. El texto y el audio no se guardan ni se loguean.
   */
  async speak(request: SpeakRequest, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>> {
    const parsed = SpeakRequest.safeParse(request);
    if (!parsed.success) throw new ApiFailure('BAD_REQUEST', false);
    const stream = await this.#send('/v1/speak', JSON.stringify(parsed.data), 'application/json', MAX_BODY_BYTES, signal, readSpeechStream, SPEAK_CONTENT_TYPE);
    return stream as AsyncIterable<Uint8Array>;
  }

  /**
   * La revisión del sitio no puede hacer esperar a la persona: tiempo máximo
   * propio y sin reintentos automáticos (el coordinador decide y ofrece «Intentar de nuevo»).
   */
  async siteCheck(request: Parameters<ApiClient['siteCheck']>[0], signal: AbortSignal) {
    return this.#parse(SiteCheckResponse, await this.#post('/v1/site-check', request, signal, { timeoutMs: SITE_CHECK_TIMEOUT_MS, retries: 0 }));
  }

  #parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ApiFailure('INVALID_RESPONSE', false);
    return parsed.data;
  }

  async #post(path: string, payload: unknown, signal: AbortSignal, overrides: SendOverrides = {}): Promise<unknown> {
    return this.#send(path, JSON.stringify(payload), 'application/json', MAX_BODY_BYTES, signal, readJson, 'application/json', overrides);
  }

  /** Cada camino trae su límite: 512 KiB para JSON y 960 044 bytes para el WAV. */
  async #send(
    path: string,
    body: string | Uint8Array<ArrayBuffer>,
    contentType: string,
    maxBytes: number,
    signal: AbortSignal,
    readOk: ReadBody = readJson,
    accept = 'application/json',
    overrides: SendOverrides = {},
  ): Promise<unknown> {
    const size = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength;
    if (size > maxBytes) throw new ApiFailure('PAYLOAD_TOO_LARGE', false);
    const retries = overrides.retries ?? this.config.retries ?? 1;
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      try {
        const headers: Record<string, string> = {
          'content-type': contentType,
          accept,
          'x-request-id': randomUUID().replace(/-/g, ''),
        };
        if (this.config.token) headers.authorization = `Bearer ${this.config.token}`;
        const response = await this.#fetch(new URL(path, this.config.baseUrl), {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.any([signal, AbortSignal.timeout(overrides.timeoutMs ?? this.config.timeoutMs ?? 100_000)]),
        });
        log('api.response', { status: response.status, ms: Date.now() - started, attempt });
        if (response.ok) return await readOk(response);
        const json: unknown = await response.json().catch(() => null);
        const error = ApiError.safeParse(json);
        throw error.success
          ? new ApiFailure(error.data.error.code, error.data.error.retryable)
          : new ApiFailure(statusCode(response.status), response.status === 429 || response.status === 503 || response.status === 504);
      } catch (error) {
        const failure = toFailure(error, signal);
        log('api.error', { code: `code:${failure.code}`, ms: Date.now() - started, attempt });
        if (!failure.retryable || attempt >= retries || signal.aborted) throw failure;
        await delay(400 * 2 ** attempt + Math.random() * 200, signal);
      }
    }
  }
}

/**
 * MP3 de /v1/speak: se revisa el tipo y el tamaño declarado antes de
 * entregarlo, y el tamaño real mientras llega (no vacío, máximo 4 MB).
 */
async function readSpeechStream(response: Response): Promise<AsyncIterable<Uint8Array>> {
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith(SPEAK_CONTENT_TYPE)) throw new ApiFailure('INVALID_RESPONSE', false);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_SPEECH_AUDIO_BYTES || !response.body) throw new ApiFailure('INVALID_RESPONSE', false);
  return speechChunks(response.body);
}

async function* speechChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read().catch((error: unknown) => {
        throw error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError') ? new ApiFailure('ABORTED', false) : new ApiFailure('NETWORK', false);
      });
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > MAX_SPEECH_AUDIO_BYTES) throw new ApiFailure('INVALID_RESPONSE', false);
      yield value;
    }
    if (total === 0) throw new ApiFailure('INVALID_RESPONSE', false);
  } finally {
    // Si se corta (Detener, otra lectura, error), se libera la conexión.
    await reader.cancel().catch(() => undefined);
  }
}

function statusCode(status: number) {
  if (status === 401 || status === 403) return 'UNAUTHORIZED' as const;
  if (status === 404) return 'NOT_FOUND' as const;
  if (status === 413) return 'PAYLOAD_TOO_LARGE' as const;
  if (status === 429) return 'RATE_LIMITED' as const;
  if (status === 503) return 'AI_UNAVAILABLE' as const;
  if (status === 504) return 'TIMEOUT' as const;
  if (status >= 500) return 'INTERNAL' as const;
  return 'BAD_REQUEST' as const;
}

function toFailure(error: unknown, signal: AbortSignal): ApiFailure {
  if (error instanceof ApiFailure) return error;
  if (signal.aborted) return new ApiFailure('ABORTED', false);
  if (error instanceof Error && error.name === 'TimeoutError') return new ApiFailure('TIMEOUT', true);
  return new ApiFailure('NETWORK', true);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new ApiFailure('ABORTED', false));
      },
      { once: true },
    );
  });
}

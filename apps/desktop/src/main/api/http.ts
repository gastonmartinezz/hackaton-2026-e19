/**
 * Cliente HTTP contra la API publicada por Agustin. Valida tamaños antes de
 * enviar y respuestas al recibir; reintenta poco y solo fallos transitorios.
 */
import { randomUUID } from 'node:crypto';
import {
  ApiErrorSchema,
  DestinationSearchResponseSchema,
  HEADERS,
  InterpretIntentResponseSchema,
  LIMITS,
  SCHEMA_VERSION,
} from '@asistente/contracts';
import type { z } from 'zod';
import { log } from '../log';
import { ApiFailure, type ApiClient } from './client';

export interface HttpClientOptions {
  baseUrl: URL;
  token: string | null;
  timeoutMs?: number;
  retries?: number;
  fetch?: typeof fetch;
}

export class HttpApiClient implements ApiClient {
  readonly isMock = false;
  #sessionId = randomUUID();
  readonly #fetch: typeof fetch;

  constructor(private readonly options: HttpClientOptions) {
    this.#fetch = options.fetch ?? fetch;
  }

  async interpretIntent(request: Parameters<ApiClient['interpretIntent']>[0], signal: AbortSignal) {
    const body = await this.#post('/v1/intents/interpret', request, signal);
    return this.#parse(InterpretIntentResponseSchema, body, request.requestId);
  }

  async searchDestinations(request: Parameters<ApiClient['searchDestinations']>[0], signal: AbortSignal) {
    const body = await this.#post('/v1/destinations/search', request, signal);
    const parsed = this.#parse(DestinationSearchResponseSchema, body, request.requestId);
    if (parsed.recommendedId && !parsed.candidates.some((c) => c.id === parsed.recommendedId)) {
      // Toda recomendación debe apuntar a un resultado recibido.
      return { ...parsed, recommendedId: null };
    }
    return parsed;
  }

  pageOptions(request: Parameters<ApiClient['pageOptions']>[0], signal: AbortSignal) {
    return this.#post('/v1/pages/options', request, signal);
  }

  guidanceNext(request: Parameters<ApiClient['guidanceNext']>[0], signal: AbortSignal) {
    return this.#post('/v1/guidance/next', request, signal);
  }

  async endSession(): Promise<void> {
    const id = this.#sessionId;
    this.#sessionId = randomUUID();
    try {
      await this.#fetch(new URL(`/v1/sessions/${encodeURIComponent(id)}`, this.options.baseUrl), {
        method: 'DELETE',
        headers: this.#headers(),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // El servidor borra igual las sesiones por vencimiento.
    }
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      [HEADERS.session]: this.#sessionId,
      [HEADERS.schemaVersion]: SCHEMA_VERSION,
    };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    return headers;
  }

  #parse<T extends z.ZodType>(schema: T, body: unknown, requestId: string): z.infer<T> {
    const parsed = schema.safeParse(body);
    if (!parsed.success || (parsed.data as { requestId?: string }).requestId !== requestId) {
      throw new ApiFailure('invalid_response', false);
    }
    return parsed.data;
  }

  async #post(path: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > LIMITS.requestBytes) throw new ApiFailure('payload_too_large', false);

    const retries = this.options.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      try {
        const response = await this.#fetch(new URL(path, this.options.baseUrl), {
          method: 'POST',
          headers: this.#headers(),
          body,
          signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs ?? 20_000)]),
        });
        log('api.response', { status: response.status, ms: Date.now() - started, attempt });
        const json: unknown = await response.json().catch(() => null);
        if (response.ok) return json;
        const error = ApiErrorSchema.safeParse(json);
        const failure = error.success
          ? new ApiFailure(error.data.error.code, error.data.error.retryable)
          : new ApiFailure(statusCode(response.status), response.status === 429 || response.status >= 500);
        throw failure;
      } catch (error) {
        const failure = toFailure(error, signal);
        log('api.error', { code: `code:${failure.code}`, ms: Date.now() - started, attempt });
        if (!failure.retryable || attempt >= retries || signal.aborted) throw failure;
        await delay(400 * 2 ** attempt + Math.random() * 200, signal);
      }
    }
  }
}

function statusCode(status: number) {
  if (status === 401 || status === 403) return 'unauthorized' as const;
  if (status === 413) return 'payload_too_large' as const;
  if (status === 429) return 'rate_limited' as const;
  if (status >= 500) return 'provider_unavailable' as const;
  return 'bad_request' as const;
}

function toFailure(error: unknown, signal: AbortSignal): ApiFailure {
  if (error instanceof ApiFailure) return error;
  if (signal.aborted) return new ApiFailure('aborted', false);
  if (error instanceof Error && error.name === 'TimeoutError') return new ApiFailure('timeout', true);
  return new ApiFailure('network', true);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new ApiFailure('aborted', false));
      },
      { once: true },
    );
  });
}

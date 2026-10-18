import { Readable } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { SpeechProvider } from './provider.js';

export type TtsStatus = 'off' | 'ready';

/**
 * Texto a voz. Espera el primer pedazo de audio antes de responder, así un fallo
 * del proveedor todavía sale como `ApiError` con su código; después reenvía el
 * resto a medida que llega.
 *
 * Privacidad (S05): ni el texto ni el audio se registran ni se guardan. Solo
 * caracteres, tiempo al primer byte, latencia total, bytes y resultado.
 */
export class SpeakService {
  constructor(
    private readonly provider: SpeechProvider | null,
    private readonly log: FastifyBaseLogger,
  ) {}

  get status(): TtsStatus {
    return this.provider ? 'ready' : 'off';
  }

  async speak(
    text: string,
    { signal = new AbortController().signal, log = this.log }: { signal?: AbortSignal; log?: FastifyBaseLogger } = {},
  ): Promise<Readable> {
    const startedAt = performance.now();
    const chars = text.length;
    const elapsed = () => Math.round(performance.now() - startedAt);
    const report = (fields: { outcome: string; ttfbMs?: number; bytes?: number }) =>
      log.info({ chars, latencyMs: elapsed(), ...fields }, 'speak');

    const provider = this.provider;
    if (!provider) {
      report({ outcome: 'AI_UNAVAILABLE' });
      throw new AppError('AI_UNAVAILABLE', 'La voz está desactivada', undefined, false);
    }

    let iterator: AsyncIterator<Uint8Array>;
    let first: IteratorResult<Uint8Array>;
    try {
      const audio = await provider.speak(text, signal);
      iterator = audio[Symbol.asyncIterator]();
      first = await iterator.next();
    } catch (error) {
      const appError = signal.aborted
        ? new AppError('TIMEOUT', 'La voz se canceló')
        : error instanceof AppError
          ? error
          : new AppError('AI_UNAVAILABLE', 'La voz no está disponible');
      report({ outcome: appError.code });
      throw appError;
    }
    if (first.done) {
      report({ outcome: 'AI_UNAVAILABLE' });
      throw new AppError('AI_UNAVAILABLE', 'La voz respondió sin audio');
    }
    const ttfbMs = elapsed();

    async function* relay(): AsyncGenerator<Uint8Array> {
      let bytes = 0;
      let outcome = 'OK';
      try {
        bytes += first.value.byteLength;
        yield first.value;
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
          bytes += next.value.byteLength;
          yield next.value;
        }
      } catch {
        outcome = signal.aborted ? 'CLIENT_CLOSED' : 'STREAM_ERROR';
        throw new AppError('AI_UNAVAILABLE', 'La voz se cortó');
      } finally {
        // Si la persona cortó antes del final, el generador termina por acá sin pasar por catch.
        if (outcome === 'OK' && signal.aborted) outcome = 'CLIENT_CLOSED';
        await iterator.return?.();
        report({ outcome, ttfbMs, bytes });
      }
    }

    return Readable.from(relay(), { objectMode: false });
  }
}

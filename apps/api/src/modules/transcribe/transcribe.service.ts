import { TranscribeResponse } from '@hackaton/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { SttStatus, TranscriptionProvider } from './provider.js';
import { QueueAbortedError, QueueFullError, TaskQueue } from './task-queue.js';
import { decodeWav } from './wav.js';

export interface TranscribeServiceOptions {
  timeoutMs: number;
  concurrency: number;
  maxQueued: number;
}

const MAX_TEXT_LENGTH = 1000;
/** RMS por debajo de -60 dBFS: silencio digital o ruido de fondo; no vale la pena llamar al proveedor. */
const SILENCE_RMS = 0.001;

/**
 * Orquesta la transcripción: valida el WAV, ordena las solicitudes en una cola
 * acotada, aplica el timeout y limpia el texto.
 *
 * Privacidad (S05): el audio y el texto solo viven en memoria durante la
 * solicitud. Se registran únicamente duración del audio, latencia y resultado.
 */
export class TranscribeService {
  private readonly queue: TaskQueue;

  constructor(
    private readonly provider: TranscriptionProvider | null,
    private readonly options: TranscribeServiceOptions,
    private readonly log: FastifyBaseLogger,
  ) {
    this.queue = new TaskQueue(options.concurrency, options.maxQueued);
  }

  get status(): SttStatus {
    return this.provider ? 'ready' : 'off';
  }

  /** `log` permite correlacionar la métrica con la solicitud (requestId); por defecto, el del servicio. */
  async transcribe(
    body: unknown,
    { signal: clientSignal, log = this.log }: { signal?: AbortSignal; log?: FastifyBaseLogger } = {},
  ): Promise<TranscribeResponse> {
    const startedAt = performance.now();
    let audioMs: number | undefined;
    let outcome = 'OK';
    try {
      const text = await this.run(body, clientSignal, (ms) => (audioMs = ms));
      if (!text) outcome = 'EMPTY';
      return TranscribeResponse.parse({ text });
    } catch (error) {
      outcome = error instanceof AppError ? error.code : 'INTERNAL';
      throw error;
    } finally {
      log.info({ audioMs, latencyMs: Math.round(performance.now() - startedAt), outcome }, 'transcribe');
    }
  }

  private async run(body: unknown, clientSignal: AbortSignal | undefined, onDecoded: (ms: number) => void): Promise<string> {
    const provider = this.provider;
    if (!provider) {
      throw new AppError('AI_UNAVAILABLE', 'La transcripción de voz está desactivada', undefined, false);
    }
    if (!Buffer.isBuffer(body)) throw new AppError('BAD_REQUEST', 'Se espera un cuerpo audio/wav');

    const { samples, durationMs } = decodeWav(body);
    onDecoded(durationMs);
    if (rms(samples) < SILENCE_RMS) return '';

    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const signal = clientSignal ? AbortSignal.any([timeout, clientSignal]) : timeout;
    try {
      const raw = await this.queue.run(() => provider.transcribe(body, signal), signal);
      return cleanTranscript(raw);
    } catch (error) {
      if (error instanceof QueueFullError) {
        throw new AppError('AI_UNAVAILABLE', 'La transcripción está ocupada');
      }
      if (error instanceof QueueAbortedError || signal.aborted) {
        throw new AppError('TIMEOUT', 'La transcripción tardó demasiado');
      }
      throw error;
    }
  }
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/** Frases que los modelos de transcripción inventan con silencio o ruido (vienen de subtítulos de su entrenamiento). */
const HALLUCINATIONS = [
  /amara\.org/i,
  /^subt[ií]tulos? (realizados? )?por/i,
  /^¡?gracias por (ver|mirar)( el v[ií]deo)?[.!]*$/i,
  /^¡?suscr[ií]bete/i,
];

/** Espacios normalizados, sin anotaciones de no-habla ([Música], ♪) ni alucinaciones conocidas, hasta 1000 caracteres. */
export function cleanTranscript(raw: string): string {
  const text = raw
    .replace(/\[[^\]]*\]|♪+/g, ' ')
    .replace(/\((m[uú]sica|risas|aplausos|silencio|ruido)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || /^[\s.,;:!?¡¿…-]*$/.test(text)) return '';
  if (HALLUCINATIONS.some((pattern) => pattern.test(text))) return '';
  return truncate(text, MAX_TEXT_LENGTH).trim();
}

/** Corta en unidades UTF-16 (lo que cuenta el contrato) sin dejar un surrogate suelto al final. */
function truncate(text: string, max: number): string {
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

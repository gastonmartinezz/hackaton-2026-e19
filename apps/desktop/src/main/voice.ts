/**
 * Dictado del buscador: recibe el WAV de la interfaz, lo revisa y lo pasa a
 * texto con POST /v1/transcribe. El texto vuelve al buscador para que la
 * persona lo revise; nunca se envía la búsqueda desde acá.
 *
 * Privacidad: el audio y el texto solo viven en memoria durante la solicitud.
 * No se guardan en disco ni se loguean (solo códigos y duración).
 */
import { isTranscribableWav } from '../shared/wav';
import type { TranscribeErrorReason, TranscribeResult } from '../shared/ipc';
import { ApiFailure, type ApiClient } from './api/client';
import { log } from './log';

/** Igual que el máximo del campo del buscador (submitIntent). */
export const MAX_TRANSCRIPT_CHARS = 500;
const TIMEOUT_MS = 45_000;

/** Bytes del audio tal como llegan por IPC (ArrayBuffer o vista), o null si es otra cosa. */
export function audioBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof ArrayBuffer || Object.prototype.toString.call(raw) === '[object ArrayBuffer]') return new Uint8Array(raw as ArrayBuffer);
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  return null;
}

/** Texto para el buscador: una sola línea, sin espacios de más y con el largo del campo. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TRANSCRIPT_CHARS)
    .trim();
}

/**
 * Qué decirle a la interfaz según el error. Se usa el `retryable` que mandó el
 * servidor, no se deduce del código: AI_UNAVAILABLE sin reintento es la voz
 * apagada en el servidor (STT_PROVIDER=off).
 */
export function transcribeErrorReason(error: unknown): TranscribeErrorReason {
  if (!(error instanceof ApiFailure)) return 'failed';
  if (error.code === 'AI_UNAVAILABLE') return error.retryable ? 'busy' : 'off';
  return error.code === 'RATE_LIMITED' ? 'busy' : 'failed';
}

export class Transcriber {
  #current: AbortController | null = null;
  /** La voz está apagada en el servidor: no se vuelve a pedir en esta ejecución. */
  #off = false;

  constructor(private readonly api: ApiClient) {}

  /** Una sola solicitud a la vez: una nueva cancela la anterior. */
  async transcribe(raw: unknown): Promise<TranscribeResult> {
    if (this.#off) return { status: 'error', reason: 'off' };
    const wav = audioBytes(raw);
    if (!wav || !isTranscribableWav(wav)) {
      log('voice.invalid_audio');
      return { status: 'error', reason: 'failed' };
    }
    this.#current?.abort();
    const controller = new AbortController();
    this.#current = controller;
    const started = Date.now();
    try {
      const response = await this.api.transcribe(wav, AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]));
      const text = cleanTranscript(response.text);
      log('voice.transcribed', { ms: Date.now() - started, empty: text === '' });
      return text ? { status: 'ok', text } : { status: 'empty' };
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : 'INTERNAL';
      log('voice.error', { code: `code:${code}`, ms: Date.now() - started });
      const reason = transcribeErrorReason(error);
      if (reason === 'off') this.#off = true;
      return { status: 'error', reason };
    } finally {
      if (this.#current === controller) this.#current = null;
    }
  }

  cancel(): void {
    this.#current?.abort();
    this.#current = null;
  }
}

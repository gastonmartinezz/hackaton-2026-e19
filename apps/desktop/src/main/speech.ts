/**
 * Leer en voz alta: la interfaz pide un texto de Mostrame y el proceso
 * principal lo pasa a audio con POST /v1/speak. Solo una lectura a la vez:
 * una nueva (o «Detener») cancela la anterior.
 *
 * Privacidad: el texto y el audio solo viven en memoria durante la solicitud.
 * No se guardan en disco ni se loguean (solo códigos y duración).
 */
import { clipForSpeech } from '../shared/speech';
import type { SpeakErrorReason, SpeakResult } from '../shared/ipc';
import { ApiFailure, type ApiClient } from './api/client';
import { log } from './log';

const TIMEOUT_MS = 30_000;

/**
 * Qué decirle a la interfaz según el error. Se usa el `retryable` que mandó el
 * servidor: AI_UNAVAILABLE sin reintento es la voz apagada en el servidor.
 */
export function speakErrorReason(error: unknown): Exclude<SpeakErrorReason, 'stopped'> {
  if (!(error instanceof ApiFailure)) return 'failed';
  if (error.code === 'AI_UNAVAILABLE') return error.retryable ? 'busy' : 'off';
  return error.code === 'RATE_LIMITED' ? 'busy' : 'failed';
}

export class Speaker {
  #current: AbortController | null = null;
  /** La voz está apagada en el servidor: no se vuelve a pedir en esta ejecución. */
  #off = false;

  constructor(private readonly api: ApiClient) {}

  async speak(raw: unknown): Promise<SpeakResult> {
    if (this.#off) return { status: 'error', reason: 'off' };
    const text = typeof raw === 'string' ? clipForSpeech(raw) : '';
    if (!text) {
      log('speech.invalid_text');
      return { status: 'error', reason: 'failed' };
    }
    this.stop();
    const controller = new AbortController();
    this.#current = controller;
    const started = Date.now();
    try {
      const audio = await this.api.speak({ text }, AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]));
      if (controller.signal.aborted) return { status: 'error', reason: 'stopped' };
      log('speech.audio', { ms: Date.now() - started, bytes: audio.byteLength });
      return { status: 'ok', audio };
    } catch (error) {
      // Solo es «stopped» si la cortó la persona (o una lectura nueva); un timeout es un error.
      const reason = controller.signal.aborted ? 'stopped' : speakErrorReason(error);
      const code = error instanceof ApiFailure ? error.code : 'INTERNAL';
      if (reason !== 'stopped') log('speech.error', { code: `code:${code}`, ms: Date.now() - started });
      if (reason === 'off') this.#off = true;
      return { status: 'error', reason };
    } finally {
      if (this.#current === controller) this.#current = null;
    }
  }

  /** «Detener», otra instrucción o la tarjeta cerrada: corta la descarga en curso. */
  stop(): void {
    this.#current?.abort();
    this.#current = null;
  }
}

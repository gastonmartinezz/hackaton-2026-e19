/**
 * Leer en voz alta: la interfaz pide un texto de Mostrame y el proceso
 * principal lo pasa a audio con POST /v1/speak. Una sola lectura en toda la
 * app: una nueva (o «Detener») cancela la descarga anterior y `SpeechHub`
 * avisa a las demás vistas (ventana y tarjeta) que corten lo que suena.
 *
 * Privacidad: el texto y el audio solo viven en memoria durante la solicitud.
 * No se guardan en disco ni se loguean (solo códigos y duración).
 */
import { clipForSpeech } from '../shared/speech';
import { UI_SPEECH_CUT_CHANNEL, type SpeakErrorReason, type SpeakResult } from '../shared/ipc';
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

/** Una vista propia de Mostrame (la ventana o la tarjeta), como la ve el hub. */
export interface SpeechView {
  send(channel: string): void;
  isDestroyed(): boolean;
}

/**
 * Coordina la lectura entre vistas. La reproducción vive en cada vista; el
 * hub se asegura de que suene una sola: cuando una vista empieza a leer (con
 * el servidor o con la voz del sistema) o se detiene, las demás reciben
 * UI_SPEECH_CUT_CHANNEL, cortan y vuelven a «Escuchar».
 */
export class SpeechHub {
  readonly #speaker: Speaker;

  constructor(
    api: ApiClient,
    private readonly views: () => SpeechView[],
  ) {
    this.#speaker = new Speaker(api);
  }

  /** Lectura nueva desde `from`: se corta la descarga anterior y callan las demás vistas. */
  speak(from: SpeechView, raw: unknown): Promise<SpeakResult> {
    this.#cutOthers(from);
    return this.#speaker.speak(raw);
  }

  /** «Detener», o `from` va a leer con la voz del sistema: corta la descarga y las demás vistas. */
  stop(from: SpeechView): void {
    this.#speaker.stop();
    this.#cutOthers(from);
  }

  /** Salir de la ayuda, Inicio o la ventana se cierra: calla todo. */
  stopAll(): void {
    this.#speaker.stop();
    this.#cutOthers(null);
  }

  #cutOthers(from: SpeechView | null): void {
    for (const view of this.views()) if (view !== from && !view.isDestroyed()) view.send(UI_SPEECH_CUT_CHANNEL);
  }
}

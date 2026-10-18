/**
 * Leer en voz alta: la interfaz pide un texto de Guíame y el proceso
 * principal lo pasa a audio con POST /v1/speak. El MP3 llega en streaming y
 * se reenvía a la vista en pedazos (`SpeechSink`) para que empiece a sonar
 * apenas llegan los primeros datos.
 *
 * Una sola lectura en toda la app: una nueva (o «Detener») cancela la
 * descarga anterior y `SpeechHub` avisa a las demás vistas (ventana y
 * tarjeta) que corten lo que suena.
 *
 * Privacidad: el texto y el audio solo viven en memoria durante la solicitud.
 * No se guardan en disco ni se loguean (solo códigos, tiempos y bytes).
 */
import { clipForSpeech } from '../shared/speech';
import { UI_SPEECH_CUT_CHANNEL, type SpeakErrorReason, type SpeakResult, type SpeechAudioEvent } from '../shared/ipc';
import { ApiFailure, type ApiClient } from './api/client';
import { log } from './log';

/** Tope total de una lectura (pedido + streaming). */
const TIMEOUT_MS = 60_000;

/** A dónde van los pedazos de audio de una lectura (la vista que la pidió). */
export type SpeechSink = (event: SpeechAudioEvent) => void;

/**
 * Qué decirle a la interfaz según el error. Se usa el `retryable` que mandó el
 * servidor: AI_UNAVAILABLE sin reintento es la voz apagada en el servidor. Los
 * reintentables (AI_UNAVAILABLE con reintento, RATE_LIMITED y TIMEOUT, que el
 * servidor manda si OpenAI se cuelga) son «ocupado».
 */
export function speakErrorReason(error: unknown): Exclude<SpeakErrorReason, 'stopped'> {
  if (!(error instanceof ApiFailure)) return 'failed';
  if (error.code === 'AI_UNAVAILABLE') return error.retryable ? 'busy' : 'off';
  return error.code === 'RATE_LIMITED' || error.code === 'TIMEOUT' ? 'busy' : 'failed';
}

export class Speaker {
  #current: AbortController | null = null;
  /** La voz está apagada en el servidor: no se vuelve a pedir en esta ejecución. */
  #off = false;

  constructor(private readonly api: ApiClient) {}

  /**
   * Resuelve cuando el servidor aceptó (o falló antes de mandar audio). Los
   * pedazos siguen llegando a `sink` hasta `end` o `error`.
   */
  async speak(raw: unknown, sink: SpeechSink): Promise<SpeakResult> {
    if (this.#off) return { status: 'error', reason: 'off' };
    const text = typeof raw === 'string' ? clipForSpeech(raw) : '';
    if (!text) {
      log('speech.invalid_text');
      return { status: 'error', reason: 'failed' };
    }
    this.stop();
    const controller = new AbortController();
    this.#current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]);
    const started = Date.now();
    const release = () => {
      if (this.#current === controller) this.#current = null;
    };
    let chunks: AsyncIterable<Uint8Array>;
    try {
      chunks = await this.api.speak({ text }, signal);
    } catch (error) {
      release();
      return this.#failure(error, controller, started);
    }
    if (controller.signal.aborted) {
      release();
      return { status: 'error', reason: 'stopped' };
    }
    void this.#pump(chunks, sink, controller, started).finally(release);
    return { status: 'ok' };
  }

  /** «Detener», otra lectura o la vista se cierra: corta la descarga en curso. */
  stop(): void {
    this.#current?.abort();
    this.#current = null;
  }

  async #pump(chunks: AsyncIterable<Uint8Array>, sink: SpeechSink, controller: AbortController, started: number): Promise<void> {
    let bytes = 0;
    let firstMs: number | null = null;
    try {
      for await (const chunk of chunks) {
        if (controller.signal.aborted) break;
        firstMs ??= Date.now() - started;
        bytes += chunk.byteLength;
        sink({ type: 'chunk', chunk });
      }
      if (controller.signal.aborted) return sink({ type: 'error', reason: 'stopped' });
      log('speech.audio', { firstMs, ms: Date.now() - started, bytes });
      sink({ type: 'end' });
    } catch (error) {
      const result = this.#failure(error, controller, started);
      sink({ type: 'error', reason: result.status === 'error' && result.reason === 'stopped' ? 'stopped' : 'failed' });
    }
  }

  #failure(error: unknown, controller: AbortController, started: number): SpeakResult {
    // Solo es «stopped» si la cortó la persona (o una lectura nueva); un timeout es un error.
    if (controller.signal.aborted) return { status: 'error', reason: 'stopped' };
    const reason = speakErrorReason(error);
    const code = error instanceof ApiFailure ? error.code : 'INTERNAL';
    log('speech.error', { code: `code:${code}`, ms: Date.now() - started });
    if (reason === 'off') this.#off = true;
    return { status: 'error', reason };
  }
}

/** Una vista propia de Guíame (la ventana o la tarjeta), como la ve el hub. */
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
  speak(from: SpeechView, raw: unknown, sink: SpeechSink): Promise<SpeakResult> {
    this.#cutOthers(from);
    return this.#speaker.speak(raw, sink);
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

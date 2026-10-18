/**
 * Cuándo dejar de escuchar: a los 30 s, o después de 5 s seguidos sin hablar.
 * Detección simple por energía (RMS).
 * - Si la persona habló y después hace 5 s de silencio → `silence` (se
 *   transcribe y se busca).
 * - Si no habló nada en los primeros 5 s → `noSpeech` («no te escuché», no se
 *   manda nada al servidor).
 * Las pausas más cortas (pensar, respirar) no cortan.
 */
import { WAV_MAX_SECONDS } from '../../../shared/wav';

export interface SilenceOptions {
  /** RMS desde el que se considera que hay voz. */
  threshold: number;
  silenceMs: number;
  maxMs: number;
}

export const SILENCE_DEFAULTS: SilenceOptions = {
  threshold: 0.015,
  silenceMs: 5_000,
  // Un poco antes de 30 s: el WAV final nunca supera el máximo del servidor.
  maxMs: WAV_MAX_SECONDS * 1000 - 300,
};

export type SilenceVerdict = 'continue' | 'silence' | 'noSpeech' | 'limit';

export class SilenceDetector {
  #start: number | null = null;
  #lastVoice: number | null = null;

  constructor(private readonly options: SilenceOptions = SILENCE_DEFAULTS) {}

  get heardVoice(): boolean {
    return this.#lastVoice !== null;
  }

  /** Una medición de energía en el instante `now` (ms). */
  push(level: number, now: number): SilenceVerdict {
    this.#start ??= now;
    if (now - this.#start >= this.options.maxMs) return 'limit';
    if (level >= this.options.threshold) {
      this.#lastVoice = now;
      return 'continue';
    }
    if (this.#lastVoice === null) return now - this.#start >= this.options.silenceMs ? 'noSpeech' : 'continue';
    return now - this.#lastVoice >= this.options.silenceMs ? 'silence' : 'continue';
  }
}

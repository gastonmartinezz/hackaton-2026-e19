/**
 * Cuándo dejar de escuchar: a los 30 s, o después de 5 s seguidos sin hablar.
 * - Si la persona habló y después hace 5 s de silencio → `silence` (se
 *   transcribe).
 * - Si no habló nada en los primeros 5 s → `noSpeech` («no te escuché», no se
 *   manda nada al servidor).
 * Las pausas más cortas (pensar, respirar) no cortan.
 *
 * Umbral adaptativo: con un micrófono real el ruido de fondo (ambiente,
 * ventilador, el propio procesamiento) puede quedar por encima de un umbral
 * fijo y nunca se detectaba el silencio. Ahora:
 * - el nivel se suaviza (promedio de los últimos 300 ms);
 * - el piso de ruido se calibra con los primeros ~300 ms y después sigue el
 *   mínimo (si el ambiente se calma, baja);
 * - hay voz si el nivel supera el piso con margen (×3, y al menos el mínimo
 *   absoluto) y además no está muy por debajo de la voz ya escuchada (25 % del
 *   pico, que decae de a poco para que un golpe no tape lo demás).
 */
import { WAV_MAX_SECONDS } from '../../../shared/wav';

export interface SilenceOptions {
  /** Umbral mínimo absoluto (sala en silencio total). */
  minThreshold: number;
  /** Cuántas veces por encima del piso de ruido tiene que estar la voz. */
  floorFactor: number;
  /** Margen mínimo sobre el piso. */
  floorMargin: number;
  /** Fracción del pico de voz ya escuchado por debajo de la cual es silencio. */
  peakRatio: number;
  /** Decaimiento del pico por medición (100 ms). */
  peakDecay: number;
  /** Mediciones que se promedian (100 ms cada una). */
  smoothFrames: number;
  /** Calibración del piso de ruido al empezar. */
  calibrationMs: number;
  silenceMs: number;
  maxMs: number;
}

export const SILENCE_DEFAULTS: SilenceOptions = {
  minThreshold: 0.015,
  floorFactor: 3,
  floorMargin: 0.01,
  peakRatio: 0.25,
  peakDecay: 0.995,
  smoothFrames: 3,
  calibrationMs: 300,
  silenceMs: 5_000,
  // Un poco antes de 30 s: el WAV final nunca supera el máximo del servidor.
  maxMs: WAV_MAX_SECONDS * 1000 - 300,
};

export type SilenceVerdict = 'continue' | 'silence' | 'noSpeech' | 'limit';

/** Números para el diagnóstico (sin audio): piso, umbral y pico de voz. */
export interface SilenceStats {
  floor: number;
  threshold: number;
  peak: number;
}

export class SilenceDetector {
  #start: number | null = null;
  #lastVoice: number | null = null;
  readonly #recent: number[] = [];
  #floor: number | null = null;
  #peak = 0;
  #threshold: number;

  constructor(private readonly options: SilenceOptions = SILENCE_DEFAULTS) {
    this.#threshold = options.minThreshold;
  }

  get heardVoice(): boolean {
    return this.#lastVoice !== null;
  }

  get stats(): SilenceStats {
    return { floor: this.#floor ?? 0, threshold: this.#threshold, peak: this.#peak };
  }

  /** Una medición de energía (RMS de ~100 ms) en el instante `now` (ms). */
  push(level: number, now: number): SilenceVerdict {
    this.#start ??= now;
    const elapsed = now - this.#start;
    if (elapsed >= this.options.maxMs) return 'limit';

    this.#recent.push(level);
    if (this.#recent.length > this.options.smoothFrames) this.#recent.shift();
    const smoothed = this.#recent.reduce((sum, value) => sum + value, 0) / this.#recent.length;

    // Calibración: el piso arranca en el nivel más bajo de los primeros ~300 ms.
    this.#floor = Math.min(this.#floor ?? Infinity, elapsed < this.options.calibrationMs ? level : smoothed);
    if (elapsed < this.options.calibrationMs) return 'continue';

    const { floorFactor, floorMargin, minThreshold, peakRatio, peakDecay } = this.options;
    this.#threshold = Math.max(minThreshold, this.#floor * floorFactor, this.#floor + floorMargin);
    this.#peak *= peakDecay;
    const voice = smoothed >= this.#threshold && smoothed >= this.#peak * peakRatio;
    if (voice) {
      this.#lastVoice = now;
      this.#peak = Math.max(this.#peak, smoothed);
      return 'continue';
    }
    if (this.#lastVoice === null) return elapsed >= this.options.silenceMs ? 'noSpeech' : 'continue';
    return now - this.#lastVoice >= this.options.silenceMs ? 'silence' : 'continue';
  }
}

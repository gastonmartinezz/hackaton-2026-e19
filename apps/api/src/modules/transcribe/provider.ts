/** Estado del motor de voz a texto. Se expone en /health; nunca incluye contenido. */
export type SttStatus = 'off' | 'loading' | 'ready' | 'failed';

/** Audio ya validado (WAV PCM 16 bits, mono, 16 kHz). Solo vive en memoria durante la solicitud. */
export interface TranscriptionAudio {
  /** Muestras normalizadas a [-1, 1), para modelos locales. */
  pcm: Float32Array;
  /** El WAV tal como llegó, para proveedores que lo reciben entero (OpenAI). */
  wav: Buffer;
  durationMs: number;
}

export interface TranscriptionProvider {
  /** `loading` mientras se carga el modelo; `failed` si la carga falló y se reintenta. Los remotos siempre están `ready`. */
  readonly status: Exclude<SttStatus, 'off'>;
  /**
   * Devuelve el texto tal como sale del modelo; el servicio lo limpia. `signal`
   * se aborta por timeout o porque la persona cortó la conexión.
   */
  transcribe(audio: TranscriptionAudio, signal: AbortSignal): Promise<string>;
  close?(): Promise<void>;
}

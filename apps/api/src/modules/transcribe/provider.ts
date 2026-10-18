/** Estado del motor de voz a texto. Se expone en /health; nunca incluye contenido. */
export type SttStatus = 'off' | 'loading' | 'ready' | 'failed';

export interface TranscriptionProvider {
  /** `loading` mientras se carga el modelo; `failed` si la carga falló y se reintenta. */
  readonly status: Exclude<SttStatus, 'off'>;
  /**
   * Transcribe PCM mono a 16 kHz normalizado a [-1, 1). Devuelve el texto tal
   * como sale del modelo; el servicio lo limpia. `signal` se aborta por timeout
   * o porque la persona cortó la conexión.
   */
  transcribe(pcm: Float32Array, signal: AbortSignal): Promise<string>;
  close?(): Promise<void>;
}

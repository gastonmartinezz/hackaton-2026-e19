/** Estado de la voz a texto. Se expone en /health; nunca incluye contenido. */
export type SttStatus = 'off' | 'ready';

export interface TranscriptionProvider {
  /**
   * Transcribe un WAV ya validado (PCM 16 bits, mono, 16 kHz). Devuelve el texto
   * tal como sale del proveedor; el servicio lo limpia. `signal` se aborta por
   * timeout o porque la persona cortó la conexión.
   */
  transcribe(wav: Buffer, signal: AbortSignal): Promise<string>;
}

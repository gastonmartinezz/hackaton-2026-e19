export interface SpeechProvider {
  /**
   * Genera MP3 para `text`. La promesa se resuelve cuando el proveedor empezó a
   * responder; el audio llega por partes en el iterable. `signal` se aborta si la
   * persona corta la conexión.
   */
  speak(text: string, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
}

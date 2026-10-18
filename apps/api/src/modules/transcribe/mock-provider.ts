// TEMPORAL: transcripción simulada y determinista para desarrollar y probar sin
// descargar Whisper (STT_PROVIDER=mock). También sirve al front para integrar.
// No se permite en producción.
import type { TranscriptionProvider } from './provider.js';

export const MOCK_TRANSCRIPTION = 'Quiero renovar la cédula de identidad';

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly status = 'ready' as const;

  constructor(private readonly text: string = MOCK_TRANSCRIPTION) {}

  async transcribe(): Promise<string> {
    return this.text;
  }
}

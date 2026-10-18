// TEMPORAL: transcripción simulada y determinista para desarrollar y probar sin
// llamar a OpenAI (STT_PROVIDER=mock). También sirve al front para integrar.
// No se permite en producción.
import type { TranscriptionProvider } from './provider.js';

export const MOCK_TRANSCRIPTION = 'Quiero renovar la cédula de identidad';

export class MockTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly text: string = MOCK_TRANSCRIPTION) {}

  async transcribe(): Promise<string> {
    return this.text;
  }
}

import OpenAI, { toFile } from 'openai';
import type { AppConfig } from '../../config/env.js';
import { mapOpenAIError } from '../openai/client.js';
import type { TranscriptionAudio, TranscriptionProvider } from './provider.js';

type OpenAISttConfig = Pick<AppConfig, 'OPENAI_STT_MODEL' | 'OPENAI_STT_PROMPT' | 'OPENAI_STT_KEYWORDS'>;

/**
 * Voz a texto con la API de OpenAI. Manda el WAV tal cual llegó (ya validado:
 * PCM 16 bits, mono, 16 kHz) y en español. El vocabulario (`OPENAI_STT_PROMPT`,
 * `OPENAI_STT_KEYWORDS`) es configurable y vacío por defecto.
 */
export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly status = 'ready' as const;

  constructor(
    private readonly client: OpenAI,
    private readonly config: OpenAISttConfig,
  ) {}

  async transcribe({ wav }: TranscriptionAudio, signal: AbortSignal): Promise<string> {
    const model = this.config.OPENAI_STT_MODEL;
    // gpt-transcribe usa `languages` (lista) y `keywords`; los demás, `language`. No se mandan las dos formas.
    const multiLanguage = model.startsWith('gpt-transcribe');
    const prompt = this.config.OPENAI_STT_PROMPT.trim();
    const keywords = this.config.OPENAI_STT_KEYWORDS;

    try {
      const result = await this.client.audio.transcriptions.create(
        {
          file: await toFile(wav, 'voz.wav', { type: 'audio/wav' }),
          model,
          response_format: 'json',
          ...(multiLanguage ? { languages: ['es'] } : { language: 'es' }),
          ...(prompt ? { prompt } : {}),
          ...(multiLanguage && keywords.length > 0 ? { keywords } : {}),
        },
        { signal },
      );
      return result.text;
    } catch (error) {
      throw mapOpenAIError(error, 'transcripción');
    }
  }
}

import type OpenAI from 'openai';
import type { AppConfig } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { mapOpenAIError } from '../openai/client.js';
import type { SpeechProvider } from './provider.js';

/** Cómo tiene que sonar Mostrame. Fijo en el servidor: el cliente solo manda el texto. */
export const VOICE_INSTRUCTIONS =
  'Hablá en español rioplatense, con voseo, pausado, claro y cálido, como alguien que acompaña sin apuro.';

type OpenAITtsConfig = Pick<AppConfig, 'OPENAI_TTS_MODEL' | 'OPENAI_TTS_VOICE'>;

/** Texto a voz con la API de OpenAI, en MP3 y reenviando el audio a medida que llega. */
export class OpenAISpeechProvider implements SpeechProvider {
  constructor(
    private readonly client: OpenAI,
    private readonly config: OpenAITtsConfig,
  ) {}

  async speak(text: string, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>> {
    let response: Response;
    try {
      // Se resuelve al llegar las cabeceras: los errores de OpenAI (4xx/5xx) saltan acá, antes de responder.
      response = await this.client.audio.speech.create(
        {
          model: this.config.OPENAI_TTS_MODEL,
          voice: this.config.OPENAI_TTS_VOICE,
          input: text,
          instructions: VOICE_INSTRUCTIONS,
          response_format: 'mp3',
        },
        { signal },
      );
    } catch (error) {
      throw mapOpenAIError(error, 'voz');
    }
    if (!response.body) throw new AppError('AI_UNAVAILABLE', 'voz: OpenAI respondió sin audio');
    return response.body;
  }
}

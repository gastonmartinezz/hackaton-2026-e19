import type OpenAI from 'openai';
import type { AppConfig } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { mapOpenAIError } from '../openai/client.js';
import type { SpeechProvider } from './provider.js';

/**
 * Cómo tiene que sonar Guíame. Fijo en el servidor: el cliente solo manda el texto.
 * Cambia cómo se dice, no qué se dice: el texto sale de las plantillas de la tarjeta.
 */
export const VOICE_INSTRUCTIONS = [
  'Acento: español rioplatense de Montevideo, natural y sin exagerar. Voseo con el acento en la última sílaba (tenés, hacé, elegí). La "ll" y la "y" suenan como "sh" suave (calle, ya).',
  'Tono: cálido, tranquilo y respetuoso, como alguien de confianza que acompaña a un adulto. Nunca infantil, condescendiente ni de vendedor.',
  'Ritmo: más lento que una conversación normal, sin arrastrar las palabras. Una pausa corta entre frases.',
  'Claridad: pronunciá cada palabra completa, sin comerte sílabas ni finales. Decí despacio y por separado los números, fechas, horas y montos.',
  'Los nombres de botones o lugares de la pantalla van entre comillas: decilos con una pausa breve antes, para que se distingan.',
  'Entonación: pareja y serena, sin exclamaciones ni entusiasmo exagerado.',
].join('\n');

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

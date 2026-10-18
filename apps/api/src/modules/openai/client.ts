import OpenAI from 'openai';
import type { AppConfig } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

/** Cliente de OpenAI para voz (transcripción y texto a voz). Claude sigue con interpretar y guiar. */
export function createOpenAI(config: AppConfig): OpenAI {
  return new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    timeout: config.OPENAI_TIMEOUT_MS,
    // Reintentos del SDK solo para fallos transitorios (408/409/429/5xx/red).
    maxRetries: config.OPENAI_MAX_RETRIES,
  });
}

/**
 * Traduce errores del SDK a los códigos existentes del contrato. `what` es el
 * nombre técnico del servicio; los mensajes nunca incluyen audio ni texto.
 */
export function mapOpenAIError(error: unknown, what: string): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new AppError('TIMEOUT', `${what}: OpenAI no respondió a tiempo`);
  // Abortada por nuestro timeout o porque la persona cortó: lo resuelve quien abortó.
  if (error instanceof OpenAI.APIUserAbortError) return new AppError('TIMEOUT', `${what}: solicitud cancelada`);
  if (error instanceof OpenAI.RateLimitError) return new AppError('AI_UNAVAILABLE', `${what}: OpenAI está saturado`);
  if (error instanceof OpenAI.InternalServerError) return new AppError('AI_UNAVAILABLE', `${what}: OpenAI no está disponible`);
  if (error instanceof OpenAI.APIConnectionError) return new AppError('AI_UNAVAILABLE', `${what}: sin conexión con OpenAI`);
  // 400/401/403/404: configuración (clave, modelo, voz) o solicitud mal formada del lado del servidor.
  if (error instanceof OpenAI.APIError) return new AppError('INTERNAL', `${what}: error al invocar a OpenAI`);
  return new AppError('INTERNAL', `${what}: error inesperado`);
}

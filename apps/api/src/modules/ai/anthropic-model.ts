import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import type { AppConfig } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel, StructuredRequest } from './model.js';
import { PROMPT_VERSION } from './prompts.js';

export class AnthropicModel implements StructuredModel {
  private readonly client: Anthropic;

  constructor(
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
  ) {
    this.client = new Anthropic({
      apiKey: config.ANTHROPIC_API_KEY,
      timeout: config.CLAUDE_TIMEOUT_MS,
      // Reintentos con backoff del SDK solo para fallos transitorios (408/409/429/5xx/red).
      maxRetries: config.CLAUDE_MAX_RETRIES,
    });
  }

  async generate<S extends z.ZodType>(request: StructuredRequest<S>): Promise<z.infer<S>> {
    const startedAt = performance.now();
    const response = await this.client.messages
      .parse({
        model: this.config.CLAUDE_MODEL,
        max_tokens: request.maxTokens ?? 4096,
        system: request.system,
        messages: [{ role: 'user', content: `<datos>\n${JSON.stringify(request.input)}\n</datos>` }],
        output_config: { effort: this.config.CLAUDE_EFFORT, format: zodOutputFormat(request.schema) },
      })
      .catch((error: unknown) => {
        throw mapSdkError(error);
      });

    this.log.info(
      {
        task: request.task,
        model: this.config.CLAUDE_MODEL,
        promptVersion: PROMPT_VERSION,
        stopReason: response.stop_reason,
        latencyMs: Math.round(performance.now() - startedAt),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      'claude call',
    );

    if (response.stop_reason === 'refusal') {
      throw new AppError('AI_REFUSED', 'El modelo no puede ayudar con esta solicitud');
    }
    if (response.stop_reason === 'max_tokens' || response.parsed_output == null) {
      throw new AppError('AI_INVALID_RESPONSE', 'Respuesta del modelo incompleta o inválida');
    }
    return response.parsed_output as z.infer<S>;
  }
}

function mapSdkError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AppError('TIMEOUT', 'Claude no respondió a tiempo');
  if (error instanceof Anthropic.RateLimitError) return new AppError('AI_UNAVAILABLE', 'Claude está saturado');
  if (error instanceof Anthropic.InternalServerError) return new AppError('AI_UNAVAILABLE', 'Claude no está disponible');
  if (error instanceof Anthropic.APIConnectionError) return new AppError('AI_UNAVAILABLE', 'Sin conexión con Claude');
  // 400/401/403/404: configuración o solicitud mal formada del lado del servidor.
  if (error instanceof Anthropic.APIError) return new AppError('INTERNAL', 'Error al invocar a Claude');
  // Errores de parseo/validación de la salida estructurada.
  return new AppError('AI_INVALID_RESPONSE', 'Respuesta del modelo inválida');
}

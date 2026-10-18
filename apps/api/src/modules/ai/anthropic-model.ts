import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import type { AppConfig, ClaudeEffort } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { buildDataBlock } from './data-block.js';
import type { AiTask, StructuredModel, StructuredRequest } from './model.js';
import { PROMPT_VERSION } from './prompts.js';

/** Beta del parámetro `fallbacks: "default"` (reintento del lado del servidor ante un rechazo del clasificador). */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Veces que se reanuda un turno pausado por la búsqueda web antes de darlo por fallido. */
const MAX_PAUSE_CONTINUATIONS = 2;

/**
 * Modelos que admiten `fallbacks: "default"`. Claude Haiku 5.5 no tiene fallback
 * del lado del servidor: ahí no se manda el parámetro y un rechazo queda en AI_REFUSED.
 */
const FALLBACK_MODELS: ReadonlySet<string> = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);

export interface TaskSettings {
  model: string;
  effort: ClaudeEffort;
}

/** Modelo y effort de cada tarea: CLAUDE_MODEL_<TAREA> / CLAUDE_EFFORT_<TAREA>, o los generales. */
export function taskSettings(config: AppConfig, task: AiTask): TaskSettings {
  const byTask = {
    interpret: [config.CLAUDE_MODEL_INTERPRET, config.CLAUDE_EFFORT_INTERPRET],
    options: [config.CLAUDE_MODEL_OPTIONS, config.CLAUDE_EFFORT_OPTIONS],
    nextStep: [config.CLAUDE_MODEL_NEXT_STEP, config.CLAUDE_EFFORT_NEXT_STEP],
    // Protección de sitios no tiene variables propias: usa las generales.
    siteCheck: [undefined, undefined],
  } as const;
  const [model, effort] = byTask[task];
  return { model: model ?? config.CLAUDE_MODEL, effort: effort ?? config.CLAUDE_EFFORT };
}

export class AnthropicModel implements StructuredModel {
  private readonly client: Anthropic;

  constructor(
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
    /** Solo para pruebas: un cliente falso en lugar del SDK real. */
    client?: Anthropic,
  ) {
    this.client =
      client ??
      new Anthropic({
        apiKey: config.ANTHROPIC_API_KEY,
        timeout: config.CLAUDE_TIMEOUT_MS,
        // Reintentos con backoff del SDK solo para fallos transitorios (408/409/429/5xx/red).
        maxRetries: config.CLAUDE_MAX_RETRIES,
      });
  }

  async generate<S extends z.ZodType>(request: StructuredRequest<S>): Promise<z.infer<S>> {
    const { model, effort } = taskSettings(this.config, request.task);
    const fallbacks = this.config.CLAUDE_FALLBACKS === 'default' && FALLBACK_MODELS.has(model);
    const startedAt = performance.now();
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: buildDataBlock(request.input) }];
    const totals = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearches: 0 };

    const call = () =>
      this.client.beta.messages
        .parse({
          model,
          // Incluye los tokens del thinking adaptativo: con poco margen la respuesta se corta.
          max_tokens: this.config.CLAUDE_MAX_TOKENS,
          // El system prompt de cada tarea es fijo: se cachea (junto con las herramientas y el esquema de salida,
          // que van antes en el prefijo). Los datos de la persona van en el mensaje, después del punto de caché.
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages,
          output_config: { effort, format: betaZodOutputFormat(request.schema) },
          ...(request.webSearch
            ? {
                tools: [
                  {
                    type: 'web_search_20260209' as const,
                    name: 'web_search' as const,
                    max_uses: request.webSearch.maxUses,
                    user_location: { type: 'approximate' as const, ...request.webSearch.userLocation },
                  },
                ],
              }
            : {}),
          ...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
        }, request.signal ? { signal: request.signal } : undefined)
        .catch((error: unknown) => {
          this.log.warn(
            { task: request.task, model, effort, latencyMs: Math.round(performance.now() - startedAt), errorName: errorName(error) },
            'claude call failed',
          );
          throw mapSdkError(error);
        });

    let response = await call();
    for (let turn = 0; ; turn++) {
      const usage = response.usage;
      totals.inputTokens += usage.input_tokens;
      totals.outputTokens += usage.output_tokens;
      totals.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
      totals.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
      totals.webSearches += usage.server_tool_use?.web_search_requests ?? 0;
      // Con herramientas del servidor (búsqueda web), la API puede pausar el turno: se reenvía tal cual para que siga.
      if (response.stop_reason !== 'pause_turn' || turn >= MAX_PAUSE_CONTINUATIONS) break;
      messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
      response = await call();
    }

    // Solo números y metadatos: nunca el prompt, la entrada ni la salida.
    this.log.info(
      {
        task: request.task,
        model,
        servedBy: response.model,
        fallback: (response.usage.iterations ?? []).some((entry) => entry.type === 'fallback_message'),
        effort,
        promptVersion: PROMPT_VERSION,
        stopReason: response.stop_reason,
        latencyMs: Math.round(performance.now() - startedAt),
        ...totals,
      },
      'claude call',
    );

    if (response.stop_reason === 'refusal') {
      throw new AppError('AI_REFUSED', 'El modelo no puede ayudar con esta solicitud');
    }
    if (response.stop_reason === 'max_tokens' || response.stop_reason === 'pause_turn' || response.parsed_output == null) {
      throw new AppError('AI_INVALID_RESPONSE', 'Respuesta del modelo incompleta o inválida');
    }
    return response.parsed_output as z.infer<S>;
  }
}

function errorName(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `${error.constructor.name}:${error.status ?? 'sin-status'}`;
  return error instanceof Error ? error.name : 'Error';
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

import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../src/config/env.js';
import { AnthropicModel, taskSettings } from '../src/modules/ai/anthropic-model.js';
import type { AiTask } from '../src/modules/ai/model.js';
import { recordingLogger, TOKEN } from './helpers.js';

const config = (env: Record<string, string> = {}) =>
  loadConfig({ NODE_ENV: 'test', API_ACCESS_TOKENS: TOKEN, AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-prueba', ...env });

const Output = z.object({ ok: z.boolean() });

/** Cliente falso: registra los parámetros y devuelve una respuesta armada a mano. Nunca llama a la API. */
function fakeClient(reply: Partial<{ stop_reason: string; parsed_output: unknown; model: string; iterations: unknown[] }> = {}) {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: any) => {
          calls.push(params);
          return {
            model: reply.model ?? params.model,
            stop_reason: reply.stop_reason ?? 'end_turn',
            parsed_output: 'parsed_output' in reply ? reply.parsed_output : { ok: true },
            usage: {
              input_tokens: 120,
              output_tokens: 80,
              cache_read_input_tokens: 900,
              cache_creation_input_tokens: 0,
              iterations: reply.iterations ?? [],
            },
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const request = (task: AiTask = 'interpret') => ({
  task,
  system: 'Instrucciones fijas de la tarea.',
  input: { messages: [{ role: 'user', content: 'Quiero pagar la factura de UTE, mi cédula es 1.234.567-8' }] },
  schema: Output,
});

describe('taskSettings', () => {
  it('usa CLAUDE_MODEL y CLAUDE_EFFORT si la tarea no tiene los suyos (los valores por defecto no cambian)', () => {
    const base = config();
    for (const task of ['interpret', 'options', 'nextStep'] as const) {
      expect(taskSettings(base, task)).toEqual({ model: 'claude-opus-5-5', effort: 'medium' });
    }
  });

  it('toma el modelo y el effort de cada tarea por separado', () => {
    const custom = config({
      CLAUDE_MODEL_INTERPRET: 'claude-haiku-5-5',
      CLAUDE_EFFORT_INTERPRET: 'low',
      CLAUDE_EFFORT_NEXT_STEP: 'low',
    });
    expect(taskSettings(custom, 'interpret')).toEqual({ model: 'claude-haiku-5-5', effort: 'low' });
    expect(taskSettings(custom, 'options')).toEqual({ model: 'claude-opus-5-5', effort: 'medium' });
    expect(taskSettings(custom, 'nextStep')).toEqual({ model: 'claude-opus-5-5', effort: 'low' });
  });

  it('rechaza un effort inválido', () => {
    expect(() => config({ CLAUDE_EFFORT_OPTIONS: 'rapido' })).toThrow(/CLAUDE_EFFORT_OPTIONS/);
  });
});

describe('AnthropicModel', () => {
  it('cachea el system prompt, pasa el effort de la tarea y pide fallback en Opus 5.5', async () => {
    const { client, calls } = fakeClient();
    const model = new AnthropicModel(config({ CLAUDE_EFFORT_INTERPRET: 'low' }), recordingLogger().logger, client);
    await expect(model.generate(request())).resolves.toEqual({ ok: true });

    const params = calls[0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.system).toEqual([{ type: 'text', text: 'Instrucciones fijas de la tarea.', cache_control: { type: 'ephemeral' } }]);
    expect(params.output_config.effort).toBe('low');
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params).not.toHaveProperty('thinking');
  });

  it('no manda fallbacks a Claude Haiku 5.5 (no tiene fallback del lado del servidor) ni con CLAUDE_FALLBACKS=off', async () => {
    for (const env of [{ CLAUDE_MODEL_INTERPRET: 'claude-haiku-5-5' }, { CLAUDE_FALLBACKS: 'off' }] as Record<string, string>[]) {
      const { client, calls } = fakeClient();
      await new AnthropicModel(config(env), recordingLogger().logger, client).generate(request());
      expect(calls[0]).not.toHaveProperty('fallbacks');
      expect(calls[0]).not.toHaveProperty('betas');
    }
  });

  it('registra solo números y metadatos, nunca la entrada', async () => {
    const { client } = fakeClient({ model: 'claude-opus-5', iterations: [{ type: 'fallback_message' }] });
    const { logger, entries } = recordingLogger();
    await new AnthropicModel(config(), logger, client).generate(request('nextStep'));

    expect(JSON.stringify(entries)).not.toContain('1.234.567-8');
    expect(JSON.stringify(entries)).not.toContain('Instrucciones fijas');
    expect(entries[0]).toEqual([
      {
        task: 'nextStep',
        model: 'claude-opus-5-5',
        servedBy: 'claude-opus-5',
        fallback: true,
        effort: 'medium',
        promptVersion: expect.any(String),
        stopReason: 'end_turn',
        latencyMs: expect.any(Number),
        inputTokens: 120,
        outputTokens: 80,
        cacheReadInputTokens: 900,
        cacheCreationInputTokens: 0,
      },
      'claude call',
    ]);
  });

  it('convierte un rechazo en AI_REFUSED y una salida vacía en AI_INVALID_RESPONSE', async () => {
    const refused = fakeClient({ stop_reason: 'refusal', parsed_output: null });
    await expect(new AnthropicModel(config(), recordingLogger().logger, refused.client).generate(request())).rejects.toMatchObject({
      code: 'AI_REFUSED',
    });
    const empty = fakeClient({ parsed_output: null });
    await expect(new AnthropicModel(config(), recordingLogger().logger, empty.client).generate(request())).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
  });

  it('traduce errores del SDK a códigos del contrato', async () => {
    const failing = {
      beta: {
        messages: {
          parse: async () => {
            throw new Anthropic.RateLimitError(429, undefined, 'saturado', new Headers());
          },
        },
      },
    } as unknown as Anthropic;
    await expect(new AnthropicModel(config(), recordingLogger().logger, failing).generate(request())).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      retryable: true,
    });
  });
});

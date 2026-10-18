import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Voz a texto (POST /v1/transcribe). Separado para que el script que descarga el
 * modelo al construir la imagen lo lea sin exigir el resto de la configuración.
 */
export const SttEnvSchema = z.object({
  // off: el endpoint responde 503 no reintentable. mock: texto fijo. local: Whisper en este servidor.
  // openai: API de transcripción de OpenAI (no corre ningún modelo acá).
  STT_PROVIDER: z.enum(['off', 'mock', 'local', 'openai']).default('off'),
  STT_MODEL: z.string().min(1).default('onnx-community/whisper-small'),
  // q8: pesos int8 (≈250 MB entre encoder y decoder), el mejor equilibrio entre calidad y velocidad en CPU.
  STT_DTYPE: z.enum(['fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4', 'bnb4']).default('q8'),
  // Caché del modelo descargado. Por defecto apps/api/.models (no se versiona).
  STT_MODEL_DIR: z.string().min(1).default(fileURLToPath(new URL('../../.models', import.meta.url))),
  STT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // Transcripciones en paralelo. Con local, cada una es un worker con su copia del modelo
  // (por defecto 1); con openai son llamadas HTTP (por defecto 8).
  STT_CONCURRENCY: z.coerce.number().int().min(1).max(32).optional(),
  // Solicitudes en espera además de las que corren; con la cola llena responde 503 reintentable.
  STT_QUEUE_MAX: z.coerce.number().int().min(0).max(100).default(4),
  // Hilos de ONNX Runtime por worker; 0 = núcleos disponibles / STT_CONCURRENCY.
  STT_THREADS: z.coerce.number().int().min(0).max(64).default(0),
  // Límite propio por token, más estricto que el general (misma ventana RATE_LIMIT_WINDOW_MS).
  STT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
});
export type SttConfig = z.infer<typeof SttEnvSchema>;

const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('::'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    API_ACCESS_TOKENS: csv.pipe(z.array(z.string().min(24, 'Cada token debe tener al menos 24 caracteres'))),

    AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
    ANTHROPIC_API_KEY: z.string().optional(),
    CLAUDE_MODEL: z.string().min(1).default('claude-opus-5-5'),
    CLAUDE_EFFORT: Effort.default('medium'),
    // Por tarea: si no se definen, se usan CLAUDE_MODEL y CLAUDE_EFFORT.
    CLAUDE_MODEL_INTERPRET: z.string().min(1).optional(),
    CLAUDE_MODEL_OPTIONS: z.string().min(1).optional(),
    CLAUDE_MODEL_NEXT_STEP: z.string().min(1).optional(),
    CLAUDE_EFFORT_INTERPRET: Effort.optional(),
    CLAUDE_EFFORT_OPTIONS: Effort.optional(),
    CLAUDE_EFFORT_NEXT_STEP: Effort.optional(),
    // default: si el clasificador de seguridad rechaza, la API reintenta en el modelo que Anthropic
    // recomienda para esa categoría (solo modelos que lo admiten). off: sin reintento.
    CLAUDE_FALLBACKS: z.enum(['default', 'off']).default('default'),
    CLAUDE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    CLAUDE_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    // Tope de tokens por respuesta, thinking incluido.
    CLAUDE_MAX_TOKENS: z.coerce.number().int().positive().default(16_000),

    BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(512 * 1024),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),

    ...SttEnvSchema.shape,

    OPENAI_API_KEY: z.string().optional(),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
    OPENAI_STT_MODEL: z.string().min(1).default('gpt-transcribe'),
    // Contexto opcional para la transcripción (vocabulario, estilo). Vacío por defecto; valor propuesto en docs/api.md.
    OPENAI_STT_PROMPT: z.string().max(2000).default(''),
    // Palabras clave separadas por coma (solo gpt-transcribe). Vacío por defecto; valor propuesto en docs/api.md.
    OPENAI_STT_KEYWORDS: csv,

    // Texto a voz (POST /v1/speak). off: 503 no reintentable. mock: MP3 corto de silencio.
    TTS_PROVIDER: z.enum(['off', 'mock', 'openai']).default('off'),
    OPENAI_TTS_MODEL: z.string().min(1).default('gpt-4o-mini-tts'),
    OPENAI_TTS_VOICE: z.string().min(1).default('marin'),
    TTS_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    // Tope de la lectura completa, incluido el streaming del audio.
    TTS_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'Requerida con AI_PROVIDER=anthropic' });
    }
    if (env.API_ACCESS_TOKENS.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['API_ACCESS_TOKENS'], message: 'Definir al menos un token' });
    }
    if (env.NODE_ENV === 'production' && env.AI_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['AI_PROVIDER'], message: 'El modo mock no se permite en producción' });
    }
    if (env.NODE_ENV === 'production' && env.STT_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['STT_PROVIDER'], message: 'El modo mock no se permite en producción' });
    }
    if (env.NODE_ENV === 'production' && env.TTS_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['TTS_PROVIDER'], message: 'El modo mock no se permite en producción' });
    }
    if ((env.STT_PROVIDER === 'openai' || env.TTS_PROVIDER === 'openai') && !env.OPENAI_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'Requerida con STT_PROVIDER=openai o TTS_PROVIDER=openai' });
    }
  })
  .transform((env) => ({
    ...env,
    STT_CONCURRENCY: env.STT_CONCURRENCY ?? (env.STT_PROVIDER === 'openai' ? 8 : 1),
  }));

export type AppConfig = z.infer<typeof EnvSchema>;
export type ClaudeEffort = z.infer<typeof Effort>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Solo nombres de variables y motivos; nunca valores.
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  return parsed.data;
}

import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Voz a texto (POST /v1/transcribe). Separado para que el script que descarga el
 * modelo al construir la imagen lo lea sin exigir el resto de la configuración.
 */
export const SttEnvSchema = z.object({
  // off: el endpoint responde 503 no reintentable. mock: texto fijo. local: Whisper en este servidor.
  STT_PROVIDER: z.enum(['off', 'mock', 'local']).default('off'),
  STT_MODEL: z.string().min(1).default('onnx-community/whisper-small'),
  // q8: pesos int8 (≈250 MB entre encoder y decoder), el mejor equilibrio entre calidad y velocidad en CPU.
  STT_DTYPE: z.enum(['fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4', 'bnb4']).default('q8'),
  // Caché del modelo descargado. Por defecto apps/api/.models (no se versiona).
  STT_MODEL_DIR: z.string().min(1).default(fileURLToPath(new URL('../../.models', import.meta.url))),
  STT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // Inferencias en paralelo; cada una corre en un worker con su propia copia del modelo.
  STT_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  // Solicitudes en espera además de las que corren; con la cola llena responde 503 reintentable.
  STT_QUEUE_MAX: z.coerce.number().int().min(0).max(100).default(4),
  // Hilos de ONNX Runtime por worker; 0 = núcleos disponibles / STT_CONCURRENCY.
  STT_THREADS: z.coerce.number().int().min(0).max(64).default(0),
  // Límite propio por token, más estricto que el general (misma ventana RATE_LIMIT_WINDOW_MS).
  STT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
});
export type SttConfig = z.infer<typeof SttEnvSchema>;

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
    CLAUDE_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
    CLAUDE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    CLAUDE_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    // Tope de tokens por respuesta, thinking incluido.
    CLAUDE_MAX_TOKENS: z.coerce.number().int().positive().default(16_000),

    BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(512 * 1024),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),

    ...SttEnvSchema.shape,
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
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Solo nombres de variables y motivos; nunca valores.
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  return parsed.data;
}

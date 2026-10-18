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

const flag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

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

    // Protección de sitios (POST /v1/site-check). Las claves de proveedores quedan solo en el servidor.
    SITE_CHECK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    // none: sin proveedor (cobertura de reputación "unavailable", nunca aprobación). mock: solo desarrollo.
    REPUTATION_PROVIDER: z.enum(['none', 'mock', 'safe_browsing', 'web_risk']).default('none'),
    GOOGLE_SAFE_BROWSING_API_KEY: z.string().optional(),
    GOOGLE_WEB_RISK_API_KEY: z.string().optional(),
    SITE_CHECK_RDAP: flag('true'),
    // Padrón de entidades financieras del BCRA (fuente de oficialidad de bancos). Se refresca cada 24 h.
    SITE_CHECK_BCRA_REGISTRY: flag('true'),
    SITE_CHECK_REGISTRY_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    // Lista opcional de dominios populares (CSV de CrUX u otro), solo como referencia de dominios parecidos.
    SITE_CHECK_POPULAR_DOMAINS_FILE: z.string().optional(),
    SITE_CHECK_POPULAR_DOMAINS_LIMIT: z.coerce.number().int().positive().default(10_000),
    SITE_CHECK_CONNECTION: flag('true'),
    SITE_CHECK_AI: flag('true'),
    // Tiempo máximo por consulta a reputación y RDAP, y por inspección de conexión (todas las redirecciones).
    SITE_CHECK_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(4_000),
    SITE_CHECK_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    SITE_CHECK_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    // Tope de consultas por minuto a cada proveedor externo (protege cuotas y costos).
    SITE_CHECK_PROVIDER_MAX_PER_MINUTE: z.coerce.number().int().positive().default(120),

    // Servidor MCP privado. Sin tokens no se levanta. Por defecto escucha solo en loopback.
    MCP_ACCESS_TOKENS: csv.pipe(z.array(z.string().min(24, 'Cada token MCP debe tener al menos 24 caracteres'))),
    MCP_HOST: z.string().default('127.0.0.1'),
    MCP_PORT: z.coerce.number().int().positive().default(3100),

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
    if (env.REPUTATION_PROVIDER === 'safe_browsing' && !env.GOOGLE_SAFE_BROWSING_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_SAFE_BROWSING_API_KEY'], message: 'Requerida con REPUTATION_PROVIDER=safe_browsing' });
    }
    if (env.REPUTATION_PROVIDER === 'web_risk' && !env.GOOGLE_WEB_RISK_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_WEB_RISK_API_KEY'], message: 'Requerida con REPUTATION_PROVIDER=web_risk' });
    }
    if (env.NODE_ENV === 'production' && env.REPUTATION_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['REPUTATION_PROVIDER'], message: 'El modo mock no se permite en producción' });
    }
    if (env.MCP_ACCESS_TOKENS.some((token) => env.API_ACCESS_TOKENS.includes(token))) {
      ctx.addIssue({ code: 'custom', path: ['MCP_ACCESS_TOKENS'], message: 'Usar tokens distintos a los de la API' });
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

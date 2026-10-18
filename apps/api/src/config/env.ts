import { z } from 'zod';

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
    CLAUDE_EFFORT: Effort.default('medium'),
    // Por tarea: si no se definen, se usan CLAUDE_MODEL y CLAUDE_EFFORT.
    CLAUDE_MODEL_INTERPRET: z.string().min(1).optional(),
    CLAUDE_MODEL_OPTIONS: z.string().min(1).optional(),
    CLAUDE_MODEL_NEXT_STEP: z.string().min(1).optional(),
    CLAUDE_MODEL_PROCEDURE: z.string().min(1).optional(),
    CLAUDE_MODEL_MATCH: z.string().min(1).optional(),
    CLAUDE_MODEL_PAGE_CHECK: z.string().min(1).optional(),
    CLAUDE_EFFORT_INTERPRET: Effort.optional(),
    CLAUDE_EFFORT_OPTIONS: Effort.optional(),
    CLAUDE_EFFORT_NEXT_STEP: Effort.optional(),
    CLAUDE_EFFORT_PROCEDURE: Effort.optional(),
    // Interpretar un pedido contra las opciones ya mostradas es corto: por defecto, low (más rápido).
    CLAUDE_EFFORT_MATCH: Effort.default('low'),
    // Comparar lo pedido con el título de cada página propuesta por interpret: corto, low por defecto.
    CLAUDE_EFFORT_PAGE_CHECK: Effort.default('low'),
    // default: si el clasificador de seguridad rechaza, la API reintenta en el modelo que Anthropic
    // recomienda para esa categoría (solo modelos que lo admiten). off: sin reintento.
    CLAUDE_FALLBACKS: z.enum(['default', 'off']).default('default'),

    // Verificación de las URLs que devuelve interpret antes de mostrarlas (S03). Siempre activa.
    URL_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(5000),
    URL_CHECK_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(3),
    URL_CHECK_CACHE_TTL_MS: z.coerce.number().int().min(0).default(10 * 60_000),
    // on: al empezar una opción de la guía, Claude busca en la web el paso a paso real (tarea procedure).
    // off: arma el paso a paso con lo que ya sabe, sin buscar.
    GUIDE_WEB_SEARCH: z.enum(['off', 'on']).default('on'),
    GUIDE_WEB_SEARCH_MAX_USES: z.coerce.number().int().min(1).max(10).default(3),
    CLAUDE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    CLAUDE_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    // Tope de tokens por respuesta, thinking incluido.
    CLAUDE_MAX_TOKENS: z.coerce.number().int().positive().default(16_000),

    BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(512 * 1024),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),

    // Protección de sitios (POST /v1/site-check).
    SITE_CHECK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    SITE_CHECK_RDAP: flag('true'),
    // Registro de instituciones del BCU (fuente de oficialidad de bancos, financieras, cambios, AFAP, seguros y
    // medios de pago). Se descarga al arrancar y se refresca cada 24 h. El tiempo máximo es por petición (algunas
    // fichas pesan 1 MB).
    SITE_CHECK_BCU_REGISTRY: flag('true'),
    SITE_CHECK_BCU_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    SITE_CHECK_CONNECTION: flag('true'),
    SITE_CHECK_AI: flag('true'),
    // Tiempo máximo por consulta RDAP y espera máxima de una solicitud a la descarga del registro del BCU.
    // La inspección de conexión tiene el suyo (todas las redirecciones) y la IA también.
    SITE_CHECK_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(4_000),
    SITE_CHECK_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    SITE_CHECK_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    // Tope de consultas por minuto a RDAP y a la inspección de conexión (cada uno por separado).
    SITE_CHECK_PROVIDER_MAX_PER_MINUTE: z.coerce.number().int().positive().default(120),

    // Voz a texto (POST /v1/transcribe). off: 503 no reintentable. mock: texto fijo. openai: API de OpenAI.
    STT_PROVIDER: z.enum(['off', 'mock', 'openai']).default('off'),
    STT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    // Transcripciones en paralelo hacia OpenAI y cuántas esperan; con la cola llena responde 503 reintentable.
    STT_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(8),
    STT_QUEUE_MAX: z.coerce.number().int().min(0).max(100).default(4),
    // Límite propio por token, más estricto que el general (misma ventana RATE_LIMIT_WINDOW_MS).
    STT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

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
  });

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

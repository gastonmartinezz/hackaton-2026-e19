import { z } from 'zod';

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

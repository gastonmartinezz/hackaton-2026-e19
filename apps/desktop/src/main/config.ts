/**
 * Configuración por entorno. Sin secretos embebidos: la URL del backend y el
 * token (si Agustin define uno) se leen del entorno. Sin URL → backend simulado.
 */
export interface AppConfig {
  apiBaseUrl: URL | null;
  apiToken: string | null;
  useMockBackend: boolean;
  isDev: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isDev = env.NODE_ENV === 'development' || Boolean(env.ELECTRON_RENDERER_URL);
  const raw = env.ASISTENTE_API_URL?.trim();
  let apiBaseUrl: URL | null = null;
  if (raw) {
    const url = new URL(raw);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new Error('ASISTENTE_API_URL debe usar HTTPS (HTTP solo para localhost).');
    }
    apiBaseUrl = url;
  }
  return {
    apiBaseUrl,
    apiToken: env.ASISTENTE_API_TOKEN?.trim() || null,
    useMockBackend: apiBaseUrl === null,
    isDev,
  };
}

import type { FastifyBaseLogger } from 'fastify';
import { buildApp, type AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';

export const TOKEN = 'token-de-prueba-con-longitud-suficiente';
export const OTHER_TOKEN = 'otro-token-de-prueba-con-longitud-suficiente';
export const auth = { authorization: `Bearer ${TOKEN}` };

export function testApp(deps: AppDeps = {}, env: Record<string, string> = {}) {
  const config = loadConfig({ NODE_ENV: 'test', API_ACCESS_TOKENS: `${TOKEN},${OTHER_TOKEN}`, ...env });
  return buildApp(config, deps);
}

export const html = '<form><input id="search" placeholder="Buscar"><button id="go">Buscar</button></form>';

/** Logger que guarda todo lo que se registra, para comprobar que no hay contenido. */
export function recordingLogger() {
  const entries: unknown[][] = [];
  const record = (...args: unknown[]) => void entries.push(args);
  const logger = {
    info: record,
    warn: record,
    error: record,
    debug: record,
    trace: record,
    fatal: record,
    child: () => logger,
  } as unknown as FastifyBaseLogger;
  return { logger, entries };
}

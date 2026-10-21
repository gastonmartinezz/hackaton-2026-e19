import type { FastifyBaseLogger } from 'fastify';
import { buildApp, type AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { UrlVerifier, type HeadResult } from '../src/modules/urls/url-verifier.js';

export const TOKEN = 'token-de-prueba-con-longitud-suficiente';
export const OTHER_TOKEN = 'otro-token-de-prueba-con-longitud-suficiente';
export const auth = { authorization: `Bearer ${TOKEN}` };

export function testApp(deps: AppDeps = {}, env: Record<string, string> = {}) {
  const config = loadConfig({ NODE_ENV: 'test', API_ACCESS_TOKENS: `${TOKEN},${OTHER_TOKEN}`, ...env });
  // Sin red en las pruebas: por defecto todas las URLs existen.
  return buildApp(config, { urlVerifier: fakeVerifier(), ...deps });
}

/**
 * Verificador sin red. `sites` dice qué responde cada URL (status y Location); lo que
 * no está responde 200. `dns` dice a qué IPs resuelve cada nombre (por defecto, una pública).
 */
export function fakeVerifier({
  sites = {},
  dns = {},
  titles = {},
  now = () => 0,
}: {
  sites?: Record<string, HeadResult | ((method: 'HEAD' | 'GET') => HeadResult)>;
  dns?: Record<string, string[]>;
  /** Título de cada página (por URL final); las que no están no tienen título. */
  titles?: Record<string, string>;
  now?: () => number;
} = {}) {
  const requests: string[] = [];
  const verifier = new UrlVerifier(
    { timeoutMs: 1000, maxRedirects: 3, cacheTtlMs: 60_000 },
    {
      resolve: async (hostname) => {
        const addresses = dns[hostname] ?? ['93.184.215.14'];
        if (addresses.length === 0) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
        return addresses;
      },
      request: async (url, method) => {
        requests.push(`${method} ${url.href}`);
        const site = sites[url.href];
        if (!site) return { status: 200 };
        return typeof site === 'function' ? site(method) : site;
      },
      readTitle: async (url) => titles[url.href] ?? null,
      now,
    },
  );
  return Object.assign(verifier, { requests });
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

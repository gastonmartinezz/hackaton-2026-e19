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

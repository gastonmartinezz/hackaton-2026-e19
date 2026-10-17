import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { buildMcpApp } from './modules/mcp/mcp.server.js';

// En desarrollo se lee apps/api/.env; en contenedores las variables llegan del entorno.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const app = await buildApp(config);
// MCP privado: solo con MCP_ACCESS_TOKENS y en su propio puerto (por defecto, solo loopback).
const mcp = config.MCP_ACCESS_TOKENS.length > 0 ? await buildMcpApp(config, app.siteCheck) : undefined;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await Promise.all([app.close(), mcp?.close()]);
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
if (mcp) await mcp.listen({ host: config.MCP_HOST, port: config.MCP_PORT });
app.log.info({ aiProvider: config.AI_PROVIDER, reputationProvider: config.REPUTATION_PROVIDER, mcp: Boolean(mcp) }, 'api ready');

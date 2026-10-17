// Abre Electron contra la API local (`pnpm dev`), con la URL y el token de apps/api/.env.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = new URL('../apps/api/.env', import.meta.url);
let env;
try {
  env = Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^(['"])(.*)\1$/, '$2')]),
  );
} catch {
  console.error('Falta apps/api/.env: copiar apps/api/.env.example.');
  process.exit(1);
}

const token = env.API_ACCESS_TOKENS?.split(',')[0]?.trim();
if (!token) {
  console.error('API_ACCESS_TOKENS está vacío en apps/api/.env.');
  process.exit(1);
}

// Igual que `pnpm dev:desktop`, sin depender de un pnpm global (funciona también con npx).
const desktop = new URL('../apps/desktop/', import.meta.url);
const child = spawn(fileURLToPath(new URL('node_modules/.bin/electron-vite', desktop)), ['dev'], {
  cwd: desktop,
  stdio: 'inherit',
  env: {
    ...process.env,
    ASISTENTE_API_URL: process.env.ASISTENTE_API_URL ?? `http://localhost:${env.PORT ?? 3000}`,
    ASISTENTE_API_TOKEN: process.env.ASISTENTE_API_TOKEN ?? token,
  },
});
child.on('error', (error) => {
  console.error(
    error.code === 'ENOENT'
      ? 'No se encontró electron-vite en apps/desktop: correr `pnpm install` (o `pnpm bootstrap`).'
      : `No se pudo abrir Electron: ${error.message}`,
  );
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));

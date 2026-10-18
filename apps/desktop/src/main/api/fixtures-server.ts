/**
 * TEMPORAL — servidor local de páginas de prueba (tests/fixtures/pages) para el
 * modo simulado. Solo escucha en 127.0.0.1 y solo sirve archivos .html de esa
 * carpeta.
 */
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { basename, join } from 'node:path';

export async function startFixturesServer(directory: string, preferredPort = 0): Promise<{ origin: string; close(): void }> {
  const server: Server = createServer(async (req, res) => {
    const name = basename(new URL(req.url ?? '/', 'http://x').pathname) || 'index.html';
    if (req.method !== 'GET' || !/^[a-z0-9-]+\.html$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const html = await readFile(join(directory, name));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
    } catch {
      res.writeHead(404).end();
    }
  });
  // Puerto fijo si está libre (las direcciones de demostración no cambian); si no, cualquiera.
  await new Promise<void>((resolve, reject) => {
    const fallback = (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EADDRINUSE' || preferredPort === 0) return reject(error);
      server.listen(0, '127.0.0.1', resolve);
    };
    server.once('error', fallback);
    server.listen(preferredPort, '127.0.0.1', () => {
      server.off('error', fallback);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el servidor de prueba');
  return { origin: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}

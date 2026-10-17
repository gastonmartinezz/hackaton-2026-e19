import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Identificador no reversible del token usado; sirve para límites y logs. */
    principal?: string;
  }

  interface FastifyContextConfig {
    /** Rutas sin autenticación (health, documentación). */
    public?: boolean;
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/**
 * Autenticación provisoria del piloto por invitación: Bearer token emitido por
 * el equipo a cada instalación. No es una clave fija embebida en el instalador.
 * TODO: reemplazar por emisión de tokens por invitación cuando se defina la identidad.
 */
export function registerAuth(app: FastifyInstance, tokens: readonly string[]): void {
  const digests = tokens.map(sha256);

  app.decorateRequest('principal', undefined);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (request.routeOptions.config?.public) return;

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw new AppError('UNAUTHORIZED', 'Falta el token de acceso');

    const digest = sha256(token);
    const match = digests.some((candidate) => timingSafeEqual(candidate, digest));
    if (!match) throw new AppError('UNAUTHORIZED', 'Token de acceso inválido');

    request.principal = digest.toString('hex').slice(0, 12);
  });
}

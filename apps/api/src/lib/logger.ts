import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config/env.js';

/** Logs técnicos sin contenido: nada de cuerpos, mensajes, HTML ni headers de autenticación. */
export function buildLoggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'body', '*.body', '*.html', '*.messages'],
      censor: '[redactado]',
    },
    serializers: {
      req: (req) => ({ method: req.method, route: req.routeOptions?.url, requestId: req.id }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  };
}

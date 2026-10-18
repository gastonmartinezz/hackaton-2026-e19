import { ApiError, SPEAK_CONTENT_TYPE, SpeakRequest } from '@hackaton/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SpeakService } from './speak.service.js';

export interface SpeakRoutesOptions {
  service: SpeakService;
  rateLimit: { max: number; timeWindow: number };
}

export const speakRoutes: FastifyPluginAsyncZod<SpeakRoutesOptions> = async (app, { service, rateLimit }) => {
  app.post(
    '/v1/speak',
    {
      config: { rateLimit },
      schema: {
        tags: ['speak'],
        summary: 'Texto a voz: devuelve MP3 en streaming',
        description:
          'Cuerpo JSON `{ text }` (1 a 600 caracteres). La respuesta 200 es `audio/mpeg` y llega por partes: ' +
          'se puede reproducir antes de que termine. Ni el texto ni el audio se guardan ni se registran.',
        body: SpeakRequest,
        produces: [SPEAK_CONTENT_TYPE],
        response: {
          // Solo documenta el binario en OpenAPI: la respuesta es un stream y no pasa por el serializador.
          200: z.any().meta({ type: 'string', format: 'binary', description: 'MP3 en streaming' }),
          '4xx': ApiError,
          '5xx': ApiError,
        },
      },
    },
    async (request, reply) => {
      // Si la persona corta la conexión, se corta también la generación en OpenAI.
      const disconnected = new AbortController();
      reply.raw.once('close', () => {
        if (!reply.raw.writableFinished) disconnected.abort();
      });
      const audio = await service.speak(request.body.text, { signal: disconnected.signal, log: request.log });
      return reply.type(SPEAK_CONTENT_TYPE).header('cache-control', 'no-store').send(audio);
    },
  );
};

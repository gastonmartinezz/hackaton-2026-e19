import { ApiError, TRANSCRIBE_CONTENT_TYPE, TRANSCRIBE_MAX_BYTES, TranscribeResponse } from '@hackaton/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { TranscribeService } from './transcribe.service.js';

export interface TranscribeRoutesOptions {
  service: TranscribeService;
  rateLimit: { max: number; timeWindow: number };
}

export const transcribeRoutes: FastifyPluginAsyncZod<TranscribeRoutesOptions> = async (app, { service, rateLimit }) => {
  // Parser y límite de cuerpo propios de este plugin: el resto de la API sigue con JSON y 512 KB.
  app.addContentTypeParser(
    TRANSCRIBE_CONTENT_TYPE,
    { parseAs: 'buffer', bodyLimit: TRANSCRIBE_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.post(
    '/v1/transcribe',
    {
      bodyLimit: TRANSCRIBE_MAX_BYTES,
      config: { rateLimit },
      schema: {
        tags: ['transcribe'],
        summary: 'Transcribe voz a texto con Whisper en el servidor',
        description:
          'Cuerpo binario `audio/wav`: WAV RIFF, PCM de 16 bits little-endian, mono, 16 000 Hz, entre 0,3 s y 30 s. ' +
          'Devuelve `text` vacío si no se entendió nada. Ni el audio ni el texto se guardan ni se registran.',
        consumes: [TRANSCRIBE_CONTENT_TYPE],
        // Solo documenta el binario en OpenAPI; la validación real la hace el servicio al leer el WAV.
        body: z.any().meta({ type: 'string', format: 'binary' }),
        response: { 200: TranscribeResponse, '4xx': ApiError, '5xx': ApiError },
      },
    },
    (request, reply) => {
      // Si la persona corta la conexión, la solicitud sale de la cola.
      const disconnected = new AbortController();
      reply.raw.once('close', () => {
        if (!reply.raw.writableFinished) disconnected.abort();
      });
      return service.transcribe(request.body, { signal: disconnected.signal, log: request.log });
    },
  );
};

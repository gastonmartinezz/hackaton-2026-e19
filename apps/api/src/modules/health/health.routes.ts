import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { TtsStatus } from '../speak/speak.service.js';
import type { SttStatus } from '../transcribe/provider.js';

export interface HealthRoutesOptions {
  /** Si la voz a texto está activa. Informativo: /health responde siempre 200. */
  sttStatus: () => SttStatus;
  /** Si el texto a voz está activo. */
  ttsStatus: () => TtsStatus;
}

export const healthRoutes: FastifyPluginAsyncZod<HealthRoutesOptions> = async (app, { sttStatus, ttsStatus }) => {
  app.get(
    '/health',
    {
      config: { public: true, rateLimit: false },
      schema: {
        tags: ['health'],
        response: {
          200: z.object({
            status: z.literal('ok'),
            stt: z.enum(['off', 'ready']),
            tts: z.enum(['off', 'ready']),
          }),
        },
      },
    },
    async () => ({ status: 'ok' as const, stt: sttStatus(), tts: ttsStatus() }),
  );
};

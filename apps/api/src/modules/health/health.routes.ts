import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SttStatus } from '../transcribe/provider.js';

export interface HealthRoutesOptions {
  /** Estado del modelo de voz. Informativo: /health responde 200 aunque el modelo esté cargando o caído. */
  sttStatus: () => SttStatus;
}

export const healthRoutes: FastifyPluginAsyncZod<HealthRoutesOptions> = async (app, { sttStatus }) => {
  app.get(
    '/health',
    {
      config: { public: true, rateLimit: false },
      schema: {
        tags: ['health'],
        response: {
          200: z.object({ status: z.literal('ok'), stt: z.enum(['off', 'loading', 'ready', 'failed']) }),
        },
      },
    },
    async () => ({ status: 'ok' as const, stt: sttStatus() }),
  );
};

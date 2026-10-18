import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { TtsStatus } from '../speak/speak.service.js';
import type { SttStatus } from '../transcribe/provider.js';

export interface HealthRoutesOptions {
  /** Estado del modelo de voz. Informativo: /health responde 200 aunque el modelo esté cargando o caído. */
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
            stt: z.enum(['off', 'loading', 'ready', 'failed']),
            tts: z.enum(['off', 'ready']),
          }),
        },
      },
    },
    async () => ({ status: 'ok' as const, stt: sttStatus(), tts: ttsStatus() }),
  );
};

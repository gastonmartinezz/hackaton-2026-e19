import { ApiError, SiteCheckRequest, SiteCheckResponse } from '@hackaton/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { SiteCheckService } from './site-check.service.js';

export const siteCheckRoutes: FastifyPluginAsyncZod<{ service: SiteCheckService; rateLimitMax: number; rateLimitWindowMs: number }> = async (
  app,
  { service, rateLimitMax, rateLimitWindowMs },
) => {
  app.post(
    '/v1/site-check',
    {
      // Límite propio: el navegador llama en cada navegación (dirección y contenido).
      config: { rateLimit: { max: rateLimitMax, timeWindow: rateLimitWindowMs } },
      schema: {
        tags: ['site-check'],
        summary: 'Protección de sitios: revisa la dirección (contentVersion 0) o el contenido de la página',
        body: SiteCheckRequest,
        response: { 200: SiteCheckResponse, '4xx': ApiError, '5xx': ApiError },
      },
    },
    (request) => service.check(request.body, request.log),
  );
};

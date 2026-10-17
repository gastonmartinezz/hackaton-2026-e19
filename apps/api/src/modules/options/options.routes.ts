import { ApiError, OptionsRequest, OptionsResponse } from '@hackaton/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { OptionsService } from './options.service.js';

export const optionsRoutes: FastifyPluginAsyncZod<{ service: OptionsService }> = async (app, { service }) => {
  app.post(
    '/v1/options',
    {
      schema: {
        tags: ['options'],
        summary: 'Devuelve las opciones de la página y el próximo paso de la guía',
        body: OptionsRequest,
        response: { 200: OptionsResponse, '4xx': ApiError, '5xx': ApiError },
      },
    },
    (request) => service.options(request.body, request.principal!),
  );
};

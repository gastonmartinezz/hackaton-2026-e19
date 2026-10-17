import { ApiError, NextStepRequest, NextStepResponse } from '@hackaton/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { NextStepService } from './next-step.service.js';

export const nextStepRoutes: FastifyPluginAsyncZod<{ service: NextStepService }> = async (app, { service }) => {
  app.post(
    '/v1/next-step',
    {
      schema: {
        tags: ['next-step'],
        summary: 'Resuelve un paso teórico con el HTML posterior a la acción de la persona',
        body: NextStepRequest,
        response: { 200: NextStepResponse, '4xx': ApiError, '5xx': ApiError },
      },
    },
    (request) => service.next(request.body, request.principal!),
  );
};

import { ApiError, NextStepRequest, NextStepResponse } from '@hackaton/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { NextStepService } from './next-step.service.js';

export const nextStepRoutes: FastifyPluginAsyncZod<{ service: NextStepService }> = async (app, { service }) => {
  app.post(
    '/v1/next-step',
    {
      schema: {
        tags: ['next-step'],
        summary: 'Informa el avance de la guía y devuelve los pasos que siguen hasta terminar la opción',
        body: NextStepRequest,
        response: { 200: NextStepResponse, '4xx': ApiError, '5xx': ApiError },
      },
    },
    (request) => service.next(request.body, request.principal!, request.log),
  );
};

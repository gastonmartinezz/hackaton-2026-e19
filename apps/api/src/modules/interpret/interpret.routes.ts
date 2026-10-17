import { ApiError, InterpretRequest, InterpretResponse } from '@hackaton/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { InterpretService } from './interpret.service.js';

export const interpretRoutes: FastifyPluginAsyncZod<{ service: InterpretService }> = async (app, { service }) => {
  app.post(
    '/v1/interpret',
    {
      schema: {
        tags: ['interpret'],
        summary: 'Interpreta el chat: redirige, ofrece sitios o hace una pregunta',
        body: InterpretRequest,
        response: { 200: InterpretResponse, '4xx': ApiError, '5xx': ApiError },
      },
    },
    (request) => service.interpret(request.body),
  );
};

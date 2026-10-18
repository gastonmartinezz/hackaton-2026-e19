import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppConfig } from './config/env.js';
import { AppError, registerErrorHandling, toApiError } from './lib/errors.js';
import { buildLoggerOptions } from './lib/logger.js';
import { AnthropicModel } from './modules/ai/anthropic-model.js';
import { MockModel } from './modules/ai/mock-model.js';
import type { StructuredModel } from './modules/ai/model.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { InterpretService } from './modules/interpret/interpret.service.js';
import { interpretRoutes } from './modules/interpret/interpret.routes.js';
import { NextStepService } from './modules/next-step/next-step.service.js';
import { nextStepRoutes } from './modules/next-step/next-step.routes.js';
import { OptionsService } from './modules/options/options.service.js';
import { optionsRoutes } from './modules/options/options.routes.js';
import { SessionStore } from './modules/sessions/session-store.js';
import { createSiteCheckService, type SiteCheckOverrides } from './modules/site-check/factory.js';
import { siteCheckRoutes } from './modules/site-check/site-check.routes.js';
import type { SiteCheckService } from './modules/site-check/site-check.service.js';
import { registerAuth } from './plugins/auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Servicio de Protección de sitios; el servidor MCP lo comparte (mismas cachés y límites). */
    siteCheck: SiteCheckService;
  }
}

export interface AppDeps {
  model?: StructuredModel;
  /** Reemplazos de proveedores de /v1/site-check (pruebas sin red). */
  siteCheck?: SiteCheckOverrides;
  /** Destino de logs en pruebas (para verificar que no se registran datos sensibles). */
  logStream?: Writable;
}

const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function buildApp(config: AppConfig, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logStream
      ? { ...(buildLoggerOptions(config) as object), stream: deps.logStream }
      : config.NODE_ENV === 'test'
        ? false
        : buildLoggerOptions(config),
    bodyLimit: config.BODY_LIMIT_BYTES,
    requestIdHeader: false,
    // Acepta el X-Request-Id del cliente si es seguro; si no, genera uno propio.
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' && CLIENT_REQUEST_ID.test(header) ? header : `req-${randomUUID()}`;
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(swagger, {
    openapi: {
      info: { title: 'API del navegador asistido', version: '1' },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  if (config.NODE_ENV !== 'production') {
    app.addHook('onRoute', (route) => {
      if (route.url.startsWith('/docs')) route.config = { ...route.config, public: true, rateLimit: false };
    });
    await app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });
  }

  registerAuth(app, config.API_ACCESS_TOKENS);

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (request) => request.principal ?? request.ip,
    errorResponseBuilder: (request) => {
      const error = new AppError('RATE_LIMITED', 'Demasiadas solicitudes');
      return Object.assign(error, { body: toApiError(error, request.id) });
    },
  });

  const model = deps.model ?? (config.AI_PROVIDER === 'anthropic' ? new AnthropicModel(config, app.log) : new MockModel());
  const sessions = new SessionStore(config.SESSION_TTL_MINUTES * 60_000);
  app.addHook('onClose', async () => sessions.close());

  await app.register(healthRoutes);
  await app.register(interpretRoutes, { service: new InterpretService(model, sessions) });
  await app.register(optionsRoutes, { service: new OptionsService(model, sessions) });
  await app.register(nextStepRoutes, { service: new NextStepService(model, sessions) });

  const { service: siteCheck, authority } = createSiteCheckService(config, model, deps.siteCheck);
  app.decorate('siteCheck', siteCheck);
  // Descarga el padrón del BCRA en segundo plano al arrancar (no en pruebas).
  if (config.NODE_ENV !== 'test') authority.warmUp();
  await app.register(siteCheckRoutes, {
    service: siteCheck,
    rateLimitMax: config.SITE_CHECK_RATE_LIMIT_MAX,
    rateLimitWindowMs: config.RATE_LIMIT_WINDOW_MS,
  });

  return app;
}

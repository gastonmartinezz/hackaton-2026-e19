import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import type OpenAI from 'openai';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppConfig } from './config/env.js';
import { AppError, registerErrorHandling, toApiError } from './lib/errors.js';
import { buildLoggerOptions } from './lib/logger.js';
import { AnthropicModel } from './modules/ai/anthropic-model.js';
import { MockModel } from './modules/ai/mock-model.js';
import type { StructuredModel } from './modules/ai/model.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { InterpretService } from './modules/interpret/interpret.service.js';
import { UrlGuard } from './modules/interpret/url-guard.js';
import { interpretRoutes } from './modules/interpret/interpret.routes.js';
import { NextStepService } from './modules/next-step/next-step.service.js';
import { nextStepRoutes } from './modules/next-step/next-step.routes.js';
import { OptionsService } from './modules/options/options.service.js';
import { ProcedureResearcher } from './modules/procedure/procedure.service.js';
import { optionsRoutes } from './modules/options/options.routes.js';
import { createOpenAI } from './modules/openai/client.js';
import { SessionStore } from './modules/sessions/session-store.js';
import { MockSpeechProvider } from './modules/speak/mock-provider.js';
import { OpenAISpeechProvider } from './modules/speak/openai-provider.js';
import type { SpeechProvider } from './modules/speak/provider.js';
import { speakRoutes } from './modules/speak/speak.routes.js';
import { SpeakService } from './modules/speak/speak.service.js';
import { createSiteCheckService, type SiteCheckOverrides } from './modules/site-check/factory.js';
import { siteCheckRoutes } from './modules/site-check/site-check.routes.js';
import { LocalWhisperProvider } from './modules/transcribe/local-provider.js';
import { MockTranscriptionProvider } from './modules/transcribe/mock-provider.js';
import { OpenAITranscriptionProvider } from './modules/transcribe/openai-provider.js';
import type { TranscriptionProvider } from './modules/transcribe/provider.js';
import { transcribeRoutes } from './modules/transcribe/transcribe.routes.js';
import { TranscribeService } from './modules/transcribe/transcribe.service.js';
import { UrlVerifier } from './modules/urls/url-verifier.js';
import { registerAuth } from './plugins/auth.js';

export interface AppDeps {
  model?: StructuredModel;
  /** Reemplazos de proveedores de /v1/site-check (pruebas sin red). */
  siteCheck?: SiteCheckOverrides;
  /** Destino de logs en pruebas (para verificar que no se registran datos sensibles). */
  logStream?: Writable;
  /** null: voz a texto apagada. Si no se pasa, sale de STT_PROVIDER. */
  transcriber?: TranscriptionProvider | null;
  /** null: texto a voz apagado. Si no se pasa, sale de TTS_PROVIDER. */
  speaker?: SpeechProvider | null;
  /** Verificador de URLs de interpret (en pruebas, uno sin red). */
  urlVerifier?: UrlVerifier;
  /** Cliente de OpenAI (en pruebas, uno falso). Si no se pasa, se crea con OPENAI_API_KEY cuando hace falta. */
  openai?: OpenAI;
}

function createTranscriber(config: AppConfig, app: FastifyInstance, openai: () => OpenAI): TranscriptionProvider | null {
  switch (config.STT_PROVIDER) {
    case 'off':
      return null;
    case 'mock':
      return new MockTranscriptionProvider();
    case 'local':
      // Empieza a cargar el modelo en segundo plano; el servidor arranca igual.
      return new LocalWhisperProvider(config, app.log);
    case 'openai':
      return new OpenAITranscriptionProvider(openai(), config);
  }
}

function createSpeaker(config: AppConfig, openai: () => OpenAI): SpeechProvider | null {
  switch (config.TTS_PROVIDER) {
    case 'off':
      return null;
    case 'mock':
      return new MockSpeechProvider();
    case 'openai':
      return new OpenAISpeechProvider(openai(), config);
  }
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

  let openaiClient = deps.openai;
  const openai = () => (openaiClient ??= createOpenAI(config));
  const transcriber = deps.transcriber !== undefined ? deps.transcriber : createTranscriber(config, app, openai);
  const speakService = new SpeakService(deps.speaker !== undefined ? deps.speaker : createSpeaker(config, openai), app.log, {
    timeoutMs: config.TTS_TIMEOUT_MS,
  });
  app.addHook('onClose', async () => transcriber?.close?.());
  const transcribeService = new TranscribeService(
    transcriber,
    { timeoutMs: config.STT_TIMEOUT_MS, concurrency: config.STT_CONCURRENCY, maxQueued: config.STT_QUEUE_MAX },
    app.log,
  );

  await app.register(healthRoutes, { sttStatus: () => transcribeService.status, ttsStatus: () => speakService.status });
  const urlVerifier =
    deps.urlVerifier ??
    new UrlVerifier({
      timeoutMs: config.URL_CHECK_TIMEOUT_MS,
      maxRedirects: config.URL_CHECK_MAX_REDIRECTS,
      cacheTtlMs: config.URL_CHECK_CACHE_TTL_MS,
      // S03: http solo con una razón visible para la persona; hoy no hay, así que solo https.
      allowHttp: false,
    });
  const interpretService = new InterpretService(model, sessions, new UrlGuard(urlVerifier), {
    webSearch: config.INTERPRET_WEB_SEARCH === 'on',
    webSearchMaxUses: config.INTERPRET_WEB_SEARCH_MAX_USES,
  });
  await app.register(interpretRoutes, { service: interpretService });
  // El paso a paso real de una tarea: al empezar una opción (next-step) o al pedir algo que no estaba entre las opciones (options).
  const researcher = new ProcedureResearcher(model, {
    webSearch: config.GUIDE_WEB_SEARCH === 'on',
    webSearchMaxUses: config.GUIDE_WEB_SEARCH_MAX_USES,
  });
  await app.register(optionsRoutes, { service: new OptionsService(model, sessions, researcher) });
  await app.register(nextStepRoutes, { service: new NextStepService(model, sessions, researcher) });
  await app.register(transcribeRoutes, {
    service: transcribeService,
    rateLimit: { max: config.STT_RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW_MS },
  });
  await app.register(speakRoutes, {
    service: speakService,
    rateLimit: { max: config.TTS_RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW_MS },
  });

  const { service: siteCheck, authority } = createSiteCheckService(config, model, deps.siteCheck);
  // Descarga el registro de instituciones del BCU en segundo plano al arrancar (no en pruebas).
  if (config.NODE_ENV !== 'test') authority.warmUp();
  await app.register(siteCheckRoutes, {
    service: siteCheck,
    rateLimitMax: config.SITE_CHECK_RATE_LIMIT_MAX,
    rateLimitWindowMs: config.RATE_LIMIT_WINDOW_MS,
  });

  return app;
}

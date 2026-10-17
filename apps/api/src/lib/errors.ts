import type { ApiError, ErrorCode } from '@hackaton/contracts';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  AI_INVALID_RESPONSE: 502,
  AI_REFUSED: 422,
  TIMEOUT: 504,
  INTERNAL: 500,
};

const RETRYABLE: ReadonlySet<ErrorCode> = new Set(['RATE_LIMITED', 'AI_UNAVAILABLE', 'TIMEOUT']);

export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = STATUS_BY_CODE[code];
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

export function toApiError(error: AppError, requestId: string): ApiError {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      retryable: error.retryable,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}

function normalize(error: FastifyError | Error): AppError {
  if (error instanceof AppError) return error;

  if (hasZodFastifySchemaValidationErrors(error)) {
    const details = error.validation.slice(0, 20).map((issue) => ({
      path: issue.instancePath || '/',
      message: issue.message ?? 'inválido',
    }));
    return new AppError('BAD_REQUEST', 'La solicitud no cumple el contrato', details);
  }

  const statusCode = 'statusCode' in error ? error.statusCode : undefined;
  if (statusCode === 413) return new AppError('PAYLOAD_TOO_LARGE', 'El cuerpo supera el límite permitido');
  if (statusCode === 429) return new AppError('RATE_LIMITED', 'Demasiadas solicitudes');
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return new AppError('BAD_REQUEST', 'Solicitud inválida');
  }
  return new AppError('INTERNAL', 'Error interno');
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const appError = normalize(error as FastifyError);
    const log = { code: appError.code, statusCode: appError.statusCode, route: request.routeOptions.url };
    if (appError.statusCode >= 500) {
      // Se registra el tipo de error, no mensajes que puedan arrastrar contenido.
      request.log.error({ ...log, errorName: (error as Error).name }, 'request failed');
    } else {
      request.log.info(log, 'request rejected');
    }
    return reply.status(appError.statusCode).send(toApiError(appError, request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    const appError = new AppError('NOT_FOUND', 'Ruta inexistente');
    return reply.status(404).send(toApiError(appError, request.id));
  });
}

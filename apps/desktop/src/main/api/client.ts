/**
 * Cliente del backend de Agustin (API v1.2, ver docs/api.md). El proceso
 * principal es el único que habla con el servidor; la interfaz propia y la
 * página nunca lo hacen.
 */
import type { ErrorCode, InterpretRequest, InterpretResponse, OptionsRequest, OptionsResponse } from '@hackaton/contracts';

export interface ApiClient {
  readonly isMock: boolean;
  /** POST /v1/interpret: chat de la home. */
  interpret(request: InterpretRequest, signal: AbortSignal): Promise<InterpretResponse>;
  /** POST /v1/options: opciones de la página y próximo paso de la guía. */
  options(request: OptionsRequest, signal: AbortSignal): Promise<OptionsResponse>;
}

export type ClientErrorCode = ErrorCode | 'NETWORK' | 'INVALID_RESPONSE' | 'ABORTED';

export class ApiFailure extends Error {
  constructor(
    readonly code: ClientErrorCode,
    readonly retryable: boolean,
    message: string = code,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

export function isAbort(error: unknown): boolean {
  return (error instanceof ApiFailure && error.code === 'ABORTED') || (error instanceof Error && error.name === 'AbortError');
}

/** Mensaje en lenguaje simple para mostrar. Nunca expone detalles técnicos. */
export function userMessage(error: unknown): string {
  const code = error instanceof ApiFailure ? error.code : 'INTERNAL';
  switch (code) {
    case 'NETWORK':
    case 'TIMEOUT':
      return 'No pude conectarme con el asistente. Revisá tu conexión e intentá de nuevo. Podés seguir usando la página normalmente.';
    case 'RATE_LIMITED':
      return 'El asistente está recibiendo muchas consultas. Esperá un momento e intentá de nuevo.';
    case 'UNAUTHORIZED':
      return 'La app no pudo identificarse con el asistente. Avisá a quien te la instaló.';
    case 'PAYLOAD_TOO_LARGE':
      return 'Esta página es demasiado grande para analizarla. Podés seguir usándola normalmente.';
    case 'AI_REFUSED':
      return 'El asistente no puede ayudarte con eso. Probá contarlo de otra manera.';
    case 'AI_UNAVAILABLE':
    case 'AI_INVALID_RESPONSE':
    case 'INVALID_RESPONSE':
      return 'El asistente no pudo responder ahora. Intentá de nuevo en un momento.';
    default:
      return 'Algo salió mal. Intentá de nuevo; la página sigue disponible.';
  }
}

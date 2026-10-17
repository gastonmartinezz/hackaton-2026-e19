/**
 * Cliente del backend de Agustin. El proceso principal es el único que habla
 * con el servidor; la interfaz propia y la página nunca lo hacen.
 */
import type {
  ApiErrorCode,
  DestinationSearchRequest,
  DestinationSearchResponse,
  GuidanceNextRequest,
  InterpretIntentRequest,
  InterpretIntentResponse,
  PageOptionsRequest,
} from '@hackaton/contracts';

export interface ApiClient {
  readonly isMock: boolean;
  interpretIntent(request: InterpretIntentRequest, signal: AbortSignal): Promise<InterpretIntentResponse>;
  searchDestinations(request: DestinationSearchRequest, signal: AbortSignal): Promise<DestinationSearchResponse>;
  /** Devuelve el JSON sin interpretar: lo valida @asistente/guidance con el contexto local. */
  pageOptions(request: PageOptionsRequest, signal: AbortSignal): Promise<unknown>;
  /** Devuelve el JSON sin interpretar: lo valida @asistente/guidance con el contexto local. */
  guidanceNext(request: GuidanceNextRequest, signal: AbortSignal): Promise<unknown>;
  endSession(): Promise<void>;
}

export type ClientErrorCode = ApiErrorCode | 'network' | 'invalid_response' | 'aborted';

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
  return (error instanceof ApiFailure && error.code === 'aborted') || (error instanceof Error && error.name === 'AbortError');
}

/** Mensaje en lenguaje simple para mostrar. Nunca expone detalles técnicos. */
export function userMessage(error: unknown): string {
  const code = error instanceof ApiFailure ? error.code : 'internal';
  switch (code) {
    case 'network':
    case 'timeout':
      return 'No pude conectarme con el asistente. Revisá tu conexión e intentá de nuevo. Podés seguir usando la página normalmente.';
    case 'rate_limited':
      return 'El asistente está recibiendo muchas consultas. Esperá un momento e intentá de nuevo.';
    case 'unauthorized':
      return 'La app no pudo identificarse con el asistente. Avisá a quien te la instaló.';
    case 'payload_too_large':
      return 'Esta página es demasiado grande para analizarla. Podés seguir usándola normalmente.';
    case 'provider_unavailable':
    case 'provider_refused':
    case 'invalid_response':
      return 'El asistente no pudo responder ahora. Intentá de nuevo en un momento.';
    default:
      return 'Algo salió mal. Intentá de nuevo; la página sigue disponible.';
  }
}

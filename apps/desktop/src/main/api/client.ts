/**
 * Cliente del backend de Agustin (API v1.2, ver docs/api.md). El proceso
 * principal es el único que habla con el servidor; la interfaz propia y la
 * página nunca lo hacen.
 */
import type {
  ErrorCode,
  InterpretRequest,
  InterpretResponse,
  NextStepRequest,
  NextStepResponse,
  OptionsRequest,
  OptionsResponse,
  SpeakRequest,
  TranscribeResponse,
  SiteCheckRequest,
  SiteCheckResponse,
} from '@hackaton/contracts';

export interface ApiClient {
  readonly isMock: boolean;
  /** POST /v1/interpret: chat de la home. */
  interpret(request: InterpretRequest, signal: AbortSignal): Promise<InterpretResponse>;
  /** POST /v1/options: opciones de la página, cada una con su guía. */
  options(request: OptionsRequest, signal: AbortSignal): Promise<OptionsResponse>;
  /** POST /v1/next-step: pasos reales cuando la guía llega a un paso teórico. */
  nextStep(request: NextStepRequest, signal: AbortSignal): Promise<NextStepResponse>;
  /** POST /v1/transcribe: dictado del buscador, con `wav` ya revisado (shared/wav.ts). */
  transcribe(wav: Uint8Array, signal: AbortSignal): Promise<TranscribeResponse>;
  /**
   * POST /v1/speak: lee en voz alta un texto de Guíame. Resuelve cuando el
   * servidor aceptó (200 con `audio/mpeg`) y devuelve el MP3 en pedazos a
   * medida que llega, para empezar a reproducir antes de que termine. Los
   * errores previos rechazan la promesa; los del medio los tira el iterador.
   */
  speak(request: SpeakRequest, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
  /** POST /v1/site-check: protección de sitios (fase dirección o contenido). */
  siteCheck(request: SiteCheckRequest, signal: AbortSignal): Promise<SiteCheckResponse>;
}

/**
 * Sesión del backend: la crea /v1/interpret (o /v1/options si se abrió una
 * página sin pasar por el chat) y acompaña todo el recorrido. Se comparte
 * entre el chat y la guía.
 *
 * Cada solicitud toma la sesión con `begin()` y guarda la respuesta con
 * `commit()`: si mientras tanto alguien la reinició o la cambió, la respuesta
 * tardía no pisa el valor actual.
 */
export class ApiSession {
  #id: string | undefined;
  #generation = 0;

  get id(): string | undefined {
    return this.#id;
  }

  begin(): SessionTicket {
    const id = this.#id;
    const generation = this.#generation;
    const current = () => generation === this.#generation && id === this.#id;
    return {
      id,
      commit: (next) => {
        if (!current()) return false;
        this.#id = next;
        return true;
      },
      expire: () => {
        if (current()) this.reset();
        return this.begin();
      },
    };
  }

  /** Inicio o «Empezar de nuevo»: invalida toda solicitud en curso. */
  reset(): void {
    this.#id = undefined;
    this.#generation++;
  }
}

export interface SessionTicket {
  /** Sesión al empezar la solicitud. */
  readonly id: string | undefined;
  /** Guarda la sesión devuelta; false si la sesión cambió en el medio. */
  commit(id: string): boolean;
  /**
   * SESSION_NOT_FOUND: descarta la sesión solo si sigue siendo la misma, y
   * devuelve un ticket para reintentar con la vigente (ninguna, o la que otra
   * solicitud guardó mientras tanto).
   */
  expire(): SessionTicket;
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

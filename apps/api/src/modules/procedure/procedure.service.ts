import type { ErrorCode } from '@hackaton/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { ProcedureOutput } from '../ai/schemas.js';
import type { SessionContext } from '../sessions/session-store.js';

export interface ProcedureOptions {
  /** La tarea procedure busca en la web el paso a paso real (GUIDE_WEB_SEARCH). */
  webSearch: boolean;
  webSearchMaxUses: number;
}

/**
 * Qué se investiga: una opción de la página (su título y los primeros pasos que
 * se vieron) o lo que la persona pidió con sus palabras y no estaba entre las opciones.
 */
export type ProcedureSubject = { option: { title: string; steps: string[] } } | { request: string };

/** Después de un fallo, cuánto se guía sin el paso a paso antes de volver a investigarlo. */
const FAILURE_COOLDOWN_MS = 10 * 60_000;

/** Errores del paso a paso que permiten guiar igual, sin él. El resto se propaga. */
const RECOVERABLE_PROCEDURE_ERRORS: ReadonlySet<ErrorCode> = new Set(['AI_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED', 'AI_INVALID_RESPONSE', 'AI_REFUSED']);

/**
 * Investiga el paso a paso real de una tarea en el sitio actual. Lo usan
 * /v1/next-step (al empezar una opción) y /v1/options (cuando la persona pide
 * algo que no está entre las opciones). No guarda el resultado: cada servicio
 * lo guarda en la sesión con el id de la opción que corresponde.
 *
 * `key` identifica qué se investiga (sesión y opción o pedido): si ya hay una
 * investigación en curso con esa clave (el front volvió a llamar mientras
 * tanto), se espera esa en vez de buscar de nuevo; y después de un fallo no se
 * vuelve a intentar durante FAILURE_COOLDOWN_MS.
 */
export class ProcedureResearcher {
  readonly #inFlight = new Map<string, Promise<ProcedureOutput | undefined>>();
  readonly #failedAt = new Map<string, number>();

  constructor(
    private readonly model: StructuredModel,
    private readonly options: ProcedureOptions = { webSearch: false, webSearchMaxUses: 3 },
    private readonly now: () => number = Date.now,
  ) {}

  /** Si falla por un motivo pasajero o del modelo, devuelve undefined y se guía igual sin él. */
  research(key: string, context: SessionContext, subject: ProcedureSubject, log: FastifyBaseLogger): Promise<ProcedureOutput | undefined> {
    const failed = this.#failedAt.get(key);
    if (failed !== undefined && this.now() - failed < FAILURE_COOLDOWN_MS) return Promise.resolve(undefined);
    const running = this.#inFlight.get(key);
    if (running) return running;
    const research = this.#research(key, context, subject, log).finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, research);
    return research;
  }

  async #research(key: string, context: SessionContext, subject: ProcedureSubject, log: FastifyBaseLogger): Promise<ProcedureOutput | undefined> {
    try {
      const output = await this.model.generate({
        task: 'procedure',
        system: this.options.webSearch ? SYSTEM_PROMPTS.procedureWithSearch : SYSTEM_PROMPTS.procedure,
        input: { context, ...subject, site: siteOf(context) },
        schema: ProcedureOutput,
        // Sin ubicación: la sesión no la guarda y la API rechaza algunos países (UY da 400).
        ...(this.options.webSearch ? { webSearch: { maxUses: this.options.webSearchMaxUses } } : {}),
      });
      log.info({ task: 'procedure', subject: 'request' in subject ? 'request' : 'option', steps: output.steps.length, sources: output.sources.length }, 'procedure ready');
      this.#failedAt.delete(key);
      return output;
    } catch (error) {
      if (!(error instanceof AppError) || !RECOVERABLE_PROCEDURE_ERRORS.has(error.code)) throw error;
      // Solo el código: nunca el contenido.
      log.warn({ task: 'procedure', code: error.code }, 'procedure failed, guiding without it');
      this.#failedAt.set(key, this.now());
      // Los fallos viejos no se acumulan.
      for (const [other, at] of this.#failedAt) if (this.now() - at >= FAILURE_COOLDOWN_MS) this.#failedAt.delete(other);
      return undefined;
    }
  }
}

/** La página actual (título y sitio) y las direcciones que se abrieron desde el buscador (interpret). */
function siteOf(context: SessionContext): { title: string | null; origin: string | null; urls: string[] } {
  const urls = context.history.flatMap((entry) => (entry.type === 'interpret' ? entry.urls : []));
  return { title: context.metadata.page?.title ?? null, origin: context.metadata.page?.origin ?? null, urls: [...new Set(urls)].slice(-5) };
}

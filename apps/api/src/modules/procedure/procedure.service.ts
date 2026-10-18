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

/** Errores del paso a paso que permiten guiar igual, sin él. El resto se propaga. */
const RECOVERABLE_PROCEDURE_ERRORS: ReadonlySet<ErrorCode> = new Set(['AI_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED', 'AI_INVALID_RESPONSE', 'AI_REFUSED']);

/**
 * Investiga el paso a paso real de una tarea en el sitio actual. Lo usan
 * /v1/next-step (al empezar una opción) y /v1/options (cuando la persona pide
 * algo que no está entre las opciones). No guarda nada: cada servicio lo
 * guarda en la sesión con el id de la opción que corresponde.
 */
export class ProcedureResearcher {
  constructor(
    private readonly model: StructuredModel,
    private readonly options: ProcedureOptions = { webSearch: false, webSearchMaxUses: 3 },
  ) {}

  /** Si falla por un motivo pasajero o del modelo, devuelve undefined y se guía igual sin él. */
  async research(context: SessionContext, subject: ProcedureSubject, log: FastifyBaseLogger): Promise<ProcedureOutput | undefined> {
    try {
      const output = await this.model.generate({
        task: 'procedure',
        system: this.options.webSearch ? SYSTEM_PROMPTS.procedureWithSearch : SYSTEM_PROMPTS.procedure,
        input: { context, ...subject, site: siteOf(context) },
        schema: ProcedureOutput,
        // Sin ubicación: la sesión no la guarda y la API rechaza algunos países (ver InterpretService).
        ...(this.options.webSearch ? { webSearch: { maxUses: this.options.webSearchMaxUses, userLocation: {} } } : {}),
      });
      log.info({ task: 'procedure', subject: 'request' in subject ? 'request' : 'option', steps: output.steps.length, sources: output.sources.length }, 'procedure ready');
      return output;
    } catch (error) {
      if (!(error instanceof AppError) || !RECOVERABLE_PROCEDURE_ERRORS.has(error.code)) throw error;
      // Solo el código: nunca el contenido.
      log.warn({ task: 'procedure', code: error.code }, 'procedure failed, guiding without it');
      return undefined;
    }
  }
}

/** Título de la página y direcciones que se abrieron desde el buscador (interpret). */
function siteOf(context: SessionContext): { title: string | null; urls: string[] } {
  const urls = context.history.flatMap((entry) => (entry.type === 'interpret' ? entry.urls : []));
  return { title: context.metadata.page?.title ?? null, urls: [...new Set(urls)].slice(-5) };
}

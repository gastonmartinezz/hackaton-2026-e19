import { OptionsResponse, type ErrorCode, type OptionsRequest, type PageOption } from '@hackaton/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { MatchOutput, OptionsOutput } from '../ai/schemas.js';
import { toGuideSteps } from '../ai/steps.js';
import type { ProcedureResearcher } from '../procedure/procedure.service.js';
import type { SessionContext, SessionStore } from '../sessions/session-store.js';

/** Si interpretar el pedido contra las opciones falla por esto, se sigue por el camino largo. */
const RECOVERABLE_MATCH_ERRORS: ReadonlySet<ErrorCode> = new Set(['AI_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED', 'AI_INVALID_RESPONSE', 'AI_REFUSED']);

const silentLog = { info: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;

export class OptionsService {
  constructor(
    private readonly model: StructuredModel,
    private readonly sessions: SessionStore,
    private readonly researcher: ProcedureResearcher,
  ) {}

  /**
   * Opciones de la página. Con `request` (lo que la persona pidió con sus
   * palabras teniendo las opciones a la vista):
   * 1. Se interpreta contra las opciones que ya se le mostraron, sin buscar en
   *    internet. Si una lo hace, se devuelve esa (es rápido).
   * 2. Si ninguna lo hace, se investiga cómo se hace en este sitio (búsqueda
   *    web) y se arma esa tarea con el camino desde esta página.
   */
  async options(request: OptionsRequest, owner: string, log: FastifyBaseLogger = silentLog): Promise<OptionsResponse> {
    const sessionId = request.sessionId ?? this.sessions.create(owner);
    if (!this.sessions.context(sessionId, owner)) {
      throw new AppError('SESSION_NOT_FOUND', 'Sesión inexistente o vencida');
    }
    this.sessions.mergeMetadata(sessionId, owner, request.metadata);

    const context = this.sessions.context(sessionId, owner)!;
    const asked = request.request;
    if (asked) {
      const shown = await this.matchShown(context, asked, log);
      // No era un pedido: no se busca nada y quedan las mismas opciones.
      if (shown?.unclear) return { sessionId, options: shown.options, requestUnclear: true };
      if (shown?.requested) {
        const { options, requested } = shown;
        this.sessions.append(sessionId, owner, { type: 'options', ...(request.goal ? { goal: request.goal } : {}), options, request: asked });
        return { sessionId, options: [requested, ...options.filter((o) => o !== requested)], requestedOptionId: requested.id };
      }
    }
    const procedure = asked ? await this.researcher.research(`${sessionId}:request:${asked}`, context, { request: asked }, log) : undefined;
    const output = await this.model.generate({
      task: 'options',
      system: asked ? SYSTEM_PROMPTS.optionsForRequest : SYSTEM_PROMPTS.options,
      input: {
        context,
        goal: request.goal ?? null,
        html: request.html,
        ...(asked ? { request: asked, procedure: procedure ? { summary: procedure.summary, steps: procedure.steps, completion: procedure.completion } : null } : {}),
      },
      schema: OptionsOutput,
    });

    const options = output.options.map((option) => ({ ...option, steps: toGuideSteps(option.steps) }));
    // La opción pedida solo vale si existe en la respuesta; va primera.
    const requested = asked ? options.find((option) => option.id === output.requestedOptionId) : undefined;
    if (requested) options.unshift(...options.splice(options.indexOf(requested), 1));
    const parsed = OptionsResponse.safeParse({ sessionId, options, ...(requested ? { requestedOptionId: requested.id } : {}) });
    if (!parsed.success) throw new AppError('AI_INVALID_RESPONSE', 'Respuesta de Claude incoherente con el contrato');

    this.sessions.append(sessionId, owner, {
      type: 'options',
      ...(request.goal ? { goal: request.goal } : {}),
      options: parsed.data.options,
      ...(asked ? { request: asked } : {}),
    });
    // El paso a paso investigado queda solo para la opción pedida: /v1/next-step no lo vuelve a buscar.
    // Si ninguna opción hace lo pedido, no se le pega a otra tarea.
    if (procedure && requested) this.sessions.append(sessionId, owner, { type: 'procedure', optionId: requested.id, ...procedure });
    return parsed.data;
  }

  /** Paso 1: ¿alguna de las opciones que ya vio la persona hace lo que pide? Sin búsqueda web. */
  private async matchShown(
    context: SessionContext,
    asked: string,
    log: FastifyBaseLogger,
  ): Promise<{ options: PageOption[]; requested?: PageOption; unclear?: true } | undefined> {
    const options = latestOptions(context);
    if (options.length === 0) return undefined;
    try {
      const { optionId, isRequest } = await this.model.generate({
        task: 'match',
        system: SYSTEM_PROMPTS.match,
        input: { context, request: asked, options: options.map(({ id, title }) => ({ id, title })) },
        schema: MatchOutput,
      });
      const requested = options.find((option) => option.id === optionId);
      log.info({ task: 'match', matched: Boolean(requested), isRequest }, 'options request matched');
      if (requested) return { options, requested };
      return isRequest ? undefined : { options, unclear: true };
    } catch (error) {
      if (!(error instanceof AppError) || !RECOVERABLE_MATCH_ERRORS.has(error.code)) throw error;
      log.warn({ task: 'match', code: error.code }, 'match failed, researching');
      return undefined;
    }
  }
}

/** Las últimas opciones que se le mostraron a la persona en esta sesión. */
function latestOptions(context: SessionContext): PageOption[] {
  for (let i = context.history.length - 1; i >= 0; i--) {
    const entry = context.history[i];
    if (entry?.type === 'options') return entry.options;
  }
  return [];
}

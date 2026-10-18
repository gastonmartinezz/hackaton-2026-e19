import { OptionsResponse, type OptionsRequest } from '@hackaton/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { OptionsOutput } from '../ai/schemas.js';
import { toGuideSteps } from '../ai/steps.js';
import type { ProcedureResearcher } from '../procedure/procedure.service.js';
import type { SessionStore } from '../sessions/session-store.js';

const silentLog = { info: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;

export class OptionsService {
  constructor(
    private readonly model: StructuredModel,
    private readonly sessions: SessionStore,
    private readonly researcher: ProcedureResearcher,
  ) {}

  /**
   * Opciones de la página. Con `request` (la persona pidió algo que no estaba
   * entre las opciones), primero se investiga cómo se hace en este sitio y la
   * primera opción es esa tarea, con el camino desde esta página.
   */
  async options(request: OptionsRequest, owner: string, log: FastifyBaseLogger = silentLog): Promise<OptionsResponse> {
    const sessionId = request.sessionId ?? this.sessions.create(owner);
    if (!this.sessions.context(sessionId, owner)) {
      throw new AppError('SESSION_NOT_FOUND', 'Sesión inexistente o vencida');
    }
    this.sessions.mergeMetadata(sessionId, owner, request.metadata);

    const context = this.sessions.context(sessionId, owner)!;
    const asked = request.request;
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
}

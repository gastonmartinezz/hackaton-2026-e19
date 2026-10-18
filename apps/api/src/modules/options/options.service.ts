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
    const procedure = asked ? await this.researcher.research(context, { request: asked }, log) : undefined;
    const output = await this.model.generate({
      task: 'options',
      system: asked ? SYSTEM_PROMPTS.optionsForRequest : SYSTEM_PROMPTS.options,
      input: {
        context,
        html: request.html,
        ...(asked ? { request: asked, procedure: procedure ? { summary: procedure.summary, steps: procedure.steps, completion: procedure.completion } : null } : {}),
      },
      schema: OptionsOutput,
    });

    const options = output.options.map((option) => ({ ...option, steps: toGuideSteps(option.steps) }));
    const parsed = OptionsResponse.safeParse({ sessionId, options });
    if (!parsed.success) throw new AppError('AI_INVALID_RESPONSE', 'Respuesta de Claude incoherente con el contrato');

    this.sessions.append(sessionId, owner, { type: 'options', options: parsed.data.options, ...(asked ? { request: asked } : {}) });
    // El paso a paso investigado queda para la primera opción (la tarea pedida): /v1/next-step no lo vuelve a buscar.
    const first = parsed.data.options[0];
    if (procedure && first) this.sessions.append(sessionId, owner, { type: 'procedure', optionId: first.id, ...procedure });
    return parsed.data;
  }
}

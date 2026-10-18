import { NextStepResponse, type NextStepRequest, type PageOption } from '@hackaton/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { NextStepOutput } from '../ai/schemas.js';
import { toGuideSteps, verifiedEvidence } from '../ai/steps.js';
import type { ProcedureResearcher } from '../procedure/procedure.service.js';
import type { SessionEntry, SessionStore } from '../sessions/session-store.js';

type Procedure = Extract<SessionEntry, { type: 'procedure' }>;

const silentLog = { info: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;

export class NextStepService {
  constructor(
    private readonly model: StructuredModel,
    private readonly sessions: SessionStore,
    private readonly researcher: ProcedureResearcher,
  ) {}

  async next(request: NextStepRequest, owner: string, log: FastifyBaseLogger = silentLog): Promise<NextStepResponse> {
    const existing = this.sessions.context(request.sessionId, owner);
    if (!existing) throw new AppError('SESSION_NOT_FOUND', 'Sesión inexistente o vencida');

    const option = findOption(existing.history, request.optionId);
    if (!option) throw new AppError('BAD_REQUEST', 'optionId no corresponde a ninguna opción de esta sesión');

    this.sessions.mergeMetadata(request.sessionId, owner, request.metadata);
    const procedure = findProcedure(existing.history, request.optionId) ?? (await this.research(request, owner, option, log));

    const context = this.sessions.context(request.sessionId, owner)!;
    const output = await this.model.generate({
      task: 'nextStep',
      system: SYSTEM_PROMPTS.nextStep,
      input: {
        option,
        expectedStep: request.expectedStep,
        completedSteps: request.completedSteps,
        procedure: procedure ? { summary: procedure.summary, steps: procedure.steps, completion: procedure.completion } : null,
        // El paso a paso ya va en procedure: no se repite en el recorrido.
        context: { ...context, history: context.history.filter((entry) => entry.type !== 'procedure') },
        html: request.html,
      },
      schema: NextStepOutput,
    });

    // «Listo» solo con evidencia literal de la página: si la cita no está en el HTML, se descarta.
    const evidence = output.done ? verifiedEvidence(output.evidence, request.html) : null;
    const parsed = NextStepResponse.safeParse({
      sessionId: request.sessionId,
      steps: output.done ? [] : toGuideSteps(output.steps),
      done: output.done,
      ...(evidence ? { evidence } : {}),
    });
    if (!parsed.success) throw new AppError('AI_INVALID_RESPONSE', 'Respuesta de Claude incoherente con el contrato');
    if (output.done && output.evidence && !evidence) log.info({ task: 'nextStep' }, 'next-step evidence dropped');

    this.sessions.append(request.sessionId, owner, {
      type: 'nextStep',
      optionId: request.optionId,
      expectedStep: request.expectedStep,
      completedSteps: request.completedSteps,
      steps: parsed.data.steps,
      done: parsed.data.done,
    });
    return parsed.data;
  }

  /**
   * Paso a paso real de la opción (una sola vez por opción y sesión). Si falla
   * por un motivo pasajero o del modelo, se guía igual sin él y se vuelve a
   * intentar en la próxima llamada.
   */
  private async research(request: NextStepRequest, owner: string, option: PageOption, log: FastifyBaseLogger): Promise<Procedure | undefined> {
    const context = this.sessions.context(request.sessionId, owner)!;
    const output = await this.researcher.research(`${request.sessionId}:option:${request.optionId}`, context, { option: { title: option.title, steps: option.steps.map((s) => s.instruction) } }, log);
    if (!output) return undefined;
    // Dos llamadas que esperaron la misma investigación la guardan una sola vez.
    const stored = findProcedure(this.sessions.context(request.sessionId, owner)?.history ?? [], request.optionId);
    if (stored) return stored;
    const procedure: Procedure = { type: 'procedure', optionId: request.optionId, ...output };
    this.sessions.append(request.sessionId, owner, procedure);
    return procedure;
  }
}

/** La opción más reciente con ese id devuelta por /v1/options en la sesión. */
function findOption(history: SessionEntry[], optionId: string): PageOption | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry?.type !== 'options') continue;
    const option = entry.options.find((candidate) => candidate.id === optionId);
    if (option) return option;
  }
  return undefined;
}

/**
 * El paso a paso de la opción, si ya se investigó después de las últimas
 * opciones con ese id (otra página puede reusar el id para otra tarea).
 */
function findProcedure(history: SessionEntry[], optionId: string): Procedure | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry?.type === 'procedure' && entry.optionId === optionId) return entry;
    if (entry?.type === 'options' && entry.options.some((candidate) => candidate.id === optionId)) return undefined;
  }
  return undefined;
}

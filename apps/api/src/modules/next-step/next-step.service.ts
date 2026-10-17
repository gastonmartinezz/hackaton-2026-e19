import { NextStepResponse, type NextStepRequest, type PageOption } from '@hackaton/contracts';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { NextStepOutput } from '../ai/schemas.js';
import type { SessionEntry, SessionStore } from '../sessions/session-store.js';

export class NextStepService {
  constructor(
    private readonly model: StructuredModel,
    private readonly sessions: SessionStore,
  ) {}

  async next(request: NextStepRequest, owner: string): Promise<NextStepResponse> {
    const existing = this.sessions.context(request.sessionId, owner);
    if (!existing) throw new AppError('SESSION_NOT_FOUND', 'Sesión inexistente o vencida');

    const option = findOption(existing.history, request.optionId);
    if (!option) throw new AppError('BAD_REQUEST', 'optionId no corresponde a ninguna opción de esta sesión');

    this.sessions.mergeMetadata(request.sessionId, request.metadata);
    const output = await this.model.generate({
      task: 'nextStep',
      system: SYSTEM_PROMPTS.nextStep,
      input: {
        option,
        expectedStep: request.expectedStep,
        completedSteps: request.completedSteps,
        context: this.sessions.context(request.sessionId, owner),
        html: request.html,
      },
      schema: NextStepOutput,
    });

    const parsed = NextStepResponse.safeParse({ sessionId: request.sessionId, ...output });
    if (!parsed.success) throw new AppError('AI_INVALID_RESPONSE', 'Respuesta de Claude incoherente con el contrato');

    this.sessions.append(request.sessionId, {
      type: 'nextStep',
      optionId: request.optionId,
      expectedStep: request.expectedStep,
      completedSteps: request.completedSteps,
      steps: parsed.data.steps,
      done: parsed.data.done,
    });
    return parsed.data;
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

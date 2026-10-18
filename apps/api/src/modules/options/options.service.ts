import { OptionsResponse, type OptionsRequest } from '@hackaton/contracts';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { OptionsOutput } from '../ai/schemas.js';
import { toGuideSteps } from '../ai/steps.js';
import type { SessionStore } from '../sessions/session-store.js';

export class OptionsService {
  constructor(
    private readonly model: StructuredModel,
    private readonly sessions: SessionStore,
  ) {}

  async options(request: OptionsRequest, owner: string): Promise<OptionsResponse> {
    const sessionId = request.sessionId ?? this.sessions.create(owner);
    if (!this.sessions.context(sessionId, owner)) {
      throw new AppError('SESSION_NOT_FOUND', 'Sesión inexistente o vencida');
    }
    this.sessions.mergeMetadata(sessionId, owner, request.metadata);

    const output = await this.model.generate({
      task: 'options',
      system: SYSTEM_PROMPTS.options,
      input: { context: this.sessions.context(sessionId, owner), html: request.html },
      schema: OptionsOutput,
    });

    const options = output.options.map((option) => ({ ...option, steps: toGuideSteps(option.steps) }));
    const parsed = OptionsResponse.safeParse({ sessionId, options });
    if (!parsed.success) throw new AppError('AI_INVALID_RESPONSE', 'Respuesta de Claude incoherente con el contrato');

    this.sessions.append(sessionId, owner, { type: 'options', options: parsed.data.options });
    return parsed.data;
  }
}

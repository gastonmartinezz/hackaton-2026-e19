import { OptionsResponse, type OptionsRequest } from '@hackaton/contracts';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { OptionsOutput } from '../ai/schemas.js';
import type { SessionStore } from '../sessions/session-store.js';

export class OptionsService {
  constructor(
    private readonly model: StructuredModel,
    private readonly sessions: SessionStore,
  ) {}

  async options(request: OptionsRequest, owner: string): Promise<OptionsResponse> {
    let sessionId = request.sessionId;
    let history = sessionId ? this.sessions.history(sessionId, owner) : [];
    if (!history) throw new AppError('SESSION_NOT_FOUND', 'Sesión inexistente o vencida');
    if (!sessionId) {
      sessionId = this.sessions.create(owner);
      history = [];
    }

    const output = await this.model.generate({
      task: 'options',
      system: SYSTEM_PROMPTS.options,
      input: { goal: request.goal, history: [...history], html: request.html },
      schema: OptionsOutput,
    });

    const parsed = OptionsResponse.safeParse({ sessionId, ...output });
    if (!parsed.success) throw new AppError('AI_INVALID_RESPONSE', 'Respuesta de Claude incoherente con el contrato');

    this.sessions.append(sessionId, { goal: request.goal, options: parsed.data.options, guide: parsed.data.guide });
    return parsed.data;
  }
}

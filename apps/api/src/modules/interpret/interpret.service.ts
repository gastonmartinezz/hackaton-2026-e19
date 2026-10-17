import { InterpretResponse, type InterpretRequest } from '@hackaton/contracts';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { InterpretOutput } from '../ai/schemas.js';
import type { SessionStore } from '../sessions/session-store.js';

export class InterpretService {
  constructor(
    private readonly model: StructuredModel,
    private readonly sessions: SessionStore,
  ) {}

  async interpret(request: InterpretRequest, owner: string): Promise<InterpretResponse> {
    const sessionId = request.sessionId ?? this.sessions.create(owner);
    const context = this.sessions.context(sessionId, owner);
    if (!context) throw new AppError('SESSION_NOT_FOUND', 'Sesión inexistente o vencida');

    const output = await this.model.generate({
      task: 'interpret',
      system: SYSTEM_PROMPTS.interpret,
      input: { messages: request.messages, history: context.history },
      schema: InterpretOutput,
      maxTokens: 2048,
    });

    // goal y reason quedan en la sesión; no se devuelven al front.
    const candidate =
      output.type === 'redirect'
        ? { sessionId, type: 'redirect', message: output.message, url: output.url }
        : output.type === 'options'
          ? { sessionId, type: 'options', message: output.message, options: output.options }
          : { sessionId, type: 'question', message: output.message };

    // Se valida contra el contrato: por ejemplo, rechaza URLs que no son http(s).
    const parsed = InterpretResponse.safeParse(candidate);
    if (!parsed.success) throw new AppError('AI_INVALID_RESPONSE', 'Respuesta de Claude incoherente con el contrato');

    this.sessions.setChat(sessionId, request.messages);
    this.sessions.append(sessionId, {
      type: 'interpret',
      response: output.type,
      goal: output.goal,
      reason: output.reason,
      urls: parsed.data.type === 'redirect' ? [parsed.data.url] : parsed.data.type === 'options' ? parsed.data.options.map((o) => o.url) : [],
    });
    return parsed.data;
  }
}

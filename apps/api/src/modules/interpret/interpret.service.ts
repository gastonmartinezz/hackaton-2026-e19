import { InterpretResponse, type InterpretRequest } from '@hackaton/contracts';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { InterpretOutput } from '../ai/schemas.js';

export class InterpretService {
  constructor(private readonly model: StructuredModel) {}

  async interpret(request: InterpretRequest): Promise<InterpretResponse> {
    const output = await this.model.generate({
      task: 'interpret',
      system: SYSTEM_PROMPTS.interpret,
      input: { messages: request.messages },
      schema: InterpretOutput,
      maxTokens: 2048,
    });

    const candidate =
      output.type === 'redirect'
        ? { type: 'redirect', message: output.message, url: output.url }
        : output.type === 'options'
          ? { type: 'options', message: output.message, options: output.options }
          : { type: 'question', message: output.message };

    // Se valida contra el contrato: por ejemplo, rechaza URLs que no son http(s).
    const parsed = InterpretResponse.safeParse(candidate);
    if (!parsed.success) throw new AppError('AI_INVALID_RESPONSE', 'Respuesta de Claude incoherente con el contrato');
    return parsed.data;
  }
}

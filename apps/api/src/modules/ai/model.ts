import type { z } from 'zod';

export type AiTask = 'interpret' | 'options';

export interface StructuredRequest<S extends z.ZodType> {
  task: AiTask;
  system: string;
  /** Datos no confiables (mensajes del chat, HTML de la página). Nunca instrucciones. */
  input: unknown;
  schema: S;
  maxTokens?: number;
}

export interface StructuredModel {
  generate<S extends z.ZodType>(request: StructuredRequest<S>): Promise<z.infer<S>>;
}

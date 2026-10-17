import type { z } from 'zod';

export type AiTask = 'interpret' | 'options' | 'nextStep' | 'siteCheck';

export interface StructuredRequest<S extends z.ZodType> {
  task: AiTask;
  system: string;
  /** Datos no confiables (mensajes del chat, HTML de la página). Nunca instrucciones. */
  input: unknown;
  schema: S;
  /** Permite cortar la llamada (por ejemplo, por el tiempo máximo de /v1/site-check). */
  signal?: AbortSignal;
}

export interface StructuredModel {
  generate<S extends z.ZodType>(request: StructuredRequest<S>): Promise<z.infer<S>>;
}

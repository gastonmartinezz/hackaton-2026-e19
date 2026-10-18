import type { z } from 'zod';

export type AiTask = 'interpret' | 'options' | 'nextStep';

export interface StructuredRequest<S extends z.ZodType> {
  task: AiTask;
  system: string;
  /** Datos no confiables (mensajes del chat, HTML de la página). Nunca instrucciones. */
  input: unknown;
  schema: S;
  /** Búsqueda web del servidor de Anthropic (solo interpret, si INTERPRET_WEB_SEARCH está activo). */
  webSearch?: WebSearchOptions;
}

export interface WebSearchOptions {
  maxUses: number;
  /** Ubicación aproximada para priorizar resultados locales. Sin país (ver InterpretService). */
  userLocation: { city?: string; region?: string; timezone?: string };
}

export interface StructuredModel {
  generate<S extends z.ZodType>(request: StructuredRequest<S>): Promise<z.infer<S>>;
}

import type { CoverageLevel, ReasonCode } from '@hackaton/contracts';

export type Observer = 'user_browser' | 'external_scanner' | 'service';

/** Hallazgo de una fuente antes de agregarse como motivo de la respuesta. */
export interface Finding {
  code: ReasonCode;
  source: string;
  checkedAt: string;
  observedBy: Observer;
  detail: string;
  /** Organización del catálogo que el sitio parece imitar. */
  impersonatedOrganization?: string;
}

/**
 * Resultado de una verificación. Lo comparten la ruta y las tools MCP: siempre trae
 * fuente, fecha, alcance (cobertura), limitaciones y errores.
 */
export interface SourceResult<T> {
  source: string;
  checkedAt: string;
  coverage: CoverageLevel;
  /** Vigencia del dato según la fuente. 0 si falló (no se guarda en caché). */
  ttlMs: number;
  limitations: string[];
  errors: string[];
  data: T | null;
  findings: Finding[];
}

/** Error de una fuente sin detalles que puedan arrastrar URLs o respuestas. */
export const errorKind = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout';
    if (error.name === 'BudgetExceededError') return 'rate_limited';
    if (error.name === 'BlockedHostError') return 'blocked_destination';
    if (error.name === 'ProviderHttpError') return error.message;
  }
  return 'provider_error';
};

export class ProviderHttpError extends Error {
  constructor(status: number) {
    super(`http_${status}`);
    this.name = 'ProviderHttpError';
  }
}

export function unavailable<T>(source: string, checkedAt: string, errors: string[], limitations: string[] = []): SourceResult<T> {
  return { source, checkedAt, coverage: 'unavailable', ttlMs: 0, limitations, errors, data: null, findings: [] };
}

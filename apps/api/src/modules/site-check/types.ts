import type { CoverageLevel, ReasonCode } from '@hackaton/contracts';

export type Observer = 'user_browser' | 'service';

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

/** Resultado de una fuente externa (RDAP, inspección de conexión): alcance, vigencia, errores, dato y hallazgos. */
export interface SourceResult<T> {
  coverage: CoverageLevel;
  /** Vigencia del dato según la fuente. 0 si falló (no se guarda en caché). */
  ttlMs: number;
  /** Motivo técnico de una falla o de un resultado parcial (`timeout`, `rate_limited`, `http_503`…). */
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

export function unavailable<T>(errors: string[]): SourceResult<T> {
  return { coverage: 'unavailable', ttlMs: 0, errors, data: null, findings: [] };
}

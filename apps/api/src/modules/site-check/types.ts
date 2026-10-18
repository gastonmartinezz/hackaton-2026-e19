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

/** Resultado de una fuente externa (RDAP, inspección de conexión): alcance, vigencia y hallazgos. */
export interface SourceResult {
  coverage: CoverageLevel;
  /** Vigencia del dato según la fuente. 0 si falló (no se guarda en caché). */
  ttlMs: number;
  /** Fuente apagada por configuración (SITE_CHECK_RDAP o SITE_CHECK_CONNECTION en false): no es una falla pasajera. */
  disabled?: true;
  findings: Finding[];
}

/** Error de una fuente sin detalles que puedan arrastrar URLs o respuestas. */
export const errorKind = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout';
    if (error.name === 'BudgetExceededError') return 'rate_limited';
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

export function unavailable(): SourceResult {
  return { coverage: 'unavailable', ttlMs: 0, findings: [] };
}

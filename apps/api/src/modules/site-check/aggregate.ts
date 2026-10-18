import { SiteCheckLimits, type CoverageLevel, type ReasonCode, type SiteCheckReason, type SiteRisk } from '@hackaton/contracts';
import type { Finding } from './types.js';

/** `fraud`: evidencia de estafa. `technical`: debilidad de configuración, nunca riesgo alto por sí sola. */
export const CATEGORY: Record<ReasonCode, 'fraud' | 'technical'> = {
  LOOKALIKE_DOMAIN: 'fraud',
  CONFUSABLE_CHARACTERS: 'fraud',
  MISLEADING_SUBDOMAIN: 'fraud',
  BRAND_IMPERSONATION: 'fraud',
  SENSITIVE_DATA_REQUEST: 'fraud',
  FORM_SENDS_TO_OTHER_DOMAIN: 'fraud',
  LINK_TEXT_MISMATCH: 'fraud',
  URGENCY_OR_THREAT: 'fraud',
  RECENTLY_REGISTERED: 'fraud',
  NO_HTTPS: 'technical',
  CERTIFICATE_PROBLEM: 'technical',
  CROSS_DOMAIN_REDIRECT: 'technical',
  INSECURE_FORM_ACTION: 'technical',
};

/** Alcanzan solas para riesgo alto: imitación del dominio de una organización. */
const STRONG: ReadonlySet<ReasonCode> = new Set(['LOOKALIKE_DOMAIN', 'CONFUSABLE_CHARACTERS', 'MISLEADING_SUBDOMAIN']);

/** Solas dan riesgo medio; dos distintas, riesgo alto. RECENTLY_REGISTERED es apoyo: nunca alto por sí sola. */
const MODERATE: ReadonlySet<ReasonCode> = new Set([
  'BRAND_IMPERSONATION',
  'SENSITIVE_DATA_REQUEST',
  'FORM_SENDS_TO_OTHER_DOMAIN',
  'LINK_TEXT_MISMATCH',
  'URGENCY_OR_THREAT',
  'RECENTLY_REGISTERED',
]);

const ORDER: ReasonCode[] = [...STRONG, ...MODERATE, 'INSECURE_FORM_ACTION', 'CERTIFICATE_PROBLEM', 'NO_HTTPS', 'CROSS_DOMAIN_REDIRECT'];

export const isEnough = (level: CoverageLevel) => level === 'complete' || level === 'not_applicable';

/** Agrupa hallazgos por código (hasta 5 evidencias), los más graves primero. */
export function buildReasons(findings: Finding[]): SiteCheckReason[] {
  const byCode = new Map<ReasonCode, Finding[]>();
  for (const finding of findings) byCode.set(finding.code, [...(byCode.get(finding.code) ?? []), finding]);
  return ORDER.filter((code) => byCode.has(code))
    .slice(0, SiteCheckLimits.maxReasons)
    .map((code) => ({
      code,
      category: CATEGORY[code],
      evidence: byCode
        .get(code)!
        .slice(0, 5)
        .map((f) => ({ source: f.source.slice(0, 80), checkedAt: f.checkedAt, observedBy: f.observedBy, detail: f.detail.slice(0, 300) })),
    }));
}

/**
 * Riesgo determinístico a partir de los motivos. Las debilidades técnicas no suben el riesgo,
 * salvo un formulario con datos sensibles que viaja sin cifrar (medio). Sin motivos, el riesgo
 * es `no_signals` solo si las verificaciones obligatorias se completaron; si no, `unknown`.
 */
export function computeRisk(codes: ReadonlySet<ReasonCode>, mandatoryComplete: boolean): SiteRisk {
  if ([...codes].some((code) => STRONG.has(code))) return 'high';
  const moderate = [...codes].filter((code) => MODERATE.has(code)).length;
  if (moderate >= 2) return 'high';
  if (moderate === 1 || codes.has('INSECURE_FORM_ACTION')) return 'medium';
  return mandatoryComplete ? 'no_signals' : 'unknown';
}

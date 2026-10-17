/**
 * TEMPORAL — respuestas simuladas de POST /v1/site-check para ver cada estado
 * del indicador sin el backend real. Decide por el hostname de las páginas de
 * demostración (`*.example`, que en desarrollo resuelven al servidor local de
 * fixtures) y, para el resto, devuelve una revisión incompleta: el simulador no
 * consulta fuentes reales y nunca aprueba un sitio que no conoce.
 *
 * | Hostname                      | Estado esperado          |
 * |-------------------------------|--------------------------|
 * | banco-demo.example            | Sitio oficial            |
 * | sin-alertas.example           | Sin alertas detectadas (Atención si aparece un campo de contraseña) |
 * | atencion.example              | Atención                 |
 * | bancodemo-acceso.example      | Posible estafa (imita a Banco de Demostración; ya en la fase dirección) |
 * | premio-gratis.example         | Posible estafa (malware, sin suplantación) |
 * | falla.example                 | No pudimos verificarlo (error del servicio) |
 * | parcial.example               | No pudimos verificarlo (cobertura parcial) |
 * | lenta.example                 | Revisando sitio… durante 6 s y luego Sin alertas |
 * | sin-respuesta.example         | No pudimos verificarlo (vence el tiempo máximo) |
 */
import { randomUUID } from 'node:crypto';
import {
  SiteCheckRequest,
  type CoverageLevel,
  type ReasonCode,
  type SiteCheckCoverage,
  type SiteCheckReason,
  type SiteCheckResponse,
} from '@hackaton/contracts';
import { ApiFailure } from './client';

export const MOCK_ORGANIZATION = 'Banco de Demostración';

const FRAUD: ReadonlySet<ReasonCode> = new Set([
  'KNOWN_PHISHING',
  'KNOWN_MALWARE',
  'LOOKALIKE_DOMAIN',
  'CONFUSABLE_CHARACTERS',
  'MISLEADING_SUBDOMAIN',
  'BRAND_IMPERSONATION',
  'SENSITIVE_DATA_REQUEST',
  'FORM_SENDS_TO_OTHER_DOMAIN',
  'LINK_TEXT_MISMATCH',
  'URGENCY_OR_THREAT',
  'RECENTLY_REGISTERED',
]);

/** Demora extra por hostname (ms). */
export function mockSiteCheckDelay(hostname: string): number {
  if (hostname === 'lenta.example') return 6000;
  if (hostname === 'sin-respuesta.example') return 60_000;
  return 0;
}

export function mockSiteCheck(raw: SiteCheckRequest): SiteCheckResponse {
  // Igual que el backend: lo que no cumple el contrato se rechaza.
  const parsed = SiteCheckRequest.safeParse(raw);
  if (!parsed.success) throw new ApiFailure('BAD_REQUEST', false);
  const request = parsed.data;
  const addressPhase = request.contentVersion === 0;
  const host = request.hostname;
  const now = new Date();
  const reason = (code: ReasonCode, detail: string): SiteCheckReason => ({
    code,
    category: FRAUD.has(code) ? 'fraud' : 'technical',
    evidence: [{ source: 'simulador', checkedAt: now.toISOString(), observedBy: addressPhase ? 'service' : 'user_browser', detail }],
  });
  const coverage = (over: Partial<SiteCheckCoverage> = {}): SiteCheckCoverage => ({
    reputation: 'complete',
    identity: 'complete',
    content: addressPhase ? 'pending' : 'complete',
    registration: 'unavailable',
    connection: 'unavailable',
    ...over,
  });
  const respond = (over: Partial<SiteCheckResponse>): SiteCheckResponse => ({
    navigationId: request.navigationId,
    contentVersion: request.contentVersion,
    analysisId: `mock-${randomUUID().slice(0, 8)}`,
    // En la fase dirección el contenido todavía no se revisó.
    status: addressPhase ? 'pending' : 'complete',
    identity: { status: 'unknown' },
    risk: addressPhase ? 'unknown' : 'no_signals',
    reasons: [],
    coverage: coverage(),
    checkedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    ...over,
  });
  const hasPassword = request.page?.forms.some((f) => f.fields.some((field) => field.type === 'password')) ?? false;

  switch (host) {
    case 'banco-demo.example':
      return respond({ identity: { status: 'verified_official', organization: MOCK_ORGANIZATION } });
    case 'sin-alertas.example':
    case 'lenta.example':
      if (hasPassword) {
        return respond({
          risk: 'medium',
          reasons: [reason('SENSITIVE_DATA_REQUEST', 'campo de contraseña en un sitio sin identidad verificada')],
          explanation: 'La página empezó a pedir una contraseña después de cargar.',
        });
      }
      return respond({});
    case 'atencion.example':
      if (addressPhase) return respond({});
      return respond({
        risk: 'medium',
        reasons: [reason('URGENCY_OR_THREAT', 'texto con urgencia'), reason('RECENTLY_REGISTERED', 'registrado hace 12 días')],
        explanation: 'El texto insiste en actuar hoy mismo para no perder un beneficio.',
      });
    case 'bancodemo-acceso.example': {
      const reasons = [reason('LOOKALIKE_DOMAIN', 'similar a bancodemo.example')];
      if (!addressPhase) {
        reasons.push(reason('BRAND_IMPERSONATION', 'marca declarada del catálogo en dominio ajeno'));
        if (hasPassword) reasons.push(reason('SENSITIVE_DATA_REQUEST', 'pide clave y token'));
      }
      return respond({
        status: addressPhase ? 'pending' : 'complete',
        risk: 'high',
        identity: { status: 'unknown', impersonatedOrganization: MOCK_ORGANIZATION },
        reasons,
        explanation: 'La dirección imita a la del banco y la página pide la clave y el código de seguridad.',
      });
    }
    case 'premio-gratis.example':
      return respond({ risk: 'high', reasons: [reason('KNOWN_MALWARE', 'listado en fuente de malware simulada')] });
    case 'falla.example':
      throw new ApiFailure('AI_UNAVAILABLE', true);
    case 'parcial.example':
      return respond({ status: 'partial', risk: 'no_signals', coverage: coverage({ reputation: 'unavailable' as CoverageLevel }) });
    default:
      // El simulador no consulta fuentes reales: nunca aprueba un sitio desconocido.
      return respond({
        status: addressPhase ? 'pending' : 'partial',
        risk: addressPhase ? 'unknown' : 'no_signals',
        coverage: coverage({ reputation: 'unavailable', identity: 'unavailable' }),
        explanation: 'Backend simulado: no consulta fuentes reales.',
      });
  }
}

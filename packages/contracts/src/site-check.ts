import { z } from 'zod';
import { ShortText, WebUrl } from './common.js';

/**
 * Protección de sitios (POST /v1/site-check). Ver `proteccion-sitios-agentes.md`.
 *
 * Un mismo endpoint cubre las dos fases de una navegación:
 * - `contentVersion: 0` y sin `page`: revisión de la dirección al empezar a navegar.
 * - `contentVersion >= 1` con `page`: resumen sanitizado después de la carga o de un cambio relevante.
 *
 * Todo lo que llega acá ya fue depurado en el navegador (sin cookies, valores de formularios,
 * tokens ni historial). El backend vuelve a validar y redactar.
 */

export const SiteCheckLimits = {
  maxTextLength: 4000,
  maxForms: 10,
  maxFieldsPerForm: 30,
  maxLinks: 50,
  maxOrigins: 30,
  maxReasons: 20,
} as const;

/** Lo genera el navegador por cada navegación principal. */
export const NavigationId = z.string().min(1).max(64);

/** 0 = solo dirección; cada resumen de contenido nuevo de la misma navegación lo incrementa. */
export const ContentVersion = z.number().int().min(0).max(10_000);

/** Hostname en minúsculas, sin puerto (punycode si corresponde). */
export const Hostname = z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/);

export const FormFieldType = z.enum([
  'text',
  'email',
  'password',
  'tel',
  'number',
  'date',
  'search',
  'url',
  'hidden',
  'file',
  'select',
  'textarea',
  'checkbox',
  'radio',
  'other',
]);

/** Campo de formulario sin valor. `label` y `autocomplete` ayudan a detectar pedidos sensibles. */
export const PageFormField = z.strictObject({
  type: FormFieldType,
  label: ShortText(120).optional(),
  autocomplete: z.string().max(60).optional(),
});
export type PageFormField = z.infer<typeof PageFormField>;

export const PageForm = z.strictObject({
  method: z.enum(['get', 'post', 'dialog', 'other']),
  /** Destino depurado; null si es la misma página o no se pudo resolver. */
  action: WebUrl.nullable(),
  fields: z.array(PageFormField).max(SiteCheckLimits.maxFieldsPerForm),
});
export type PageForm = z.infer<typeof PageForm>;

export const PageLink = z.strictObject({
  text: ShortText(200),
  /** Destino real depurado (sin secretos en path, query ni fragmento). */
  href: WebUrl,
});
export type PageLink = z.infer<typeof PageLink>;

/** Resumen de contenido observado por el navegador de la persona. */
export const PageSummary = z.strictObject({
  title: ShortText(200).optional(),
  language: z.string().min(2).max(10).optional(),
  /** Texto visible acotado y redactado. */
  text: z.string().max(SiteCheckLimits.maxTextLength),
  /** Lo que el sitio dice ser (og:site_name, logo alt, etc.). Declaración, no prueba. */
  declaredBrand: ShortText(120).optional(),
  forms: z.array(PageForm).max(SiteCheckLimits.maxForms),
  links: z.array(PageLink).max(SiteCheckLimits.maxLinks),
  /** Hostnames de origen de scripts e iframes, sin código. */
  scriptHosts: z.array(Hostname).max(SiteCheckLimits.maxOrigins),
  iframeHosts: z.array(Hostname).max(SiteCheckLimits.maxOrigins),
});
export type PageSummary = z.infer<typeof PageSummary>;

export const SiteCheckRequest = z
  .strictObject({
    navigationId: NavigationId,
    contentVersion: ContentVersion,
    /** URL depurada. Solo http(s); nunca direcciones locales ni privadas. */
    url: WebUrl,
    hostname: Hostname,
    /** Dominio registrable (eTLD+1) calculado en el navegador; el backend lo recalcula. */
    registrableDomain: Hostname,
    page: PageSummary.optional(),
  })
  .refine((r) => (r.contentVersion === 0) === (r.page === undefined), {
    message: 'page es obligatorio si contentVersion > 0 y no se envía con contentVersion 0',
    path: ['page'],
  });
export type SiteCheckRequest = z.infer<typeof SiteCheckRequest>;

export const SiteCheckStatus = z.enum(['pending', 'complete', 'partial', 'unavailable']);
export type SiteCheckStatus = z.infer<typeof SiteCheckStatus>;

export const SiteRisk = z.enum(['high', 'medium', 'no_signals', 'unknown']);
export type SiteRisk = z.infer<typeof SiteRisk>;

/** `pending`: la verificación todavía no corrió (ej. contenido en la fase de dirección). */
export const CoverageLevel = z.enum(['complete', 'partial', 'unavailable', 'not_applicable', 'pending']);
export type CoverageLevel = z.infer<typeof CoverageLevel>;

export const SiteCheckCoverage = z.strictObject({
  reputation: CoverageLevel,
  identity: CoverageLevel,
  content: CoverageLevel,
  registration: CoverageLevel,
  connection: CoverageLevel,
});
export type SiteCheckCoverage = z.infer<typeof SiteCheckCoverage>;

/**
 * Códigos estables. `fraud`: evidencia de estafa. `technical`: debilidad de configuración,
 * que por sí sola nunca produce riesgo alto.
 */
export const ReasonCode = z.enum([
  // fraud
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
  // technical
  'NO_HTTPS',
  'CERTIFICATE_PROBLEM',
  'CROSS_DOMAIN_REDIRECT',
  'INSECURE_FORM_ACTION',
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const ReasonCategory = z.enum(['fraud', 'technical']);

export const Evidence = z.strictObject({
  /** Fuente: catálogo, proveedor de reputación, RDAP, reglas de contenido, etc. */
  source: ShortText(80),
  checkedAt: z.iso.datetime(),
  /** Quién observó el dato: el navegador de la persona, un escáner externo o el servicio. */
  observedBy: z.enum(['user_browser', 'external_scanner', 'service']),
  /** Detalle técnico breve. El front no lo muestra tal cual a la persona. */
  detail: ShortText(300),
});
export type Evidence = z.infer<typeof Evidence>;

export const SiteCheckReason = z.strictObject({
  code: ReasonCode,
  category: ReasonCategory,
  evidence: z.array(Evidence).min(1).max(5),
});
export type SiteCheckReason = z.infer<typeof SiteCheckReason>;

export const SiteIdentity = z.strictObject({
  /**
   * `verified_official` solo sale de una fuente de autoridad (ver `basis`); nunca de la IA,
   * HTTPS, rankings, certificados ni apariencia.
   */
  status: z.enum(['verified_official', 'unknown']),
  /**
   * Fuente de la oficialidad. Obligatoria con `verified_official`.
   * - `government_domain`: zona reservada al Estado (gob.ar, mil.ar, gov.ar, .gov, .mil).
   * - `financial_regulator`: padrón de entidades financieras del BCRA, descargado del regulador.
   * - `official_catalog`: catálogo curado y versionado (p. ej. sitios de Uruguay), con fuente y fecha
   *   de revisión verificables por entrada.
   */
  basis: z.enum(['government_domain', 'financial_regulator', 'official_catalog']).optional(),
  /** Organización según la fuente (p. ej. «Estado argentino» o el nombre del padrón). Solo con `verified_official`. */
  organization: ShortText(120).optional(),
  /** Organización que el sitio parece imitar (con BRAND_IMPERSONATION o LOOKALIKE_DOMAIN). */
  impersonatedOrganization: ShortText(120).optional(),
}).refine((i) => (i.status === 'verified_official') === (i.basis !== undefined), {
  message: 'basis es obligatorio con verified_official y no se envía en otro caso',
  path: ['basis'],
});
export type SiteIdentity = z.infer<typeof SiteIdentity>;

export const SiteCheckResponse = z.strictObject({
  navigationId: NavigationId,
  contentVersion: ContentVersion,
  analysisId: z.string().min(1).max(64),
  status: SiteCheckStatus,
  identity: SiteIdentity,
  risk: SiteRisk,
  reasons: z.array(SiteCheckReason).max(SiteCheckLimits.maxReasons),
  coverage: SiteCheckCoverage,
  /** Explicación complementaria de la IA. Nunca controla etiquetas ni acciones. */
  explanation: ShortText(400).optional(),
  checkedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type SiteCheckResponse = z.infer<typeof SiteCheckResponse>;

/** Estado del indicador «Estás en…». Lo calculan front y backend (tests) con la misma regla. */
export type SiteIndicatorState =
  | 'checking' // Revisando sitio…
  | 'official' // Sitio oficial
  | 'no_alerts' // Sin alertas detectadas
  | 'attention' // Atención
  | 'possible_scam' // Posible estafa
  | 'unverified'; // No pudimos verificarlo

const enough = (level: CoverageLevel) => level === 'complete' || level === 'not_applicable';

/**
 * Cobertura mínima acordada. Prioridad: riesgo alto, riesgo medio, pendiente, insuficiente, favorables.
 * - Un estado favorable exige `status: complete` y reputación, contenido e identidad completos
 *   (o no aplicables). Registro y conexión no son obligatorios: su ausencia nunca aprueba ni reprueba.
 * - «Sitio oficial» exige además identidad verificada por catálogo y ningún motivo de fraude.
 */
export function siteIndicatorState(r: SiteCheckResponse): SiteIndicatorState {
  if (r.risk === 'high') return 'possible_scam';
  if (r.risk === 'medium') return 'attention';
  if (r.status === 'pending') return 'checking';
  if (r.status !== 'complete' || r.risk !== 'no_signals') return 'unverified';
  const c = r.coverage;
  if (!enough(c.reputation) || !enough(c.content) || !enough(c.identity)) return 'unverified';
  const hasFraud = r.reasons.some((reason) => reason.category === 'fraud');
  if (r.identity.status === 'verified_official' && c.identity === 'complete' && !hasFraud) return 'official';
  return 'no_alerts';
}

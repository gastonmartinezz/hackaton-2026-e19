import type { PageForm, PageFormField, PageSummary } from '@hackaton/contracts';
import type { AuthorityView, ClaimHint } from './authority.js';
import { normalizeName } from './official-sources.js';
import { describeHost, type HostInfo } from './domain.js';
import type { Finding } from './types.js';

/** Datos sensibles que un formulario puede pedir. */
export type SensitiveKind = 'password' | 'card' | 'bank' | 'tax_key' | 'otp';

const LABEL_RULES: ReadonlyArray<readonly [SensitiveKind, RegExp]> = [
  ['card', /\b(tarjeta|card ?number|n[uú]mero de (la )?tarjeta|cvv|cvc|c[oó]digo de seguridad|vencimiento|expiraci[oó]n)\b/],
  ['bank', /\b(numero de cuenta bancaria|clave (bancaria|de cajero|de home ?banking|de e ?banking)|home ?banking|e ?banking|pin de cajero)\b/],
  ['tax_key', /\b(clave fiscal|clave (de la )?seguridad social|(clave|contrasena) (de |del )?(dgi|bps))\b/],
  ['otp', /\b(c[oó]digo (de )?(verificaci[oó]n|validaci[oó]n|sms|que (te )?lleg[oó])|token|clave (din[aá]mica|token)|segundo factor|pin)\b/],
  ['password', /\b(contrase[nñ]a|password|clave)\b/],
];

const AUTOCOMPLETE_RULES: ReadonlyArray<readonly [SensitiveKind, RegExp]> = [
  ['card', /\bcc-(number|csc|exp)/],
  ['otp', /\bone-time-code\b/],
  ['password', /\b(current|new)-password\b/],
];

function classifyField(field: PageFormField): SensitiveKind | null {
  const autocomplete = field.autocomplete ?? '';
  for (const [kind, pattern] of AUTOCOMPLETE_RULES) if (pattern.test(autocomplete)) return kind;
  const label = normalizeName(field.label ?? '');
  for (const [kind, pattern] of LABEL_RULES) if (pattern.test(label)) return kind;
  return field.type === 'password' ? 'password' : null;
}

const formKinds = (form: PageForm) => new Set(form.fields.map(classifyField).filter((k): k is SensitiveKind => k !== null));

// Frases de urgencia y de amenaza. Solo cuentan combinadas (ver `urgencyKind`).
const URGENCY = [
  /\burgente\b/,
  /\b(inmediatamente|de inmediato|ahora mismo)\b/,
  /\b(dentro de|en las proximas|en menos de) \d+ ?(horas|hs|minutos)\b/,
  /\bultimo aviso\b/,
  /\b(vence|caduca|expira) (hoy|manana)\b/,
  /\b(ganaste|ganador|premio|sorteo)\b/,
];
const THREAT = [
  /\b(sera|fue|ha sido|esta) (bloquead|suspendid|inhabilitad|cancelad|dad[oa] de baja)/,
  /\b(bloqueo|suspension|baja) de (tu|su) (cuenta|tarjeta|beneficio|jubilacion|pension)\b/,
  /\b(embargo|denuncia penal|multa|accion legal)\b/,
  /\b(verifica|valida|actualiza|confirma) (tus|sus) datos\b/,
  /\b(reintegro|reembolso|devolucion) pendiente\b/,
];

export interface PageAnalysis {
  /** Datos sensibles pedidos en formularios de la página. */
  sensitiveKinds: SensitiveKind[];
  findings: Finding[];
  /** Formularios con datos sensibles cuyo destino es otro dominio, y destinos http. */
  forms: Array<{ method: PageForm['method']; actionDomain: string | null; sensitive: SensitiveKind[]; insecure: boolean }>;
}

const SOURCE = 'Reglas de contenido';

/**
 * Reglas sobre el resumen sanitizado que observó el navegador de la persona.
 * `official` indica si una fuente de autoridad hace oficial al host.
 */
export function analyzePage(page: PageSummary, pageUrl: URL, host: HostInfo, authority: AuthorityView, official: boolean, checkedAt: string): PageAnalysis {
  const findings: Finding[] = [];
  const add = (code: Finding['code'], detail: string, impersonatedOrganization?: string) => {
    if (findings.filter((f) => f.code === code).length < 5) {
      findings.push({ code, source: SOURCE, checkedAt, observedBy: 'user_browser', detail, ...(impersonatedOrganization ? { impersonatedOrganization } : {}) });
    }
  };
  // Mismo sitio: mismo dominio registrable o la misma organización según las fuentes de autoridad.
  const sameSite = (hostname: string) => authority.sameOrganization(host.hostname, hostname);
  // Organización dueña de la página, solo si una autoridad la respalda (sitio oficial). Sin la clave `gov:<país>`,
  // que comparten todos los organismos del Estado: el MSP que nombra al BPS en un enlace a otro dominio sigue siendo
  // sospechoso.
  const ownKeys = official ? authority.keys(host.hostname).filter((key) => !key.startsWith('gov:')) : [];

  const sensitive = new Set<SensitiveKind>();
  const forms: PageAnalysis['forms'] = [];
  for (const form of page.forms) {
    const kinds = formKinds(form);
    kinds.forEach((k) => sensitive.add(k));
    const action = form.action ? new URL(form.action) : null;
    const insecure = (action ?? pageUrl).protocol === 'http:';
    const actionDomain = action ? (describeHost(action.hostname).registrableDomain ?? action.hostname) : null;
    forms.push({ method: form.method, actionDomain, sensitive: [...kinds], insecure });
    if (kinds.size === 0) continue;
    if (action && !sameSite(action.hostname)) add('FORM_SENDS_TO_OTHER_DOMAIN', `Un formulario que pide ${[...kinds].join(', ')} envía los datos a ${actionDomain}`);
    if (insecure) add('INSECURE_FORM_ACTION', 'Un formulario con datos sensibles envía sin cifrar (http)');
  }

  // Tarjeta, datos bancarios, clave fiscal o códigos en un sitio fuera del catálogo.
  // La contraseña sola no cuenta (cualquier sitio con usuarios la pide): se evalúa combinada en el servicio.
  const strongKinds = [...sensitive].filter((k) => k !== 'password');
  if (!official && strongKinds.length > 0) add('SENSITIVE_DATA_REQUEST', `Pide ${strongKinds.join(', ')} en un sitio que no está en el registro de sitios oficiales`);

  // Texto del enlace que muestra un dominio o nombra a una organización distinta del destino real.
  for (const link of page.links) {
    const href = new URL(link.href);
    const target = describeHost(href.hostname);
    const shownDomain = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i.exec(link.text)?.[1]?.toLowerCase();
    if (shownDomain) {
      const shown = describeHost(shownDomain);
      if (!shown.internal && shown.registrableDomain && target.registrableDomain && shown.registrableDomain !== target.registrableDomain) {
        add('LINK_TEXT_MISMATCH', `Un enlace muestra ${shown.registrableDomain} pero lleva a ${target.registrableDomain}`);
        continue;
      }
    }
    const targetKeys = authority.keys(target.hostname);
    for (const claim of authority.claims(link.text)) {
      // Un sitio oficial que nombra a su propia organización en un enlace a otro dominio (descargar la app,
      // WhatsApp, su AFAP, otro dominio propio) no se imita a sí mismo.
      if (claim.keys.some((key) => ownKeys.includes(key))) continue;
      if (!claim.keys.some((key) => targetKeys.includes(key)) && !sameSite(target.hostname)) {
        add('LINK_TEXT_MISMATCH', `Un enlace nombra a ${claim.organization} pero lleva a ${target.registrableDomain ?? target.hostname}`, claim.organization);
        break;
      }
    }
  }

  const urgency = urgencyKind(page, sensitive.size > 0);
  if (urgency) add('URGENCY_OR_THREAT', `El texto combina ${urgency}`);

  return { sensitiveKinds: [...sensitive], findings, forms };
}

/**
 * Urgencia o amenaza: una frase de amenaza combinada con un pedido de datos sensibles o con
 * urgencia, o dos frases de urgencia con un pedido de datos. Una frase suelta no alcanza
 * («vence hoy» en un trámite real). Devuelve la descripción de la combinación o null.
 */
function urgencyKind(page: PageSummary, asksSensitive: boolean): string | null {
  const text = normalizeName(`${page.title ?? ''} ${page.text}`);
  const threats = THREAT.filter((p) => p.test(text)).length;
  const urgency = URGENCY.filter((p) => p.test(text)).length;
  if (threats > 0 && asksSensitive) return 'amenazas con un pedido de datos';
  if (threats > 0 && urgency > 0) return 'amenazas con urgencia';
  if (urgency >= 2 && asksSensitive) return 'urgencia con un pedido de datos';
  return null;
}

/**
 * Contrasta la organización que el sitio dice ser con las fuentes de autoridad (zonas de gobierno,
 * registro del BCU, catálogos curados). Una marca declarada nunca prueba identidad: solo puede
 * producir BRAND_IMPERSONATION cuando nombra a una organización conocida y el host no le pertenece.
 * El llamador garantiza que el host NO es oficial: en un sitio oficial no se evalúa (un portal oficial
 * nombra a otros organismos).
 */
export function compareBrand(
  declaredBrand: string,
  host: HostInfo,
  authority: AuthorityView,
  checkedAt: string,
  options: { hint?: ClaimHint; source?: string; observedBy?: Finding['observedBy'] } = {},
): Finding[] {
  const hostKeys = authority.keys(host.hostname);
  const impersonated = authority.claims(declaredBrand, options.hint).find((claim) => !claim.keys.some((key) => hostKeys.includes(key)));
  if (!impersonated) return [];
  const what = impersonated.via === 'government_domain' ? `un organismo del Estado (${impersonated.organization})` : impersonated.organization;
  const according = impersonated.via === 'government_domain' ? 'las zonas de gobierno' : impersonated.via === 'financial_regulator' ? 'el registro del BCU' : 'el catálogo curado';
  return [
    {
      code: 'BRAND_IMPERSONATION',
      source: options.source ?? SOURCE,
      checkedAt,
      observedBy: options.observedBy ?? 'user_browser',
      detail: `El sitio se presenta como ${what}, pero ${host.registrableDomain ?? host.hostname} no le pertenece según ${according}`,
      impersonatedOrganization: impersonated.organization.slice(0, 120),
    },
  ];
}

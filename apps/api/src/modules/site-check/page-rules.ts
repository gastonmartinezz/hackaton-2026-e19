import type { PageForm, PageFormField, PageSummary } from '@hackaton/contracts';
import { normalizeName, type CatalogEntry, type OfficialCatalog } from './catalog.js';
import { describeHost, type HostInfo } from './domain.js';
import type { Finding } from './types.js';

/** Datos sensibles que un formulario puede pedir. */
export type SensitiveKind = 'password' | 'card' | 'bank' | 'tax_key' | 'otp';

const LABEL_RULES: ReadonlyArray<readonly [SensitiveKind, RegExp]> = [
  ['card', /\b(tarjeta|card ?number|n[uú]mero de (la )?tarjeta|cvv|cvc|c[oó]digo de seguridad|vencimiento|expiraci[oó]n)\b/],
  ['bank', /\b(cbu|cvu|alias (bancario|cbu|cvu)|clave (bancaria|de cajero|de home ?banking)|home ?banking|pin de cajero)\b/],
  ['tax_key', /\b(clave fiscal|clave de la seguridad social|clave de seguridad social)\b/],
  ['otp', /\b(c[oó]digo (de )?(verificaci[oó]n|validaci[oó]n|sms|que (te )?lleg[oó])|token|clave (din[aá]mica|token)|segundo factor|pin)\b/],
  ['password', /\b(contrase[nñ]a|password|clave)\b/],
];

const AUTOCOMPLETE_RULES: ReadonlyArray<readonly [SensitiveKind, RegExp]> = [
  ['card', /\bcc-(number|csc|exp)/],
  ['otp', /\bone-time-code\b/],
  ['password', /\b(current|new)-password\b/],
];

export function classifyField(field: PageFormField): SensitiveKind | null {
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
  /** Dominios de scripts e iframes que no son del sitio (solo informativo). */
  thirdPartyHosts: string[];
}

const SOURCE = 'Reglas de contenido';

/**
 * Reglas sobre el resumen sanitizado que observó el navegador de la persona.
 * `official` es la entrada del catálogo que autoriza al host, si la hay.
 */
export function analyzePage(page: PageSummary, pageUrl: URL, host: HostInfo, catalog: OfficialCatalog, official: CatalogEntry | undefined, checkedAt: string): PageAnalysis {
  const findings: Finding[] = [];
  const add = (code: Finding['code'], detail: string, impersonatedOrganization?: string) => {
    if (findings.filter((f) => f.code === code).length < 5) {
      findings.push({ code, source: SOURCE, checkedAt, observedBy: 'user_browser', detail, ...(impersonatedOrganization ? { impersonatedOrganization } : {}) });
    }
  };
  // Mismo sitio: mismo dominio registrable o dominios de la misma organización del catálogo.
  const sameSite = (hostname: string) => {
    const other = describeHost(hostname);
    if (other.registrableDomain && other.registrableDomain === host.registrableDomain) return true;
    return official !== undefined && catalog.authorizes(official, other.hostname);
  };

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
    for (const entry of catalog.findByName(link.text)) {
      if (!catalog.authorizes(entry, target.hostname) && !sameSite(target.hostname)) {
        add('LINK_TEXT_MISMATCH', `Un enlace nombra a ${entry.organization} pero lleva a ${target.registrableDomain ?? target.hostname}`, entry.organization);
        break;
      }
    }
  }

  const urgency = urgencyKind(page, sensitive.size > 0);
  if (urgency) add('URGENCY_OR_THREAT', `El texto combina ${urgency}`);

  const thirdPartyHosts = [...new Set([...page.scriptHosts, ...page.iframeHosts])].filter((h) => !sameSite(h)).slice(0, 30);
  return { sensitiveKinds: [...sensitive], findings, forms, thirdPartyHosts };
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

export interface BrandComparison {
  declaredBrand: string;
  /** Organizaciones del catálogo que coinciden con la marca declarada. */
  matches: Array<{ organization: string; authorized: boolean; domains: string[] }>;
  findings: Finding[];
}

/**
 * Contrasta la marca que el sitio dice ser con el catálogo. Una marca declarada nunca prueba
 * identidad: solo puede producir una alerta cuando nombra a una organización del catálogo y el
 * host no está autorizado. En un dominio oficial no se evalúa (un portal oficial nombra a otros organismos).
 */
export function compareBrand(declaredBrand: string, host: HostInfo, catalog: OfficialCatalog, checkedAt: string): BrandComparison {
  const official = catalog.match(host.hostname);
  const matches = catalog.findByName(declaredBrand).map((entry) => ({
    organization: entry.organization,
    authorized: catalog.authorizes(entry, host.hostname),
    domains: entry.domains.map((d) => d.domain),
  }));
  const findings: Finding[] = [];
  const impersonated = matches.find((m) => !m.authorized);
  if (!official && impersonated) {
    findings.push({
      code: 'BRAND_IMPERSONATION',
      source: SOURCE,
      checkedAt,
      observedBy: 'user_browser',
      detail: `El sitio se presenta como ${impersonated.organization}, cuyo dominio es ${impersonated.domains[0]}`,
      impersonatedOrganization: impersonated.organization,
    });
  }
  return { declaredBrand, matches, findings };
}

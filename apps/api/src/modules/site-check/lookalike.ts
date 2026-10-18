import { parse } from 'tldts';
import { editDistance, hasMixedScripts, skeleton, type HostInfo } from './domain.js';

/**
 * Dominios parecidos sin lista manual. Las referencias salen de las fuentes de autoridad
 * (registro del BCU, catálogo de Uruguay, zonas de gobierno). Heurísticas al estilo de las
 * advertencias de lookalikes de Chrome, en dos grupos:
 * - Sobre el dominio completo o su aspecto, que valen para toda referencia: dominio de referencia
 *   embebido (brou.com.uy.verificacion.net, brou-com-uy.net) y mismo esqueleto visual (UTS #39: br0u,
 *   letras cirílicas).
 * - Sobre el nombre solo: una letra de diferencia, marca + palabra clave y la marca como subdominio.
 *   No se aplican a las referencias cuyo nombre es una palabra de uso corriente (`commonWord`, de
 *   data/common-words.json): «correo», «delta» o «verde» aparecen en sitios sin relación
 *   (correo.miempresa.com.uy, consorcios.com.uy, visa-uruguay.com) y darían «Posible estafa».
 */

export type ReferenceKind = 'financial_regulator' | 'official_catalog';

export interface Reference {
  /** Dominio registrable (eTLD+1) de referencia. */
  domain: string;
  /** Etiqueta sin sufijo ("brou" en brou.com.uy). */
  label: string;
  organization: string;
  kind: ReferenceKind;
  /** La etiqueta, sin guiones, es una palabra de uso corriente: solo cuentan el dominio completo y el aspecto. */
  commonWord?: boolean;
}

export interface ZoneReference {
  suffix: string;
  organization: string;
}

export type DomainSignalCode = 'LOOKALIKE_DOMAIN' | 'CONFUSABLE_CHARACTERS' | 'MISLEADING_SUBDOMAIN';

export interface DomainSignal {
  code: DomainSignalCode;
  organization?: string;
  detail: string;
}

/** Palabras que los dominios de phishing suman a una marca ("brou-login", "antel-uy", "seguro-itau"). */
const KEYWORDS = new Set([
  'login', 'signin', 'seguro', 'segura', 'seguridad', 'secure', 'security', 'verificacion', 'verificar', 'verify', 'validacion',
  'validar', 'homebanking', 'hb', 'online', 'banca', 'cuenta', 'cuentas', 'cliente', 'clientes', 'acceso', 'ingreso', 'ingresar',
  'token', 'clave', 'soporte', 'ayuda', 'oficial', 'app', 'web', 'pago', 'pagos', 'beneficio', 'beneficios', 'turno', 'turnos',
  'premio', 'premios', 'reintegro', 'promo', 'update', 'actualizar', 'actualizacion', 'portal', 'digital', 'uy', 'uruguay',
  'gob', 'gub', 'gov',
]);

const compact = (label: string) => label.replace(/-/g, '');
const tokens = (label: string) => label.split(/[-0-9]+/).filter(Boolean);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ORDER: ReferenceKind[] = ['financial_regulator', 'official_catalog'];

/**
 * Señales de imitación. El llamador garantiza que el host NO es oficial; si el dominio
 * registrable es una referencia (por ejemplo, uno que el catálogo descartó), no hay señal.
 */
export function lookalikeSignals(host: HostInfo, references: readonly Reference[], zones: readonly ZoneReference[]): DomainSignal[] {
  const domain = host.registrableDomain;
  const label = host.label;
  if (host.isIp || !domain || !label) return [];
  if (references.some((ref) => ref.domain === domain)) return [];

  const signals: DomainSignal[] = [];
  const add = (code: DomainSignalCode, organization: string | undefined, detail: string) => {
    if (!signals.some((s) => s.code === code)) signals.push({ code, organization, detail });
  };

  const nonAscii = /[^\x00-\x7f]/.test(host.unicode);
  const unicodeLabel = parse(host.unicode, { allowPrivateDomains: true }).domainWithoutSuffix ?? label;
  const dotted = `.${host.hostname}.`;
  const subLabels = host.subdomain ? host.subdomain.split('.') : [];
  const subTokens = subLabels.flatMap(tokens);
  const labelTokens = tokens(label);
  const hasKeyword = [...labelTokens, ...subTokens].some((t) => KEYWORDS.has(t));

  // Zonas de gobierno: "gub.uy" embebido en otro dominio, "x-gub-uy.com", ".gub.uy" falso con homoglifos.
  for (const zone of zones) {
    const parts = zone.suffix.split('.');
    if (parts.length < 2) continue; // una zona de una sola etiqueta sería demasiado genérica como palabra
    // El sufijo mismo (gub.uy) no se imita a sí mismo; su oficialidad la decide authority.
    if (host.hostname === zone.suffix || domain === zone.suffix) continue;
    if (dotted.includes(`.${zone.suffix}.`)) {
      add('MISLEADING_SUBDOMAIN', zone.organization, `"${zone.suffix}" aparece antes del dominio real ${domain}`);
      continue;
    }
    const pattern = new RegExp(`(^|[.-])${parts.map(escape).join('[.-]?')}([.-]|$)`);
    if (pattern.test(host.hostname)) add('LOOKALIKE_DOMAIN', zone.organization, `${domain} imita un dominio de gobierno (${zone.suffix})`);
    else if (nonAscii) {
      const visual = skeleton(host.unicode);
      if (visual.endsWith(`.${zone.suffix}`) || pattern.test(visual)) {
        add('CONFUSABLE_CHARACTERS', zone.organization, `Caracteres que imitan un dominio ${zone.suffix}`);
      }
    }
  }

  const ordered = [...references].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const flat = compact(label);
  const visualLabel = compact(skeleton(unicodeLabel));
  for (const ref of ordered) {
    const refLabel = ref.label;
    if (refLabel.length < 3 || KEYWORDS.has(refLabel)) continue;

    // Dominio de referencia completo antes del dominio real: brou.com.uy.verificacion.net.
    if (`.${host.subdomain}.`.includes(`.${ref.domain}.`)) {
      add('MISLEADING_SUBDOMAIN', ref.organization, `${ref.domain} aparece antes del dominio real ${domain}`);
    }
    // Dominio de referencia con guiones dentro de la etiqueta: brou-com-uy-login.com.
    if (label.includes(ref.domain.replaceAll('.', '-'))) add('LOOKALIKE_DOMAIN', ref.organization, `${domain} contiene ${ref.domain}`);

    // Mismo esqueleto visual: letras de otro alfabeto, 0 por o, rn por m.
    if (unicodeLabel !== refLabel && visualLabel === compact(skeleton(refLabel))) {
      add(nonAscii ? 'CONFUSABLE_CHARACTERS' : 'LOOKALIKE_DOMAIN', ref.organization, `${domain} se ve igual que ${ref.domain}`);
    }

    // Desde acá, reglas sobre el nombre solo. Con una palabra de uso corriente chocan con sitios sin relación
    // (correo.miempresa.com.uy, consorcios.com.uy, visa-uruguay.com, verde.com): esas referencias quedan solo
    // con las reglas de arriba (correo.com.uy.evil.com, correo-com-uy.net, c0rreo.com.uy).
    if (ref.commonWord) continue;
    // Sin guiones, como `flat`: banco-provincia se compara como bancoprovincia.
    const refFlat = compact(refLabel);
    // Una letra de diferencia, solo con nombres largos (los cortos chocan con sitios legítimos).
    if (refFlat.length >= 7 && editDistance(flat, refFlat) === 1) add('LOOKALIKE_DOMAIN', ref.organization, `${domain} difiere en una letra de ${ref.domain}`);
    // Marca + palabra clave: brou-seguro.com, antel-uy.com, itaulogin.com.
    const brandKeyword =
      (labelTokens.includes(refLabel) && labelTokens.some((t) => t !== refLabel && KEYWORDS.has(t))) ||
      [...KEYWORDS].some((kw) => kw.length >= 4 && (flat === refFlat + kw || flat === kw + refFlat));
    if (brandKeyword) add('LOOKALIKE_DOMAIN', ref.organization, `${domain} combina ${refLabel} con una palabra de acceso o seguridad`);
    // La marca como subdominio de otro dominio: brou.secure-login.com.
    if (subTokens.includes(refLabel) && (refLabel.length >= 5 || hasKeyword)) {
      add('MISLEADING_SUBDOMAIN', ref.organization, `Un subdominio usa ${refLabel} sobre ${domain}`);
    }
  }

  if (!signals.some((s) => s.code === 'CONFUSABLE_CHARACTERS') && host.unicode.split('.').some(hasMixedScripts)) {
    add('CONFUSABLE_CHARACTERS', undefined, 'Mezcla letras latinas con letras de otro alfabeto');
  }
  return signals;
}

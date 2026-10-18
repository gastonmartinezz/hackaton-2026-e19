import { parse } from 'tldts';
import { editDistance, hasMixedScripts, skeleton, type HostInfo } from './domain.js';

/**
 * Dominios parecidos sin lista manual. Las referencias salen de las fuentes de autoridad
 * (padrón del BCRA, catálogos curados, zonas de gobierno) y, opcionalmente, de una lista de
 * dominios populares. Heurísticas al estilo de las advertencias de lookalikes de Chrome:
 * mismo esqueleto visual (UTS #39), una edición de distancia, dominio de referencia embebido,
 * marca + palabra clave y cambio de terminación.
 */

export type ReferenceKind = 'financial_regulator' | 'official_catalog' | 'popular';

export interface Reference {
  /** Dominio registrable (eTLD+1) de referencia. */
  domain: string;
  /** Etiqueta sin sufijo ("bna" en bna.com.ar). */
  label: string;
  organization: string;
  kind: ReferenceKind;
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

/** Palabras que los dominios de phishing suman a una marca ("bna-login", "antel-uy", "seguro-macro"). */
const KEYWORDS = new Set([
  'login', 'signin', 'seguro', 'segura', 'seguridad', 'secure', 'security', 'verificacion', 'verificar', 'verify', 'validacion',
  'validar', 'homebanking', 'hb', 'online', 'banca', 'cuenta', 'cuentas', 'cliente', 'clientes', 'acceso', 'ingreso', 'ingresar',
  'token', 'clave', 'soporte', 'ayuda', 'oficial', 'app', 'web', 'pago', 'pagos', 'beneficio', 'beneficios', 'turno', 'turnos',
  'premio', 'premios', 'reintegro', 'promo', 'update', 'actualizar', 'actualizacion', 'portal', 'digital', 'ar', 'arg',
  'argentina', 'uy', 'uruguay', 'gob', 'gub', 'gov',
]);

const compact = (label: string) => label.replace(/-/g, '');
const tokens = (label: string) => label.split(/[-0-9]+/).filter(Boolean);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ORDER: ReferenceKind[] = ['financial_regulator', 'official_catalog', 'popular'];

/**
 * Señales de imitación. El llamador garantiza que el host NO es oficial; si el dominio
 * registrable es una referencia (por ejemplo, un dominio popular), no hay señal.
 */
export function lookalikeSignals(
  host: HostInfo,
  references: readonly Reference[],
  zones: readonly ZoneReference[],
  options: { tldSwap?: boolean } = {},
): DomainSignal[] {
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

  // Zonas de gobierno: "gob.ar" embebido en otro dominio, "x-gob-ar.com", ".gob.ar" falso con homoglifos.
  for (const zone of zones) {
    const parts = zone.suffix.split('.');
    if (parts.length < 2) continue; // .gov / .mil: demasiado genéricos como palabra
    // El sufijo mismo (gob.ar) no se imita a sí mismo; su oficialidad la decide authority.
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
    // Sin guiones, como `flat`: banco-provincia se compara como bancoprovincia.
    const refFlat = compact(refLabel);

    // Dominio de referencia completo antes del dominio real: bna.com.ar.verificacion.net.
    if (`.${host.subdomain}.`.includes(`.${ref.domain}.`)) {
      add('MISLEADING_SUBDOMAIN', ref.organization, `${ref.domain} aparece antes del dominio real ${domain}`);
    }
    // Dominio de referencia con guiones dentro de la etiqueta: bna-com-ar-login.com.
    if (label.includes(ref.domain.replaceAll('.', '-'))) add('LOOKALIKE_DOMAIN', ref.organization, `${domain} contiene ${ref.domain}`);

    // Mismo esqueleto visual: letras de otro alfabeto, 0 por o, rn por m.
    if (unicodeLabel !== refLabel && visualLabel === compact(skeleton(refLabel))) {
      add(nonAscii ? 'CONFUSABLE_CHARACTERS' : 'LOOKALIKE_DOMAIN', ref.organization, `${domain} se ve igual que ${ref.domain}`);
    }
    // Misma marca con otra terminación: bancociudad.com frente a bancociudad.com.ar. Solo con una lista de
    // dominios populares para excluir los sitios globales legítimos (santander.com, bbva.com).
    if (options.tldSwap && label === refLabel && refLabel.length >= 4) add('LOOKALIKE_DOMAIN', ref.organization, `Mismo nombre que ${ref.domain} con otra terminación`);
    // Una letra de diferencia, solo con nombres largos (los cortos chocan con sitios legítimos).
    if (refFlat.length >= 7 && editDistance(flat, refFlat) === 1) add('LOOKALIKE_DOMAIN', ref.organization, `${domain} difiere en una letra de ${ref.domain}`);
    // Marca + palabra clave: bna-seguro.com, antel-uy.com, macrologin.com.
    const brandKeyword =
      (labelTokens.includes(refLabel) && labelTokens.some((t) => t !== refLabel && KEYWORDS.has(t))) ||
      [...KEYWORDS].some((kw) => kw.length >= 4 && (flat === refFlat + kw || flat === kw + refFlat));
    if (brandKeyword) add('LOOKALIKE_DOMAIN', ref.organization, `${domain} combina ${refLabel} con una palabra de acceso o seguridad`);
    // La marca como subdominio de otro dominio: bna.secure-login.com.
    if (subTokens.includes(refLabel) && (refLabel.length >= 5 || hasKeyword)) {
      add('MISLEADING_SUBDOMAIN', ref.organization, `Un subdominio usa ${refLabel} sobre ${domain}`);
    }
  }

  if (!signals.some((s) => s.code === 'CONFUSABLE_CHARACTERS') && host.unicode.split('.').some(hasMixedScripts)) {
    add('CONFUSABLE_CHARACTERS', undefined, 'Mezcla letras latinas con letras de otro alfabeto');
  }
  return signals;
}

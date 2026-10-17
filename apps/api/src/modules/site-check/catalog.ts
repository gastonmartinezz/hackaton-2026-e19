import { Hostname } from '@hackaton/contracts';
import { parse } from 'tldts';
import { z } from 'zod';
import data from './data/official-sites.json' with { type: 'json' };
import { editDistance, hasMixedScripts, hostMatches, skeleton, type HostInfo } from './domain.js';

/**
 * Catálogo de dominios oficiales (`data/official-sites.json`). Es la ÚNICA fuente de
 * «Sitio oficial»: ni la IA, ni HTTPS, ni la apariencia del sitio pueden otorgarla.
 */
const CatalogEntry = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  organization: z.string().min(1).max(120),
  /** Nombres con los que el sitio puede declararse (para BRAND_IMPERSONATION y enlaces). */
  names: z.array(z.string().min(2)).min(1),
  domains: z.array(z.strictObject({ domain: Hostname, scope: z.enum(['exact', 'subdomains']) })).min(1),
  /**
   * Etiquetas distintivas a vigilar en dominios parecidos. Las de 5 o más letras también se buscan
   * dentro de otras palabras y con distancia de edición; las cortas solo como palabra separada por guiones.
   */
  watchLabels: z.array(z.string().regex(/^[a-z0-9]+$/)),
  source: z.strictObject({ name: z.string().min(1), url: z.url() }),
  reviewedAt: z.iso.date(),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

const CatalogFile = z.strictObject({ version: z.string().min(1), note: z.string().optional(), entries: z.array(CatalogEntry).min(1) });
export type CatalogFile = z.infer<typeof CatalogFile>;

export type DomainSignalCode = 'LOOKALIKE_DOMAIN' | 'CONFUSABLE_CHARACTERS' | 'MISLEADING_SUBDOMAIN';

export interface DomainSignal {
  code: DomainSignalCode;
  entry?: CatalogEntry;
  detail: string;
}

/** Texto comparable: sin tildes, minúsculas y espacios simples. */
export const normalizeName = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .trim();

const compact = (label: string) => label.replace(/-/g, '');

export class OfficialCatalog {
  readonly version: string;
  readonly entries: readonly CatalogEntry[];
  /** Fecha de revisión más antigua: la que limita la vigencia del catálogo completo. */
  readonly reviewedAt: string;

  constructor(file: unknown = data) {
    const parsed = CatalogFile.parse(file);
    this.version = parsed.version;
    this.entries = parsed.entries;
    this.reviewedAt = parsed.entries.map((e) => e.reviewedAt).sort()[0]!;
  }

  /** Entrada que autoriza este hostname, por límites de dominio. */
  match(hostname: string): CatalogEntry | undefined {
    return this.entries.find((entry) => this.authorizes(entry, hostname));
  }

  authorizes(entry: CatalogEntry, hostname: string): boolean {
    return entry.domains.some((d) => hostMatches(hostname, d.domain, d.scope));
  }

  /** Entradas cuyo nombre aparece como palabras completas en el texto. */
  findByName(text: string): CatalogEntry[] {
    const haystack = ` ${normalizeName(text)} `;
    return this.entries.filter((entry) => entry.names.some((name) => haystack.includes(` ${normalizeName(name)} `)));
  }

  /**
   * Señales de imitación del dominio frente al catálogo. Solo para hosts que el catálogo NO autoriza.
   * Pueden salir varias (por ejemplo, subdominio engañoso y caracteres confusos a la vez).
   */
  domainSignals(host: HostInfo): DomainSignal[] {
    if (host.isIp || !host.registrableDomain || !host.label || this.match(host.hostname)) return [];
    const signals: DomainSignal[] = [];
    const add = (code: DomainSignalCode, entry: CatalogEntry | undefined, detail: string) => {
      if (!signals.some((s) => s.code === code)) signals.push({ code, entry, detail });
    };

    const unicodeParsed = parse(host.unicode, { allowPrivateDomains: true });
    const unicodeLabel = unicodeParsed.domainWithoutSuffix ?? host.label;
    const nonAscii = /[^\x00-\x7f]/.test(unicodeLabel);
    const labelSkeleton = compact(skeleton(unicodeLabel));
    const subLabels = host.subdomain ? host.subdomain.split('.') : [];

    for (const entry of this.entries) {
      for (const { domain } of entry.domains) {
        const official = parse(domain, { allowPrivateDomains: true });
        const officialLabel = official.domainWithoutSuffix ?? domain;

        // Caracteres de otro alfabeto o con tilde que imitan al dominio oficial (раmi.org.ar, ánses.gob.ar).
        if (nonAscii && labelSkeleton === compact(skeleton(officialLabel))) {
          add('CONFUSABLE_CHARACTERS', entry, `Caracteres que imitan a ${domain}`);
        } else if (unicodeLabel !== officialLabel && labelSkeleton === skeleton(officialLabel)) {
          // Sustituciones tipográficas en ASCII (pam1, bancoprovlncia, rn por m).
          add('LOOKALIKE_DOMAIN', entry, `Dominio con letras sustituidas que imita a ${domain}`);
        } else if (host.label === officialLabel) {
          // Misma etiqueta con otro sufijo: anses.com.ar frente a anses.gob.ar.
          add('LOOKALIKE_DOMAIN', entry, `Mismo nombre que ${domain} con otra terminación`);
        }

        // El dominio oficial completo aparece dentro de los subdominios: argentina.gob.ar.evil.com.
        if (`.${host.subdomain}.`.includes(`.${domain}.`)) {
          add('MISLEADING_SUBDOMAIN', entry, `El nombre ${domain} aparece antes del dominio real ${host.registrableDomain}`);
        }
      }

      for (const watch of entry.watchLabels) {
        if (this.labelResembles(host.label, watch) || (nonAscii && this.labelResembles(labelSkeleton, watch))) {
          add('LOOKALIKE_DOMAIN', entry, `El dominio ${host.registrableDomain} se parece a ${entry.domains[0]!.domain}`);
        }
        if (subLabels.some((sub) => this.labelResembles(sub, watch, false))) {
          add('MISLEADING_SUBDOMAIN', entry, `Un subdominio usa el nombre de ${entry.organization} sobre ${host.registrableDomain}`);
        }
      }
    }

    if (!signals.some((s) => s.code === 'CONFUSABLE_CHARACTERS') && [unicodeLabel, ...subLabels].some(hasMixedScripts)) {
      add('CONFUSABLE_CHARACTERS', undefined, 'Mezcla letras latinas con letras de otro alfabeto');
    }
    return signals;
  }

  /** Coincidencia con una etiqueta vigilada. `fuzzy` habilita la distancia de edición. */
  private labelResembles(label: string, watch: string, fuzzy = true): boolean {
    const tokens = label.split(/[-0-9]+/).filter(Boolean);
    if (tokens.includes(watch) || compact(label) === watch) return true;
    if (watch.length < 5) return false;
    const flat = compact(label);
    if (flat.includes(watch)) return true;
    if (!fuzzy) return false;
    const maxDistance = watch.length >= 9 ? 2 : 1;
    return editDistance(flat, watch) <= maxDistance;
  }
}

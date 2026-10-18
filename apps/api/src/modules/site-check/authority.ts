import { readFileSync } from 'node:fs';
import type { CoverageLevel } from '@hackaton/contracts';
import { BCRA_SOURCE_NAME, type BcraRegistry, type RegistryEntity, type RegistryState } from './bcra-registry.js';
import { describeHost } from './domain.js';
import type { Reference, ZoneReference } from './lookalike.js';
import {
  catalogAuthorizes,
  containsName,
  findZone,
  normalizeName,
  organizationAliases,
  type CatalogEntry,
  type OfficialSources,
} from './official-sources.js';

/**
 * «Oficial» solo con prueba de una autoridad, en este orden:
 * 1. Catálogo curado (`official_catalog`): entrada con fuente y fecha de revisión.
 * 2. Zona reservada al Estado (`government_domain`): gob.ar, gub.uy, .gov… por regla de zona.
 * 3. Padrón del BCRA (`financial_regulator`): el sitio web que el regulador publica para cada entidad.
 * La IA, HTTPS, rankings, certificados o la antigüedad nunca otorgan oficialidad.
 */

export type Basis = 'government_domain' | 'financial_regulator' | 'official_catalog';

export interface OfficialMatch {
  basis: Basis;
  organization: string;
  /** Zona o dominio que autoriza al host. */
  matched: string;
  source: { name: string; url?: string; reviewedAt: string };
  detail: string;
}

/** Organización que un texto dice ser, con las claves de quién la autoriza. */
export interface Claim {
  organization: string;
  keys: string[];
  via: Basis;
}

/** Pista de la IA sobre el tipo de organización declarada. */
export interface ClaimHint {
  kind: 'government' | 'financial_entity' | 'company' | 'other' | 'none';
  country: string | null;
}

const asDateTime = (date: string) => (date.length === 10 ? `${date}T00:00:00.000Z` : new Date(date).toISOString());

// Palabras que no distinguen a una entidad del padrón ("BANCO … S.A.", "COMPAÑIA FINANCIERA").
const GENERIC = new Set(
  'banco bank de la del las los el y s a sa sau sociedad anonima unipersonal uniper compania cia financiera financier limitada limitad cooperativo coop na n sucursal argentina argentino nuevo the of and national association assoc credit'.split(' '),
);
const FINANCIAL_WORDS = /\b(banco|bank|financiera|tarjeta|home ?banking|billetera)\b/;
const coreTokens = (text: string) => normalizeName(text).replace(/\./g, ' ').split(' ').filter((t) => t && !GENERIC.has(t));

export class AuthorityView {
  private readonly entities: RegistryEntity[];
  private readonly df = new Map<string, number>();

  constructor(
    private readonly sources: OfficialSources,
    readonly registry: RegistryState,
    private readonly popular: readonly Reference[],
  ) {
    this.entities = registry.snapshot?.entities ?? [];
    for (const entity of this.entities) for (const token of new Set(coreTokens(entity.name))) this.df.set(token, (this.df.get(token) ?? 0) + 1);
  }

  private catalogEntry(hostname: string): CatalogEntry | undefined {
    return this.sources.entries.find((entry) => catalogAuthorizes(entry, hostname));
  }

  private registryEntity(hostname: string): RegistryEntity | undefined {
    const domain = describeHost(hostname).registrableDomain;
    return domain ? this.entities.find((entity) => entity.domain === domain) : undefined;
  }

  /** Fuente de autoridad que hace oficial al host, o null. Una copia vieja del padrón nunca aprueba. */
  official(hostname: string): OfficialMatch | null {
    const entry = this.catalogEntry(hostname);
    if (entry) {
      const domain = entry.domains.find((d) => catalogAuthorizes({ ...entry, domains: [d] }, hostname))!;
      return {
        basis: 'official_catalog',
        organization: entry.organization,
        matched: domain.domain,
        source: { name: entry.source.name, ...(entry.source.url ? { url: entry.source.url } : {}), reviewedAt: asDateTime(entry.reviewedAt) },
        detail: `${domain.domain} figura en el catálogo curado (${entry.catalog})`,
      };
    }
    const zone = findZone(this.sources.zones, hostname);
    if (zone) {
      return {
        basis: 'government_domain',
        organization: zone.organization,
        matched: zone.suffix,
        source: { name: zone.source.name, ...(zone.source.url ? { url: zone.source.url } : {}), reviewedAt: asDateTime(zone.reviewedAt) },
        detail: `Zona .${zone.suffix} reservada al Estado (${zone.origin})`,
      };
    }
    const entity = this.registry.status === 'fresh' ? this.registryEntity(hostname) : undefined;
    if (entity && this.registry.snapshot) {
      return {
        basis: 'financial_regulator',
        organization: entity.name.slice(0, 120),
        matched: entity.domain,
        source: { name: BCRA_SOURCE_NAME, url: entity.sourceUrl, reviewedAt: this.registry.snapshot.fetchedAt },
        detail: `${entity.domain} es el sitio que el BCRA publica para ${entity.name}`,
      };
    }
    return null;
  }

  /**
   * Cobertura de identidad: completa si una fuente local resolvió o si el padrón está vigente.
   * Con el padrón viejo o caído, un sitio que no está en zona ni catálogo queda parcial o sin verificar.
   */
  coverage(hostname: string): CoverageLevel {
    if (this.catalogEntry(hostname) || findZone(this.sources.zones, hostname)) return 'complete';
    return this.registry.status === 'fresh' ? 'complete' : this.registry.status === 'stale' ? 'partial' : 'unavailable';
  }

  /** Organizaciones a las que pertenece el host (también con el padrón viejo: sirve para no acusar en falso). */
  keys(hostname: string): string[] {
    const keys: string[] = [];
    const entry = this.catalogEntry(hostname);
    if (entry) keys.push(`catalog:${entry.id}`);
    const zone = findZone(this.sources.zones, hostname);
    if (zone) keys.push(`gov:${zone.country}`);
    const entity = this.registryEntity(hostname);
    if (entity) keys.push(`bcra:${entity.code}`);
    return keys;
  }

  /** Mismo dominio registrable o misma organización según las fuentes. */
  sameOrganization(a: string, b: string): boolean {
    const da = describeHost(a).registrableDomain;
    if (da && da === describeHost(b).registrableDomain) return true;
    const keys = new Set(this.keys(a));
    return this.keys(b).some((key) => keys.has(key));
  }

  /** Organizaciones que el texto dice ser (marca declarada, texto de un enlace u organización extraída por la IA). */
  claims(text: string, hint?: ClaimHint): Claim[] {
    const found: Claim[] = [];
    // Organismos del Estado.
    for (const group of this.sources.claims) {
      const name = group.names.find((n) => containsName(text, n));
      if (name) found.push({ organization: name, keys: [`gov:${group.country}`], via: 'government_domain' });
    }
    if (hint?.kind === 'government' && hint.country && !found.some((c) => c.via === 'government_domain')) {
      const country = hint.country.toUpperCase();
      if (this.sources.zones.some((z) => z.country === country)) found.push({ organization: text.slice(0, 120), keys: [`gov:${country}`], via: 'government_domain' });
    }
    // Catálogos curados.
    for (const entry of this.sources.entries) {
      if (organizationAliases(entry.organization, entry.id).some((alias) => containsName(text, alias))) {
        found.push({ organization: entry.organization, keys: [`catalog:${entry.id}`], via: 'official_catalog' });
      }
    }
    // Padrón del BCRA (nombres en mayúsculas y cortados a 35 caracteres).
    const declared = coreTokens(text);
    const financial = FINANCIAL_WORDS.test(normalizeName(text)) || hint?.kind === 'financial_entity';
    const matches = this.entities.filter((entity) => {
      const all = coreTokens(entity.name);
      const distinctive = all.filter((t) => (this.df.get(t) ?? 0) === 1);
      const declaredInName = declared.length > 0 && declared.every((t) => all.includes(t)) && declared.some((t) => (this.df.get(t) ?? 0) <= 4);
      const nameInDeclared = distinctive.length > 0 && distinctive.every((t) => declared.includes(t));
      const exact = declared.length > 0 && distinctive.length === declared.length && declaredInName;
      return (declaredInName || nameInDeclared) && (financial || exact);
    });
    if (matches.length > 0) {
      found.push({ organization: matches[0]!.name.slice(0, 120), keys: matches.map((m) => `bcra:${m.code}`), via: 'financial_regulator' });
    }
    return found;
  }

  /** Referencias para dominios parecidos: padrón (también viejo), catálogos y populares. */
  references(): Reference[] {
    const refs: Reference[] = [];
    const push = (domain: string, organization: string, kind: Reference['kind']) => {
      const host = describeHost(domain);
      if (host.registrableDomain && host.label) refs.push({ domain: host.registrableDomain, label: host.label, organization, kind });
    };
    for (const entity of this.entities) push(entity.domain, entity.name, 'financial_regulator');
    for (const entry of this.sources.entries) for (const d of entry.domains) push(d.domain, entry.organization, 'official_catalog');
    refs.push(...this.popular);
    return refs;
  }

  zoneReferences(): ZoneReference[] {
    return this.sources.zones.map((z) => ({ suffix: z.suffix, organization: z.organization }));
  }

  /** Versiones y estado de las fuentes, para la evidencia y las limitaciones. */
  describe(): { versions: string[]; registry: string } {
    const snapshot = this.registry.snapshot;
    const registry = snapshot
      ? `${BCRA_SOURCE_NAME}: ${snapshot.entities.length} entidades con sitio web (${snapshot.skipped.length} sin sitio utilizable), descargado ${snapshot.fetchedAt}${this.registry.status === 'stale' ? ' (copia vieja: no aprueba)' : ''}`
      : `${BCRA_SOURCE_NAME}: no disponible (${this.registry.error ?? 'sin copia'})`;
    return { versions: this.sources.versions, registry };
  }
}

export class AuthorityService {
  constructor(
    private readonly sources: OfficialSources,
    private readonly registry: BcraRegistry,
    private readonly popular: readonly Reference[],
    private readonly registryWaitMs: number,
  ) {}

  warmUp(): void {
    this.registry.warmUp();
  }

  async view(): Promise<AuthorityView> {
    return new AuthorityView(this.sources, await this.registry.state(this.registryWaitMs), this.popular);
  }
}

/**
 * Lista opcional de dominios populares (solo referencias de parecido, nunca oficialidad).
 * Acepta un dominio u origen por línea o CSV con el origen en la primera columna (formato CrUX).
 */
export function loadPopularDomains(path: string, limit: number): Reference[] {
  const refs: Reference[] = [];
  const seen = new Set<string>();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const first = line.split(',')[0]?.trim();
    if (!first || first.startsWith('#') || first === 'origin') continue;
    let hostname: string;
    try {
      hostname = new URL(/^https?:\/\//.test(first) ? first : `https://${first}`).hostname;
    } catch {
      continue;
    }
    const host = describeHost(hostname);
    if (host.internal || !host.registrableDomain || !host.label || seen.has(host.registrableDomain)) continue;
    seen.add(host.registrableDomain);
    refs.push({ domain: host.registrableDomain, label: host.label, organization: host.registrableDomain, kind: 'popular' });
    if (refs.length >= limit) break;
  }
  return refs;
}

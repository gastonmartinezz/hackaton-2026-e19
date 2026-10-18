import type { CoverageLevel } from '@hackaton/contracts';
import { BCU_SOURCE_NAME, type BcuInstitution, type BcuRegistry, type RegistryState } from './bcu-registry.js';
import { describeHost } from './domain.js';
import type { Reference, ZoneReference } from './lookalike.js';
import {
  catalogAuthorizes,
  findZone,
  normalizeName,
  organizationAliases,
  type CatalogEntry,
  type ClaimGroup,
  type GovernmentZone,
  type OfficialSources,
} from './official-sources.js';

/**
 * «Oficial» solo con prueba de una autoridad, en este orden:
 * 1. Registro de instituciones del BCU (`financial_regulator`), solo con la copia vigente: el dominio
 *    registrable es el del sitio web que el BCU publica para una institución supervisada. Si el dominio
 *    también está en el catálogo, la organización es el nombre corto del catálogo («Banco República (BROU)»
 *    en vez de la razón social). Los dominios que el catálogo revisó y descartó no los aprueba el BCU.
 * 2. Catálogo curado (`official_catalog`): entrada con fuente y fecha de revisión. Cubre lo que no está en
 *    el BCU y los dominios verificados que el BCU no publica (brou.com.uy, además de bancorepublica.com.uy).
 * 3. Zona reservada al Estado (`government_domain`): gub.uy y mil.uy, por regla de zona.
 * La IA, HTTPS, rankings, certificados o la antigüedad nunca otorgan oficialidad.
 */

export type Basis = 'government_domain' | 'financial_regulator' | 'official_catalog';

export interface OfficialMatch {
  basis: Basis;
  organization: string;
  source: { name: string; url?: string; reviewedAt: string };
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

// Palabras que no distinguen a una institución del BCU ("BANCO … S.A.", "… SERVICIOS FINANCIEROS", "COOPERATIVA DE AHORRO Y CRÉDITO").
const GENERIC = new Set(
  'banco bank de la del las los el y s a sa sas srl sau r l ltda limitada sociedad anonima compania cia uruguay uruguaya uruguayo uy sucursal financiera financiero financieros servicios empresa cooperativa coop ahorro credito the of and n international association dinero electronico'.split(' '),
);
const FINANCIAL_WORDS = /\b(banco|bank|financiera|tarjeta|home ?banking|billetera|cooperativa|creditos?|prestamos?|cambio|cobranzas?|dinero electronico|red de pagos)\b/;
/** Palabras distintivas de un texto ya normalizado (sin las genéricas de GENERIC). */
const tokensOf = (normalized: string) => normalized.replace(/\./g, ' ').split(' ').filter((t) => t && !GENERIC.has(t));
const coreTokens = (text: string) => tokensOf(normalizeName(text));
// Partes de una marca declarada: «BPS - Mi cuenta», «Mi cuenta | BPS», «Servicios en línea: DGI».
const SEPARATORS = /\s-\s|[–—|:·•()[\],;/]/;
// El sitio publicado es la dirección raíz («https://scanntech.com/»), no una sección de otro sitio.
const atRoot = (website: string) => /^(https?:\/\/)?[^/\s,;]+\/?$/i.test(website.trim());

/** Nombre tal como se informa y normalizado como se busca en un texto (ver `claims`). */
interface Named {
  name: string;
  needle: string;
}
const named = (name: string): Named => ({ name, needle: normalizeName(name) });

/**
 * Lo que las fuentes dicen con un estado del registro del BCU, con índices y nombres normalizados calculados
 * una sola vez: AuthorityService reutiliza la misma vista mientras el registro no cambie.
 */
export class AuthorityView {
  private readonly institutions: BcuInstitution[];
  private readonly df = new Map<string, number>();
  /** Instituciones del BCU por dominio registrable. */
  private readonly byDomain = new Map<string, BcuInstitution[]>();
  /** Catálogo y BCU enlazados por dominio: la entrada del catálogo que lista un dominio del BCU es esa institución. */
  private readonly linked = new Map<string, Set<string>>();
  /** Zonas de gobierno de la más específica a la menos (gub.uy antes que uy, si existiera). */
  private readonly zonesBySpecificity: GovernmentZone[];
  /** Nombres de organismos del Estado, normalizados. */
  private readonly claimGroups: Array<{ group: ClaimGroup; names: Named[]; acronyms: Named[]; contextNames: Named[]; context: string[] }>;
  /** Alias de cada entrada del catálogo, normalizados y marcados si son una palabra de uso corriente. */
  private readonly catalogAliases: Array<{ entry: CatalogEntry; aliases: Array<{ needle: string; common: boolean }> }>;
  /** Palabras de la razón social y del nombre de fantasía de cada institución del BCU (y las que solo ella usa). */
  private readonly institutionTokens: Array<{ institution: BcuInstitution; names: Array<{ all: string[]; distinctive: string[] }> }>;
  private referencesCache: Reference[] | undefined;
  private zoneReferencesCache: ZoneReference[] | undefined;

  constructor(
    private readonly sources: OfficialSources,
    readonly registry: RegistryState,
  ) {
    this.institutions = registry.snapshot?.institutions ?? [];
    for (const institution of this.institutions) {
      for (const token of new Set([...coreTokens(institution.name), ...coreTokens(institution.tradeName ?? '')])) this.df.set(token, (this.df.get(token) ?? 0) + 1);
      for (const domain of institution.domains) this.byDomain.set(domain, [...(this.byDomain.get(domain) ?? []), institution]);
    }
    const link = (a: string, b: string) => this.linked.set(a, (this.linked.get(a) ?? new Set<string>()).add(b));
    for (const entry of this.sources.entries) {
      for (const { domain } of entry.domains) {
        const registrable = describeHost(domain).registrableDomain;
        const keys = new Set([registrable, domain].filter((key): key is string => Boolean(key)));
        for (const institution of [...keys].flatMap((key) => this.byDomain.get(key) ?? [])) {
          link(`catalog:${entry.id}`, `bcu:${institution.id}`);
          link(`bcu:${institution.id}`, `catalog:${entry.id}`);
        }
      }
    }
    this.zonesBySpecificity = [...this.sources.zones].sort((a, b) => b.suffix.length - a.suffix.length);
    this.claimGroups = this.sources.claims.map((group) => ({
      group,
      names: group.names.map(named),
      acronyms: group.acronyms.map(named),
      contextNames: group.contextNames.map(named),
      context: group.context.map(normalizeName),
    }));
    this.catalogAliases = this.sources.entries.map((entry) => ({
      entry,
      aliases: organizationAliases(entry.organization, entry.id).map((alias) => ({ needle: normalizeName(alias), common: this.commonWord(alias) })),
    }));
    this.institutionTokens = this.institutions.map((institution) => ({
      institution,
      names: [institution.name, institution.tradeName ?? ''].map((name) => {
        const all = coreTokens(name);
        return { all, distinctive: all.filter((t) => (this.df.get(t) ?? 0) === 1) };
      }),
    }));
  }

  private catalogEntry(hostname: string): CatalogEntry | undefined {
    return this.sources.entries.find((entry) => catalogAuthorizes(entry, hostname));
  }

  /**
   * Instituciones del BCU que autorizan el host y la clave con la que lo hacen: el dominio registrable del sitio
   * publicado o, si el BCU publicó un subdominio, ese host y los que cuelgan de él. Se recorren las etiquetas
   * enteras desde el host hasta el dominio registrable: nunca por sufijo de texto.
   */
  private registryMatch(hostname: string): { key: string; institutions: BcuInstitution[] } | null {
    const host = describeHost(hostname);
    if (!host.registrableDomain) return null;
    const labels = host.hostname.split('.');
    const minLabels = host.registrableDomain.split('.').length;
    for (let i = 0; labels.length - i >= minLabels; i++) {
      const key = labels.slice(i).join('.');
      const institutions = this.byDomain.get(key);
      if (institutions) return { key, institutions };
    }
    return null;
  }

  private registryInstitutions(hostname: string): BcuInstitution[] {
    return this.registryMatch(hostname)?.institutions ?? [];
  }

  /** Nombre que ve la persona: el corto del catálogo enlazado, el de fantasía o la razón social. */
  private institutionName(institution: BcuInstitution): string {
    const catalogKey = [...(this.linked.get(`bcu:${institution.id}`) ?? [])][0];
    const entry = catalogKey ? this.sources.entries.find((e) => `catalog:${e.id}` === catalogKey) : undefined;
    return (entry ? entry.organization : (institution.tradeName ?? institution.name)).slice(0, 120);
  }

  /** Fuente de autoridad que hace oficial al host, o null. Una copia vieja del registro del BCU nunca aprueba. */
  official(hostname: string): OfficialMatch | null {
    const entry = this.catalogEntry(hostname);
    const domain = describeHost(hostname).registrableDomain;
    const match = this.registry.status === 'fresh' && domain && !this.sources.discarded.has(domain) ? this.registryMatch(hostname) : null;
    const candidates = match && !this.sources.discarded.has(match.key) ? match.institutions : [];
    const institution = candidates.find((i) => atRoot(i.website)) ?? candidates[0];
    if (match && institution && this.registry.snapshot) {
      return {
        basis: 'financial_regulator',
        organization: entry ? entry.organization : this.institutionName(institution),
        source: { name: BCU_SOURCE_NAME, url: institution.sourceUrl, reviewedAt: this.registry.snapshot.fetchedAt },
      };
    }
    if (entry) {
      return {
        basis: 'official_catalog',
        organization: entry.organization,
        source: { name: entry.source.name, ...(entry.source.url ? { url: entry.source.url } : {}), reviewedAt: asDateTime(entry.reviewedAt) },
      };
    }
    const zone = findZone(this.zonesBySpecificity, hostname);
    if (zone) {
      return {
        basis: 'government_domain',
        organization: zone.organization,
        source: { name: zone.source.name, ...(zone.source.url ? { url: zone.source.url } : {}), reviewedAt: asDateTime(zone.reviewedAt) },
      };
    }
    return null;
  }

  /**
   * Cobertura de identidad: completa si una fuente local resolvió o si el registro del BCU está vigente.
   * Con el registro viejo o caído, un sitio que no está en zona ni catálogo queda parcial o sin verificar.
   */
  coverage(hostname: string): CoverageLevel {
    if (this.catalogEntry(hostname) || findZone(this.zonesBySpecificity, hostname)) return 'complete';
    return this.registry.status === 'fresh' ? 'complete' : this.registry.status === 'stale' ? 'partial' : 'unavailable';
  }

  /** Organizaciones a las que pertenece el host (también con el registro viejo: sirve para no acusar en falso). */
  keys(hostname: string): string[] {
    const keys = new Set<string>();
    const add = (key: string) => {
      keys.add(key);
      for (const other of this.linked.get(key) ?? []) keys.add(other);
    };
    const entry = this.catalogEntry(hostname);
    if (entry) add(`catalog:${entry.id}`);
    const zone = findZone(this.zonesBySpecificity, hostname);
    if (zone) add(`gov:${zone.country}`);
    for (const institution of this.registryInstitutions(hostname)) add(`bcu:${institution.id}`);
    return [...keys];
  }

  /** Mismo dominio registrable o misma organización según las fuentes. */
  sameOrganization(a: string, b: string): boolean {
    const da = describeHost(a).registrableDomain;
    if (da && da === describeHost(b).registrableDomain) return true;
    const keys = new Set(this.keys(a));
    return this.keys(b).some((key) => keys.has(key));
  }

  /** El nombre, sin tildes, espacios ni guiones, es una palabra de uso corriente (data/common-words.json). */
  private commonWord(name: string): boolean {
    return this.sources.commonWords.has(normalizeName(name).replace(/[^a-z0-9]/g, ''));
  }

  /** Organizaciones que el texto dice ser (marca declarada, texto de un enlace u organización extraída por la IA). */
  claims(text: string, hint?: ClaimHint): Claim[] {
    const found: Claim[] = [];
    // El texto se normaliza una vez; cada nombre está normalizado desde que se armó la vista. Un nombre cuenta si
    // aparece como palabras completas (y tiene al menos 3 caracteres).
    const normalized = normalizeName(text);
    const padded = ` ${normalized} `;
    const contains = (needle: string) => needle.length >= 3 && padded.includes(` ${needle} `);
    let parts: string[] | undefined;
    const standsAlone = (needle: string) => (parts ??= text.split(SEPARATORS).map(normalizeName)).includes(needle);
    // Organismos del Estado. Los nombres ambiguos («MEF», «MSP») piden una palabra del país o la pista de la IA.
    // Las siglas («BPS», «DGI») alcanzan solas si son toda la marca o una parte separada («BPS - Mi cuenta»);
    // dentro de un nombre más largo («BPS Logistics», «DGI Consultores») también piden contexto.
    for (const { group, names, acronyms, contextNames, context } of this.claimGroups) {
      const governmentHint = hint?.kind === 'government' && (!hint.country || hint.country.toUpperCase() === group.country);
      const withContext = governmentHint || context.some(contains);
      const name =
        names.find((n) => contains(n.needle))?.name ??
        acronyms.find((n) => (withContext ? contains(n.needle) : standsAlone(n.needle)))?.name ??
        (withContext ? contextNames.find((n) => contains(n.needle))?.name : undefined);
      if (name) found.push({ organization: name, keys: [`gov:${group.country}`], via: 'government_domain' });
    }
    if (hint?.kind === 'government' && hint.country && !found.some((c) => c.via === 'government_domain')) {
      const country = hint.country.toUpperCase();
      if (this.sources.zones.some((z) => z.country === country)) found.push({ organization: text.slice(0, 120), keys: [`gov:${country}`], via: 'government_domain' });
    }
    const declared = tokensOf(normalized);
    const financial = FINANCIAL_WORDS.test(normalized) || hint?.kind === 'financial_entity';
    // Catálogos curados. Un alias que es una palabra de uso corriente («Verde», «ASI», «correo», «Universal») solo
    // cuenta con una palabra financiera o la pista de la IA, como los nombres de fantasía del BCU: si no, un enlace
    // «Así funciona» o «Mi correo» se tomaría como la entidad. Los demás alias («Correo Uruguayo») alcanzan solos.
    for (const { entry, aliases } of this.catalogAliases) {
      if (aliases.some((alias) => contains(alias.needle) && (financial || !alias.common))) {
        found.push({ organization: entry.organization, keys: [`catalog:${entry.id}`], via: 'official_catalog' });
      }
    }
    // Registro del BCU: razón social («BANCO ITAU URUGUAY S.A.») o nombre de fantasía («OCA Card», «Prex»).
    // Sin una palabra financiera (o la pista de la IA) no alcanza: «Verde» o «Pronto» también son palabras comunes.
    const matches = !financial
      ? []
      : this.institutionTokens
          .filter(({ names }) =>
            names.some(({ all, distinctive }) => {
              const declaredInName = declared.length > 0 && declared.every((t) => all.includes(t)) && declared.some((t) => (this.df.get(t) ?? 0) <= 4);
              const nameInDeclared = distinctive.length > 0 && distinctive.every((t) => declared.includes(t));
              return declaredInName || nameInDeclared;
            }),
          )
          .map(({ institution }) => institution);
    if (matches.length > 0) {
      // Se nombra la que menos palabras agrega a lo declarado: «Cooperativa Artigas» es la cooperativa
      // José Artigas, no la Agrupación Magisterial José Artigas, aunque las dos coinciden.
      const extra = (i: BcuInstitution) => Math.min(...[i.name, i.tradeName ?? i.name].map((name) => coreTokens(name).filter((t) => !declared.includes(t)).length));
      const best = [...matches].sort((a, b) => extra(a) - extra(b))[0]!;
      found.push({ organization: this.institutionName(best), keys: matches.map((m) => `bcu:${m.id}`), via: 'financial_regulator' });
    }
    return found;
  }

  /**
   * Referencias para dominios parecidos: registro del BCU (también viejo) y catálogos. Las que tienen
   * por nombre una palabra de uso corriente («correo», «delta», «verde») van marcadas: solo se comparan por el
   * dominio completo y el aspecto (ver lookalike.ts).
   */
  references(): readonly Reference[] {
    if (this.referencesCache) return this.referencesCache;
    const refs: Reference[] = [];
    const push = (domain: string, organization: string, kind: Reference['kind']) => {
      const host = describeHost(domain);
      if (!host.registrableDomain || !host.label) return;
      const commonWord = this.commonWord(host.label);
      const brandKeywords = commonWord ? this.sources.brandKeywords.get(host.label.replace(/-/g, '')) : undefined;
      refs.push({ domain: host.registrableDomain, label: host.label, organization, kind, commonWord, ...(brandKeywords ? { brandKeywords } : {}) });
    };
    // Un sitio publicado en un subdominio ajeno no es referencia: su dominio registrable es de otra organización.
    for (const institution of this.institutions) {
      for (const domain of institution.domains) if (describeHost(domain).registrableDomain === domain) push(domain, this.institutionName(institution), 'financial_regulator');
    }
    for (const entry of this.sources.entries) for (const d of entry.domains) push(d.domain, entry.organization, 'official_catalog');
    return (this.referencesCache = refs);
  }

  zoneReferences(): readonly ZoneReference[] {
    return (this.zoneReferencesCache ??= this.sources.zones.map((z) => ({ suffix: z.suffix, organization: z.organization })));
  }
}

export class AuthorityService {
  private cached: AuthorityView | undefined;

  constructor(
    private readonly sources: OfficialSources,
    private readonly registry: BcuRegistry,
    private readonly registryWaitMs: number,
  ) {}

  warmUp(): void {
    this.registry.warmUp();
  }

  /** La vista se arma de nuevo solo cuando cambia el estado del registro del BCU (copia, vigencia o error). */
  async view(): Promise<AuthorityView> {
    const state = await this.registry.state(this.registryWaitMs);
    const cached = this.cached?.registry;
    if (!cached || cached.snapshot !== state.snapshot || cached.status !== state.status || cached.error !== state.error) {
      this.cached = new AuthorityView(this.sources, state);
    }
    return this.cached!;
  }
}

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hostname } from '@hackaton/contracts';
import { z } from 'zod';
import { describeHost, hostMatches } from './domain.js';

/**
 * Fuentes de autoridad locales y versionadas (en `data/`):
 * - `government-zones.json`: zonas reservadas al Estado (.gov, .mil) y nombres de organismos (`claims`).
 * - `official-sites.<país>.json`: catálogos curados con fuente y fecha de revisión por entrada
 *   (por ejemplo, Uruguay). Sus `zones` también cuentan como zonas de gobierno, y sus `discarded`
 *   (dominios revisados a mano y descartados, con el motivo) no los aprueba el registro del BCU.
 * - `common-words.json`: palabras de uso corriente («correo», «verde», «delta»). No es una fuente de
 *   autoridad sino una heurística de dominios parecidos: una referencia con ese nombre solo se compara
 *   por su dominio completo o su aspecto (ver lookalike.ts).
 * Un archivo inválido detiene el arranque: nunca se usa un catálogo a medias.
 */

export const DATA_DIR = fileURLToPath(new URL('./data/', import.meta.url));

export interface SourceRef {
  name: string;
  url?: string;
}

/** Fuente como texto, URL o `{ name, url }`. */
const Source = z
  .union([z.string().trim().min(1), z.strictObject({ name: z.string().min(1), url: z.url().optional() })])
  .transform((value): SourceRef => {
    if (typeof value !== 'string') return value;
    return /^https?:\/\//.test(value) ? { name: value, url: value } : { name: value };
  });

const ZoneSuffix = z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*$/);

const ZonesFile = z.strictObject({
  version: z.string().min(1),
  note: z.string().optional(),
  zones: z.array(
    z.strictObject({
      suffix: ZoneSuffix,
      organization: z.string().min(1).max(120),
      country: z.string().length(2),
      source: Source,
      reviewedAt: z.iso.date(),
      notes: z.string().optional(),
    }),
  ),
  claims: z.array(
    z.strictObject({
      country: z.string().length(2),
      organization: z.string().min(1),
      note: z.string().optional(),
      // containsName ignora los nombres de menos de 3 caracteres: se rechazan para que no queden inertes.
      names: z.array(z.string().min(3)).min(1),
      /** Siglas que alcanzan solas si son toda la marca o una parte separada; dentro de un nombre más largo piden contexto. */
      acronyms: z.array(z.string().min(3)).default([]),
      /** Nombres ambiguos: solo cuentan con una palabra de `context` en el texto o con la pista de la IA. */
      contextNames: z.array(z.string().min(3)).default([]),
      context: z.array(z.string().min(3)).default([]),
    }),
  ),
});

const CatalogFile = z.object({
  /** Número o texto ("1", "2026-10-17.1"). */
  version: z.union([z.string().min(1), z.number().int().positive().transform(String)]),
  country: z.string().length(2),
  reviewedAt: z.iso.date(),
  zones: z
    .array(z.object({ suffix: ZoneSuffix, organization: z.string().min(1).max(120), source: Source, notes: z.string().optional() }))
    .default([]),
  entries: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      /** Nombre corto que ve la persona («Antel», «Banco República (BROU)»). */
      organization: z.string().min(1).max(40),
      /** Razón social o nombre completo, solo como referencia. */
      legalName: z.string().min(1).max(200).optional(),
      category: z.string().min(1),
      domains: z.array(z.object({ domain: Hostname, scope: z.enum(['exact', 'subdomains']) })).min(1),
      source: Source,
      sourceType: z.string().min(1),
      reviewedAt: z.iso.date(),
      notes: z.string().optional(),
    }),
  ),
  discarded: z.array(z.unknown()).default([]),
});

const CommonWordsFile = z.strictObject({
  version: z.string().min(1),
  note: z.string().optional(),
  /** Como etiqueta de dominio: minúsculas, sin tildes, espacios ni guiones. */
  words: z.array(z.string().regex(/^[a-z0-9]+$/)).min(1),
});

/** Descarte con dominio: el texto puede traer varios («a.com.uy, b.uy») o ninguno («-»). */
const Discarded = z.object({ domain: z.string(), reason: z.string().optional() });

export interface GovernmentZone {
  suffix: string;
  organization: string;
  country: string;
  source: SourceRef;
  reviewedAt: string;
  /** Archivo del que salió (para la evidencia). */
  origin: string;
}

export interface CatalogEntry {
  id: string;
  organization: string;
  category: string;
  country: string;
  domains: Array<{ domain: string; scope: 'exact' | 'subdomains' }>;
  source: SourceRef;
  sourceType: string;
  reviewedAt: string;
  /** Archivo y versión del catálogo. */
  catalog: string;
}

export interface ClaimGroup {
  country: string;
  organization: string;
  /** Alcanzan solos («Banco de Previsión Social», «Dirección General Impositiva»). */
  names: string[];
  /**
   * Siglas («BPS», «DGI») que alcanzan solas cuando son toda la marca declarada o una parte separada por
   * guion, barra o dos puntos («BPS - Mi cuenta»). Dentro de un nombre más largo («BPS Logistics»,
   * «DGI Consultores») piden contexto, como `contextNames`.
   */
  acronyms: string[];
  /** Ambiguos («MEF», «MSP»): necesitan una palabra de `context` o la pista de la IA. */
  contextNames: string[];
  context: string[];
}

export interface OfficialSources {
  zones: GovernmentZone[];
  entries: CatalogEntry[];
  claims: ClaimGroup[];
  /**
   * Dominios registrables que un catálogo revisó y descartó (no respondían, redirigían a otro sitio, sin
   * verificar…), con el motivo. Lo revisado a mano manda: el registro del BCU no los aprueba.
   */
  discarded: Map<string, string>;
  /** Palabras de uso corriente (heurística de dominios parecidos, no fuente de autoridad). */
  commonWords: Set<string>;
  /** Versiones cargadas, para la evidencia ("government-zones 2026-10-17.1", "official-sites.uy …"). */
  versions: string[];
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function describeError(file: string, error: unknown): Error {
  if (error instanceof z.ZodError) {
    const issues = error.issues.slice(0, 10).map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    return new Error(`Fuente oficial inválida (${file}):\n${issues}`);
  }
  return new Error(`Fuente oficial ilegible (${file}): ${(error as Error).message}`);
}

/**
 * Carga zonas, catálogos y palabras comunes. Por defecto, `government-zones.json`, todos los
 * `official-sites.*.json` y `common-words.json` de `data/`. Lanza si alguno es inválido o si un
 * dominio aparece en dos entradas.
 */
export function loadOfficialSources(
  options: { dataDir?: string; zonesFile?: string; catalogFiles?: string[]; commonWordsFile?: string } = {},
): OfficialSources {
  const dataDir = options.dataDir ?? DATA_DIR;
  const zonesPath = options.zonesFile ?? join(dataDir, 'government-zones.json');
  const commonWordsPath = options.commonWordsFile ?? join(dataDir, 'common-words.json');
  const catalogPaths =
    options.catalogFiles ??
    readdirSync(dataDir)
      .filter((name) => /^official-sites\.[a-z-]+\.json$/.test(name))
      .sort()
      .map((name) => join(dataDir, name));

  const sources: OfficialSources = { zones: [], entries: [], claims: [], discarded: new Map(), commonWords: new Set(), versions: [] };

  try {
    const zones = ZonesFile.parse(readJson(zonesPath));
    const origin = `government-zones ${zones.version}`;
    sources.versions.push(origin);
    sources.zones.push(...zones.zones.map((zone) => ({ ...zone, origin })));
    sources.claims.push(
      ...zones.claims.map(({ country, organization, names, acronyms, contextNames, context }) => ({ country, organization, names, acronyms, contextNames, context })),
    );
  } catch (error) {
    throw describeError(zonesPath, error);
  }

  try {
    sources.commonWords = new Set(CommonWordsFile.parse(readJson(commonWordsPath)).words);
  } catch (error) {
    throw describeError(commonWordsPath, error);
  }

  for (const path of catalogPaths) {
    let file: z.infer<typeof CatalogFile>;
    try {
      file = CatalogFile.parse(readJson(path));
    } catch (error) {
      throw describeError(path, error);
    }
    const catalog = `${path.split(/[\\/]/).pop()} ${file.version}`;
    sources.versions.push(catalog);
    for (const zone of file.zones) {
      sources.zones.push({ ...zone, country: file.country, reviewedAt: file.reviewedAt, origin: catalog });
    }
    for (const entry of file.entries) {
      sources.entries.push({ ...entry, country: file.country, catalog });
    }
    for (const item of file.discarded) {
      const discarded = Discarded.safeParse(item);
      if (!discarded.success) continue;
      // Solo dominios registrables completos: «mi.movistar.com.uy» descartado no descarta movistar.com.uy.
      for (const domain of discarded.data.domain.toLowerCase().split(/[\s,;/]+/)) {
        if (domain && describeHost(domain).registrableDomain === domain) sources.discarded.set(domain, `${discarded.data.reason ?? 'Descartado'} (${catalog})`);
      }
    }
  }

  const seen = new Map<string, string>();
  for (const entry of sources.entries) {
    for (const { domain } of entry.domains) {
      const previous = seen.get(domain);
      if (previous && previous !== entry.id) throw new Error(`Fuente oficial inválida: ${domain} figura en ${previous} y en ${entry.id}`);
      seen.set(domain, entry.id);
    }
  }
  // Una nota en `discarded` sobre un dominio que sí es una entrada («No es un descarte») no lo descarta.
  for (const domain of seen.keys()) sources.discarded.delete(domain);
  return sources;
}

/** Zona de gobierno que contiene al host, por límites de dominio. */
export function findZone(zones: readonly GovernmentZone[], hostname: string): GovernmentZone | undefined {
  // La zona más específica primero (gub.uy antes que uy, si existiera).
  return [...zones].sort((a, b) => b.suffix.length - a.suffix.length).find((zone) => hostname !== zone.suffix && hostMatches(hostname, zone.suffix, 'subdomains'));
}

export function catalogAuthorizes(entry: CatalogEntry, hostname: string): boolean {
  return entry.domains.some((d) => hostMatches(hostname, d.domain, d.scope));
}

/** Texto comparable: sin tildes, minúsculas y espacios simples (conserva los puntos de dominios). */
export const normalizeName = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/(^|\s)\.+|\.+(\s|$)/g, ' ')
    .trim();

/** El nombre aparece como palabras completas dentro del texto. */
export const containsName = (text: string, name: string) => {
  const needle = normalizeName(name);
  return needle.length >= 3 && ` ${normalizeName(text)} `.includes(` ${needle} `);
};

/** Alias de una organización del catálogo: "Antel (Administración Nacional de Telecomunicaciones)" → ambos. */
export const organizationAliases = (organization: string, id: string) =>
  [...new Set([organization, ...organization.split(/[(),;]| - /), id.replace(/-/g, ' ')].map((s) => s.trim()).filter((s) => s.length >= 3))];

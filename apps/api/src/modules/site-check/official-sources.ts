import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hostname } from '@hackaton/contracts';
import { z } from 'zod';
import { hostMatches } from './domain.js';

/**
 * Fuentes de autoridad locales y versionadas (en `data/`):
 * - `government-zones.json`: zonas reservadas al Estado (gob.ar, gov, …) y nombres de organismos.
 * - `official-sites.<país>.json`: catálogos curados con fuente y fecha de revisión por entrada
 *   (por ejemplo, Uruguay). Sus `zones` también cuentan como zonas de gobierno.
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
    z.strictObject({ country: z.string().length(2), organization: z.string().min(1), note: z.string().optional(), names: z.array(z.string().min(2)).min(1) }),
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
  names: string[];
}

export interface OfficialSources {
  zones: GovernmentZone[];
  entries: CatalogEntry[];
  claims: ClaimGroup[];
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
 * Carga zonas y catálogos. Por defecto, `government-zones.json` y todos los `official-sites.*.json`
 * de `data/`. Lanza si alguno es inválido o si un dominio aparece en dos entradas.
 */
export function loadOfficialSources(options: { dataDir?: string; zonesFile?: string; catalogFiles?: string[] } = {}): OfficialSources {
  const dataDir = options.dataDir ?? DATA_DIR;
  const zonesPath = options.zonesFile ?? join(dataDir, 'government-zones.json');
  const catalogPaths =
    options.catalogFiles ??
    readdirSync(dataDir)
      .filter((name) => /^official-sites\.[a-z-]+\.json$/.test(name))
      .sort()
      .map((name) => join(dataDir, name));

  const sources: OfficialSources = { zones: [], entries: [], claims: [], versions: [] };

  try {
    const zones = ZonesFile.parse(readJson(zonesPath));
    const origin = `government-zones ${zones.version}`;
    sources.versions.push(origin);
    sources.zones.push(...zones.zones.map((zone) => ({ ...zone, origin })));
    sources.claims.push(...zones.claims.map(({ country, organization, names }) => ({ country, organization, names })));
  } catch (error) {
    throw describeError(zonesPath, error);
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
  }

  const seen = new Map<string, string>();
  for (const entry of sources.entries) {
    for (const { domain } of entry.domains) {
      const previous = seen.get(domain);
      if (previous && previous !== entry.id) throw new Error(`Fuente oficial inválida: ${domain} figura en ${previous} y en ${entry.id}`);
      seen.set(domain, entry.id);
    }
  }
  return sources;
}

/** Zona de gobierno que contiene al host, por límites de dominio. */
export function findZone(zones: readonly GovernmentZone[], hostname: string): GovernmentZone | undefined {
  // La zona más específica primero (gob.ar antes que ar, si existiera).
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

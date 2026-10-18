import { z } from 'zod';
import { withTimeout } from './cache.js';
import { describeHost } from './domain.js';
import { errorKind, ProviderHttpError } from './types.js';

/**
 * Padrón de entidades financieras del BCRA, descargado del regulador.
 *
 * El BCRA no publica el padrón con sitios web en su catálogo de API (https://www.bcra.gob.ar/apis-banco-central/).
 * La página https://www.bcra.gob.ar/entidades-financieras/ arma el listado con un endpoint JSON propio:
 * `entidades-financieras.php?action=list` (código y nombre) y `?action=detail&category=<código>`
 * (incluye `sitio_web`). Es un endpoint sin documentar: el formato se valida con Zod y cualquier
 * cambio hace fallar la descarga (identidad `unavailable`), nunca una aprobación.
 */

export const BCRA_ENDPOINT = 'https://www.bcra.gob.ar/api/endpoints/entidades-financieras.php';
export const BCRA_SOURCE_NAME = 'Padrón de entidades financieras del BCRA';

const ListResponse = z.object({
  success: z.literal(true),
  disponible: z.boolean().optional(),
  fecha_actualizacion: z.object({ texto: z.string().optional() }).optional(),
  entidades: z.array(z.object({ codigo: z.string().regex(/^\d{5}$/), nombre: z.string().min(1) })).min(1),
});

const DetailResponse = z.object({
  success: z.literal(true),
  entidad: z.object({ codigo: z.string(), nombre: z.string().min(1), sitio_web: z.string().nullable().optional() }),
});

export interface RegistryEntity {
  code: string;
  name: string;
  /** Sitio web tal como lo publica el BCRA. */
  website: string;
  /** Dominio registrable (eTLD+1) del sitio web: autoriza ese dominio y sus subdominios. */
  domain: string;
  /** URL del detalle descargado (evidencia). */
  sourceUrl: string;
}

export interface RegistrySnapshot {
  entities: RegistryEntity[];
  /** Entidades sin sitio web utilizable (vacío, con espacios, inválido o interno). */
  skipped: Array<{ code: string; name: string; reason: string }>;
  fetchedAt: string;
  sourceUrl: string;
  /** Período que informa el BCRA ("julio de 2026"). */
  updatedLabel: string | null;
}

export interface RegistryState {
  /** fresh: copia vigente. stale: copia vieja usable solo para detectar imitaciones. unavailable: sin copia. */
  status: 'fresh' | 'stale' | 'unavailable';
  snapshot: RegistrySnapshot | null;
  error: string | null;
}

export interface BcraRegistryOptions {
  enabled: boolean;
  fetchImpl?: typeof fetch;
  /** Tiempo máximo por petición al BCRA. */
  requestTimeoutMs: number;
  /** Se intenta refrescar después de este tiempo. */
  refreshAfterMs: number;
  /** Hasta acá la copia sigue vigente aunque el refresco falle. */
  validForMs: number;
  /** Hasta acá la copia vieja se usa para detectar imitaciones, nunca para aprobar. */
  usableForMs: number;
  /** Espera mínima entre intentos fallidos. */
  retryAfterMs?: number;
  concurrency?: number;
  now?: () => number;
}

/** Normaliza el `sitio_web` publicado. Devuelve null si no es utilizable. */
export function parseWebsite(raw: string | null | undefined): { website: string; domain: string } | { reason: string } {
  const website = (raw ?? '').trim();
  if (!website) return { reason: 'sin sitio web' };
  if (/\s/.test(website)) return { reason: 'sitio web con espacios' };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  } catch {
    return { reason: 'sitio web inválido' };
  }
  const host = describeHost(url.hostname);
  if (host.internal || host.isIp || !host.registrableDomain) return { reason: 'sitio web no público' };
  return { website, domain: host.registrableDomain };
}

export class BcraRegistry {
  private snapshot: RegistrySnapshot | null = null;
  private fetchedAtMs = 0;
  private inflight: Promise<void> | null = null;
  private lastFailureMs = Number.NEGATIVE_INFINITY;
  private lastError: string | null = null;

  constructor(private readonly options: BcraRegistryOptions) {}

  private get now() {
    return (this.options.now ?? Date.now)();
  }

  /** Inicia la descarga sin esperar (al arrancar el servidor). */
  warmUp(): void {
    void this.refreshIfNeeded();
  }

  /**
   * Estado actual. Si no hay copia vigente espera la descarga hasta `waitMs`; nunca bloquea más.
   */
  async state(waitMs: number): Promise<RegistryState> {
    if (!this.options.enabled) return { status: 'unavailable', snapshot: null, error: 'disabled' };
    const pending = this.refreshIfNeeded();
    if (this.status() !== 'fresh' && pending) {
      await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, waitMs).unref())]);
    }
    const status = this.status();
    return { status, snapshot: status === 'unavailable' ? null : this.snapshot, error: status === 'fresh' ? null : (this.lastError ?? 'loading') };
  }

  private status(): RegistryState['status'] {
    if (!this.snapshot) return 'unavailable';
    const age = this.now - this.fetchedAtMs;
    if (age <= this.options.validForMs) return 'fresh';
    if (age <= this.options.usableForMs) return 'stale';
    return 'unavailable';
  }

  private refreshIfNeeded(): Promise<void> | null {
    if (this.inflight) return this.inflight;
    const due = !this.snapshot || this.now - this.fetchedAtMs >= this.options.refreshAfterMs;
    const backoff = this.now - this.lastFailureMs < (this.options.retryAfterMs ?? 5 * 60_000);
    if (!due || backoff) return null;
    this.inflight = this.download()
      .then((snapshot) => {
        this.snapshot = snapshot;
        this.fetchedAtMs = Date.parse(snapshot.fetchedAt);
        this.lastError = null;
      })
      .catch((error: unknown) => {
        this.lastFailureMs = this.now;
        this.lastError = errorKind(error);
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async getJson<S extends z.ZodType>(urls: string[], schema: S): Promise<z.infer<S>> {
    let lastError: unknown;
    // El CDN del BCRA a veces responde 502 a una variante de la URL y no a otra.
    for (const url of urls) {
      try {
        const response = await withTimeout(this.options.requestTimeoutMs, (signal) =>
          (this.options.fetchImpl ?? fetch)(url, { headers: { accept: 'application/json' }, credentials: 'omit', signal }),
        );
        if (!response.ok) throw new ProviderHttpError(response.status);
        return schema.parse(await response.json());
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private async download(): Promise<RegistrySnapshot> {
    const fetchedAt = new Date(this.now).toISOString();
    const list = await this.getJson([`${BCRA_ENDPOINT}?action=list&lang=es`, `${BCRA_ENDPOINT}?action=list`], ListResponse);
    if (list.disponible === false) throw new Error('Padrón no disponible');

    const previous = new Map(this.snapshot?.entities.map((e) => [e.code, e]));
    const entities: RegistryEntity[] = [];
    const skipped: RegistrySnapshot['skipped'] = [];
    let failed = 0;
    const queue = [...list.entidades];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const detail = await this.getJson(
            [`${BCRA_ENDPOINT}?action=detail&category=${item.codigo}&lang=es`, `${BCRA_ENDPOINT}?action=detail&category=${item.codigo}`],
            DetailResponse,
          );
          const site = parseWebsite(detail.entidad.sitio_web);
          if ('reason' in site) skipped.push({ code: item.codigo, name: detail.entidad.nombre, reason: site.reason });
          else entities.push({ code: item.codigo, name: detail.entidad.nombre, ...site, sourceUrl: `${BCRA_ENDPOINT}?action=detail&category=${item.codigo}` });
        } catch {
          // Un detalle caído: se conserva la copia anterior de esa entidad, si existe.
          failed++;
          const old = previous.get(item.codigo);
          if (old) entities.push(old);
        }
      }
    };
    await Promise.all(Array.from({ length: this.options.concurrency ?? 6 }, worker));
    // Con demasiados detalles caídos la copia no es confiable.
    if (failed > Math.max(2, list.entidades.length * 0.1)) throw new Error(`Faltan ${failed} detalles del padrón`);

    entities.sort((a, b) => a.code.localeCompare(b.code));
    return { entities, skipped, fetchedAt, sourceUrl: `${BCRA_ENDPOINT}?action=list`, updatedLabel: list.fecha_actualizacion?.texto ?? null };
  }
}

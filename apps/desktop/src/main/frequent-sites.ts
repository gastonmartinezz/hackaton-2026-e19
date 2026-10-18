/**
 * Sitios que la persona abre más seguido, para ofrecerlos en el inicio como
 * opción rápida. Solo se guarda el origen (sin ruta, búsqueda ni nada de la
 * página), cuántas veces entró y cuándo fue la última. Queda en el equipo:
 * nunca se manda al backend ni se registra.
 */
import { sanitizeOrigin } from '@asistente/privacy';
import { z } from 'zod';

/** Cuántos sitios se recuerdan; al pasarse, se olvida el menos usado. */
export const MAX_STORED_SITES = 50;
/** Cuántos se ofrecen en el inicio. */
export const MAX_SHOWN_SITES = 4;

export const FrequentSiteSchema = z.object({
  origin: z
    .string()
    .max(300)
    .refine((o) => sanitizeOrigin(o) === o),
  visits: z.number().int().min(1),
  /** Milisegundos desde 1970. */
  lastVisit: z.number().int().min(0),
});
export type FrequentSite = z.infer<typeof FrequentSiteSchema>;

/** Más visitas primero; con las mismas, el de la visita más reciente. */
function byUse(a: FrequentSite, b: FrequentSite): number {
  return b.visits - a.visits || b.lastVisit - a.lastVisit;
}

/** Suma una entrada al sitio. Si hay demasiados, se olvida el menos usado (nunca el que se acaba de abrir). */
export function recordVisit(sites: readonly FrequentSite[], origin: string, now: number): FrequentSite[] {
  const current = sites.find((s) => s.origin === origin);
  const visited = { origin, visits: (current?.visits ?? 0) + 1, lastVisit: now };
  const rest = sites.filter((s) => s.origin !== origin).sort(byUse).slice(0, MAX_STORED_SITES - 1);
  return [visited, ...rest];
}

/** Olvida un host (por ejemplo, Protección de sitios lo marcó como riesgoso). */
export function forgetHost(sites: readonly FrequentSite[], hostname: string): FrequentSite[] {
  return sites.filter((s) => new URL(s.origin).hostname !== hostname);
}

export function topSites(sites: readonly FrequentSite[], count = MAX_SHOWN_SITES): FrequentSite[] {
  return [...sites].sort(byUse).slice(0, count);
}

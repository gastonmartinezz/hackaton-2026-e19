/**
 * Sitios que la persona abre más seguido, para ofrecerlos en el inicio como
 * opción rápida. Solo se guarda el origen (sin ruta, búsqueda ni nada de la
 * página), cuántas veces entró, cuándo fue la última y, si lo abrió con ayuda
 * desde una búsqueda, la tarea que entendió el asistente («Renovar la cédula»):
 * es lo que muestra el acceso del historial (v2.4). Queda en el equipo: nunca
 * se manda al backend ni se registra.
 */
import { sanitizeOrigin } from '@asistente/privacy';
import { z } from 'zod';

/** Cuántos sitios se recuerdan; al pasarse, se olvida el menos usado. */
export const MAX_STORED_SITES = 50;
/** Cuántos se ofrecen en el inicio (accesos del historial, v2.4). */
export const MAX_SHOWN_SITES = 3;
/** Largo máximo de la tarea guardada (una frase corta, como el objetivo de la tarjeta). */
export const MAX_TASK_LENGTH = 80;

export const FrequentSiteSchema = z.object({
  origin: z
    .string()
    .max(300)
    .refine((o) => sanitizeOrigin(o) === o),
  visits: z.number().int().min(1),
  /** Milisegundos desde 1970. */
  lastVisit: z.number().int().min(0),
  /** La última tarea que se hizo con ayuda en este sitio, si la hubo. */
  task: z.string().min(1).max(MAX_TASK_LENGTH).optional(),
});
export type FrequentSite = z.infer<typeof FrequentSiteSchema>;

/** Más visitas primero; con las mismas, el de la visita más reciente. */
function byUse(a: FrequentSite, b: FrequentSite): number {
  return b.visits - a.visits || b.lastVisit - a.lastVisit;
}

/**
 * Suma una entrada al sitio. Con `task`, esa pasa a ser su tarea; sin ella, se
 * conserva la anterior. Si hay demasiados, se olvida el menos usado (nunca el
 * que se acaba de abrir).
 */
export function recordVisit(sites: readonly FrequentSite[], origin: string, now: number, task?: string | null): FrequentSite[] {
  const current = sites.find((s) => s.origin === origin);
  const label = cleanTask(task) ?? current?.task;
  const visited: FrequentSite = { origin, visits: (current?.visits ?? 0) + 1, lastVisit: now, ...(label ? { task: label } : {}) };
  const rest = sites.filter((s) => s.origin !== origin).sort(byUse).slice(0, MAX_STORED_SITES - 1);
  return [visited, ...rest];
}

/** Olvida un host (por ejemplo, Protección de sitios lo marcó como riesgoso). */
export function forgetHost(sites: readonly FrequentSite[], hostname: string): FrequentSite[] {
  return sites.filter((s) => new URL(s.origin).hostname !== hostname);
}

/** Una línea, sin espacios de más y recortada; null si no queda nada. */
export function cleanTask(task: string | null | undefined): string | null {
  const trimmed = task?.replace(/\s+/g, ' ').trim() ?? '';
  if (!trimmed) return null;
  // Como un nombre: «renovar documento» → «Renovar documento».
  const text = trimmed[0]!.toLocaleUpperCase('es') + trimmed.slice(1);
  return text.length > MAX_TASK_LENGTH ? `${text.slice(0, MAX_TASK_LENGTH - 1).trimEnd()}…` : text;
}

export function topSites(sites: readonly FrequentSite[], count = MAX_SHOWN_SITES): FrequentSite[] {
  return [...sites].sort(byUse).slice(0, count);
}

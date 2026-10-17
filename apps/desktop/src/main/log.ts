/**
 * Logs técnicos sin contenido de navegación (S12): solo eventos, códigos,
 * latencias y cantidades. Nunca URLs, etiquetas, intenciones ni valores.
 */
type Field = number | boolean | null | undefined | `code:${string}` | `phase:${string}` | `kind:${string}`;

export function log(event: string, fields: Record<string, Field> = {}): void {
  const safe: Record<string, number | boolean | string | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    safe[key] = typeof value === 'string' ? value.slice(0, 60) : value;
  }
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...safe }));
}

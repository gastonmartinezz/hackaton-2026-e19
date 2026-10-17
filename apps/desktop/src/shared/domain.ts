/**
 * Divide un dominio para la barra: el subdominio va en muted y el dominio
 * principal en negrita, que nunca se corta (CLAUDE.md §3.1). Sin lista de
 * sufijos públicos: cubre los sufijos de segundo nivel habituales en Uruguay y
 * Argentina (gub.uy, com.ar, gob.ar…) con una regla de longitud.
 */
export function splitDomain(hostname: string): { sub: string; main: string } {
  const host = hostname.replace(/\.$/, '');
  if (!host || /^[\d.]+$/.test(host) || host.startsWith('[') || !host.includes('.')) return { sub: '', main: host };
  const labels = host.split('.');
  const tld = labels.at(-1)!;
  const second = labels.at(-2)!;
  // «gub.uy», «com.ar», «co.uk»: el dominio principal toma una etiqueta más.
  const take = tld.length === 2 && second.length <= 3 && labels.length > 2 ? 3 : 2;
  const main = labels.slice(-take).join('.');
  const sub = labels.length > take ? `${labels.slice(0, -take).join('.')}.` : '';
  return { sub, main };
}

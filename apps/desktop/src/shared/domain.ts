/**
 * Divide un dominio para la barra: el subdominio va en muted y el dominio
 * principal en negrita, que nunca se corta (CLAUDE.md §3.1). Sin lista de
 * sufijos públicos completa: solo los sufijos de segundo nivel conocidos
 * (gub.uy, com.uy, edu.uy…). La negrita es una señal de confianza, así que
 * ante la duda se resalta menos: «paypal.t.co» resalta «t.co», no «paypal».
 */
const SECOND_LEVEL = new Set(['com', 'net', 'org', 'edu', 'gob', 'gub', 'gov', 'mil', 'int', 'co', 'ac', 'nom', 'ltd', 'plc']);

export function splitDomain(hostname: string): { sub: string; main: string } {
  const host = hostname.replace(/\.$/, '');
  if (!host || /^[\d.]+$/.test(host) || host.startsWith('[') || !host.includes('.')) return { sub: '', main: host };
  const labels = host.split('.');
  const tld = labels.at(-1)!;
  const second = labels.at(-2)!;
  // «gub.uy», «com.uy», «co.uk»: el dominio principal toma una etiqueta más.
  const take = tld.length === 2 && SECOND_LEVEL.has(second) && labels.length > 2 ? 3 : 2;
  const main = labels.slice(-take).join('.');
  const sub = labels.length > take ? `${labels.slice(0, -take).join('.')}.` : '';
  return { sub, main };
}

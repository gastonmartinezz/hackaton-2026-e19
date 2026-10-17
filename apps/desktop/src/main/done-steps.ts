/**
 * «Ya hiciste» (pantallas 06 a 08): convierte la instrucción de un paso hecho a
 * pasado. Las instrucciones vienen con voseo y un verbo al principio
 * («Hacé clic en «Sacar turno».» → «Hiciste clic en «Sacar turno»»). Si no
 * empieza con un verbo conocido, se muestra como vino, sin el punto final.
 */
const IRREGULAR: Record<string, string> = {
  hacé: 'hiciste',
  poné: 'pusiste',
  andá: 'fuiste',
  ve: 'fuiste',
  decí: 'dijiste',
  tené: 'tuviste',
  traé: 'trajiste',
  desplazate: 'te desplazaste',
  fijate: 'te fijaste',
};

export function pastTense(instruction: string): string {
  const text = instruction.trim().replace(/[.。]+$/, '');
  const match = /^(\p{L}+)(.*)$/su.exec(text);
  if (!match) return text;
  const [, verb = '', rest = ''] = match;
  const past = toPast(verb.toLowerCase());
  if (!past) return text;
  return `${past.charAt(0).toUpperCase()}${past.slice(1)}${rest}`;
}

function toPast(verb: string): string | null {
  if (IRREGULAR[verb]) return IRREGULAR[verb];
  // Imperativo de voseo: tocá → tocaste, elegí → elegiste, poné → pusiste (irregular).
  if (verb.length > 2 && verb.endsWith('á')) return `${verb.slice(0, -1)}aste`;
  if (verb.length > 2 && (verb.endsWith('é') || verb.endsWith('í'))) return `${verb.slice(0, -1)}iste`;
  return null;
}

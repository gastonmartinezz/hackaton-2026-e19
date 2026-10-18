/**
 * Respuesta por voz: compara lo que dijo la persona con las opciones visibles,
 * en el cliente y sin llamar a Claude. Función pura.
 *
 * Reconoce, en este orden:
 * 1. «otras» / «ver otras» / «más opciones» → la opción `more`;
 *    «no sé» / «no estoy seguro» → la opción `unsure`;
 *    «sí» / «dale» / «está bien» al principio → la opción `yes`.
 * 2. Números y ordinales: «la primera», «la 2», «opción dos», «la última»,
 *    en el mismo orden en que se leyeron las opciones (incluidas «No estoy
 *    seguro» y «Ver otras opciones» si se leyeron; las que no se leyeron
 *    llevan `unnumbered`).
 * 3. El título completo de una opción dentro de lo dicho.
 * 4. Palabras en común con el título (o sus alias); gana la de mayor
 *    proporción si es clara. Si hay empate → `tie`; si nada alcanza → `none`.
 */

export interface ChoiceSpec {
  /** El nombre visible del botón. */
  label: string;
  /** Otras formas de nombrarlo (por ejemplo, el título del sitio). */
  aliases?: string[];
  /** `more`: «Ver otras opciones»; `unsure`: «No sé bien»; `yes`: la respuesta afirmativa («Está bien»). */
  kind?: 'more' | 'unsure' | 'yes';
  /** No se nombró al leer la lista: se puede elegir por su nombre, pero no cuenta para «la tercera». */
  unnumbered?: boolean;
}

export type ChoiceMatch = { kind: 'match'; index: number } | { kind: 'tie' } | { kind: 'none' };

/** Minúsculas, sin tildes ni signos, espacios simples. */
export function normalizeSpoken(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const STOPWORDS = new Set(
  'a al con de del el en es esa ese eso esta este la las lo los me mi o opcion para por porfa favor que quiero se si un una uno unos y ya dale bueno elijo la el voy ir'.split(' '),
);

/** Palabras que cuentan para comparar títulos. */
function words(text: string): string[] {
  return normalizeSpoken(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

const ORDINALS: Array<[RegExp, number]> = [
  [/\b(primera|primero|1)\b/, 0],
  [/\b(segunda|segundo|2)\b/, 1],
  [/\b(tercera|tercero|3)\b/, 2],
  [/\b(cuarta|cuarto|4)\b/, 3],
  [/\b(quinta|quinto|5)\b/, 4],
];
/** Números en palabras: solo cuentan como ordinal en frases cortas («la dos», «opción tres»). */
const SPOKEN_NUMBERS: Array<[RegExp, number]> = [
  [/\b(uno|una)\b/, 0],
  [/\b(dos)\b/, 1],
  [/\b(tres)\b/, 2],
  [/\b(cuatro)\b/, 3],
  [/\b(cinco)\b/, 4],
];

const MORE = /\b(otras|otra opcion|otras opciones|mas opciones|ver otras|ver mas)\b/;
const UNSURE = /\b(no se|no estoy segur[oa]|ni idea|no sabria)\b/;
const YES = /^(si|claro|dale|correcto|esta bien|ok|okey|bien|listo)\b/;

/** Índice por ordinal o número dicho, en el orden en que se leyeron («la última» es la última que se escuchó). */
function ordinalIndex(spoken: string, choices: ChoiceSpec[]): number | null {
  const numbered = choices.map((c, i) => ({ c, i })).filter(({ c }) => !c.unnumbered);
  if (numbered.length === 0) return null;
  if (/\b(ultima|ultimo)\b/.test(spoken)) return numbered.at(-1)!.i;
  const tokens = spoken.split(' ').length;
  const table = tokens <= 3 ? [...ORDINALS, ...SPOKEN_NUMBERS] : ORDINALS;
  const found = table.filter(([pattern]) => pattern.test(spoken)).map(([, n]) => n);
  const unique = [...new Set(found)];
  if (unique.length !== 1) return null;
  return numbered[unique[0]!]?.i ?? null;
}

export function matchChoice(said: string, choices: ChoiceSpec[]): ChoiceMatch {
  const spoken = normalizeSpoken(said);
  if (!spoken || choices.length === 0) return { kind: 'none' };

  // 1. Las opciones especiales.
  const special = (kind: 'more' | 'unsure' | 'yes') => choices.findIndex((c) => c.kind === kind);
  if (UNSURE.test(spoken) && special('unsure') >= 0) return { kind: 'match', index: special('unsure') };
  if (YES.test(spoken) && special('yes') >= 0) return { kind: 'match', index: special('yes') };
  if (MORE.test(spoken) && special('more') >= 0) return { kind: 'match', index: special('more') };

  // 2. Título completo dicho tal cual (el más largo gana: «Solo abrir el sitio» antes que «abrir»).
  const full = choices
    .map((c, index) => ({ index, names: [c.label, ...(c.aliases ?? [])].map(normalizeSpoken).filter((n) => n.length > 2) }))
    .flatMap(({ index, names }) => names.filter((n) => ` ${spoken} `.includes(` ${n} `)).map((n) => ({ index, length: n.length })))
    .sort((a, b) => b.length - a.length);
  if (full.length > 0 && (full.length === 1 || full[0]!.length > full[1]!.length || full[0]!.index === full[1]!.index)) {
    return { kind: 'match', index: full[0]!.index };
  }

  // 3. Ordinales y números.
  const ordinal = ordinalIndex(spoken, choices);
  if (ordinal !== null) return { kind: 'match', index: ordinal };

  // 4. Palabras en común con el título o sus alias.
  const saidWords = new Set(words(spoken));
  if (saidWords.size === 0) return { kind: 'none' };
  const scores = choices.map((c) =>
    Math.max(
      ...[c.label, ...(c.aliases ?? [])].map((name) => {
        const titleWords = words(name);
        if (titleWords.length === 0) return 0;
        return titleWords.filter((w) => saidWords.has(w)).length / titleWords.length;
      }),
    ),
  );
  const best = Math.max(...scores);
  if (best < 0.5) return { kind: 'none' };
  const winners = scores.flatMap((score, index) => (score === best ? [index] : []));
  return winners.length === 1 ? { kind: 'match', index: winners[0]! } : { kind: 'tie' };
}

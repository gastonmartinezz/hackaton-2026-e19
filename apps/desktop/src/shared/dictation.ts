/**
 * Lo que la persona dictó para un dato de un formulario, adaptado al tipo de
 * lugar donde se escribe. Funciones puras: corren en el preload de la página,
 * sin red y sin Claude. El valor nunca se guarda ni se registra.
 */

/** Tipos de lugar donde Guíame puede escribir lo dictado. */
export const DICTATABLE_TYPES: ReadonlySet<string> = new Set(['text', 'email', 'tel', 'number', 'search', 'url', 'date', 'textarea']);

const SPOKEN_DIGITS: Record<string, string> = {
  cero: '0',
  uno: '1',
  una: '1',
  dos: '2',
  tres: '3',
  cuatro: '4',
  cinco: '5',
  seis: '6',
  siete: '7',
  ocho: '8',
  nueve: '9',
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Minúsculas, sin tildes ni signos, espacios simples. */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Sin el punto final ni las comillas que suele agregar la transcripción. */
function clean(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'«“]+|["'»”]+$/g, '')
    .replace(/[.。!?¡¿,;:]+$/u, '')
    .trim();
}

/** «cero nueve nueve» → «099»; deja los números escritos como están. */
function spokenDigits(text: string): string {
  return plain(text)
    .split(' ')
    .map((word) => SPOKEN_DIGITS[word] ?? word)
    .join(' ');
}

function email(text: string): string {
  return plain(text.replace(/@/g, ' arroba ').replace(/\./g, ' punto ').replace(/_/g, ' guion bajo ').replace(/-/g, ' guion '))
    .replace(/\barroba\b/g, '@')
    .replace(/\bpunto\b/g, '.')
    .replace(/\bguion bajo\b/g, '_')
    .replace(/\bguion( medio)?\b/g, '-')
    .replace(/\s+/g, '')
    // «…punto com punto» al final (o al principio) no forma parte de la dirección.
    .replace(/^[.\-_]+|[.\-_]+$/g, '');
}

function phone(text: string): string | null {
  const plus = /^\s*(\+|mas\b)/.test(plain(text)) || text.trim().startsWith('+');
  const digits = spokenDigits(text).replace(/\D/g, '');
  return digits ? `${plus ? '+' : ''}${digits}` : null;
}

function number(text: string): string | null {
  const value = spokenDigits(text.replace(/(\d)[.\s](?=\d{3}\b)/g, '$1')).replace(/(\d) coma (\d)/g, '$1.$2');
  const match = value.replace(/,/g, '.').match(/-?\d+(\.\d+)?/);
  return match ? match[0] : null;
}

/** «3 de mayo de 1950», «03/05/1950» o «3-5-1950» → «1950-05-03» (formato de `input type=date`). */
function date(text: string): string | null {
  const said = spokenDigits(text);
  const pad = (n: number) => String(n).padStart(2, '0');
  const valid = (d: number, m: number, y: number) => {
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= last ? `${y}-${pad(m)}-${pad(d)}` : null;
  };
  const numeric = text.match(/\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})\b/);
  if (numeric) return valid(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));
  const words = said.match(/\b(\d{1,2}) de (\w+)(?: (?:de|del) )?(\d{4})\b/);
  if (words) {
    const month = MONTHS.indexOf(words[2]!) + 1;
    return month > 0 ? valid(Number(words[1]), month, Number(words[3])) : null;
  }
  return null;
}

/**
 * Valor listo para escribir según el tipo de lugar, o null si lo dicho no
 * sirve para ese tipo (por ejemplo, una fecha que no se entiende).
 */
export function dictatedValue(said: string, inputType: string): string | null {
  const text = clean(said);
  if (!text) return null;
  switch (inputType) {
    case 'email':
      return email(text) || null;
    case 'tel':
      return phone(text);
    case 'number':
      return number(text);
    case 'date':
      return date(text);
    case 'url':
      return text.replace(/\s+/g, '');
    default:
      return text;
  }
}

/**
 * Opción de una lista que corresponde a lo dicho: igual, contenida en lo dicho
 * (la más larga) o con más palabras en común. null si no hay una clara.
 */
export function matchListOption(said: string, options: readonly string[]): number | null {
  const spoken = plain(clean(said));
  if (!spoken) return null;
  const names = options.map(plain);
  const exact = names.findIndex((name) => name === spoken);
  if (exact >= 0) return exact;
  const contained = names
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => name.length > 1 && ` ${spoken} `.includes(` ${name} `))
    .sort((a, b) => b.name.length - a.name.length);
  if (contained.length > 0 && (contained.length === 1 || contained[0]!.name.length > contained[1]!.name.length)) return contained[0]!.index;
  const saidWords = new Set(spoken.split(' ').filter((w) => w.length > 2));
  if (saidWords.size === 0) return null;
  const scores = names.map((name) => {
    const words = name.split(' ').filter((w) => w.length > 2);
    return words.length === 0 ? 0 : words.filter((w) => saidWords.has(w)).length / words.length;
  });
  const best = Math.max(...scores);
  if (best < 0.5) return null;
  const winners = scores.flatMap((score, index) => (score === best ? [index] : []));
  return winners.length === 1 ? winners[0]! : null;
}

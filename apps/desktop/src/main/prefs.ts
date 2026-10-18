/**
 * Preferencias locales en un JSON versionado dentro de userData. Sin secretos.
 * También guarda los datos de la pantalla inicial: solo salen del equipo
 * dentro de /v1/interpret (ver user-context.ts). Y los sitios que la persona
 * abre más seguido (frequent-sites.ts), que nunca salen del equipo.
 * Un archivo corrupto o de otra versión vuelve a los valores por defecto; uno
 * que no se pudo leer (permisos, disco) no se pisa.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AgeRange, CountryCode } from '@hackaton/contracts';
import { z } from 'zod';
import { DEFAULT_TEXT_SCALE, TEXT_SCALES, VOICE_MODES } from '../shared/ipc';
import { FrequentSiteSchema, MAX_STORED_SITES } from './frequent-sites';

/** Lo que la persona cuenta de sí misma en la pantalla inicial. Todo opcional. */
const ProfileSchema = z.object({
  country: CountryCode.nullable().default(null),
  region: z.string().max(80).default(''),
  city: z.string().max(80).default(''),
  ageRange: AgeRange.nullable().default(null),
});
export type Profile = z.infer<typeof ProfileSchema>;

const PrefsSchema = z.object({
  version: z.literal(1),
  /** Las escalas anteriores (1, 1.25, 1.5) pasan a la permitida más cercana. */
  textScale: z.preprocess(nearestScale, z.union(TEXT_SCALES.map((s) => z.literal(s)))).default(DEFAULT_TEXT_SCALE),
  /** Orígenes en los que la persona desactivó la ayuda con IA. */
  aiDisabledOrigins: z.array(z.string().max(200)).max(500).default([]),
  /** Versión de las condiciones de uso aceptadas; null si nunca las aceptó. */
  termsAccepted: z.string().max(40).nullable().default(null),
  profile: ProfileSchema.default({ country: null, region: '', city: '', ageRange: null }),
  /** Modo voz: `auto` (se prende al dictar), `on` u `off`. Un valor desconocido vuelve a `auto`. */
  voiceMode: z.enum(VOICE_MODES).catch('auto').default('auto'),
  /** Sitios que más abre, para el inicio. Una lista dañada se descarta sin perder lo demás. */
  frequentSites: z.array(FrequentSiteSchema).max(MAX_STORED_SITES).catch([]).default([]),
});
export type Prefs = z.infer<typeof PrefsSchema>;
type PrefsPatch = Partial<Omit<Prefs, 'version'>>;

export const DEFAULT_PREFS: Prefs = {
  version: 1,
  textScale: DEFAULT_TEXT_SCALE,
  aiDisabledOrigins: [],
  termsAccepted: null,
  profile: { country: null, region: '', city: '', ageRange: null },
  voiceMode: 'auto',
  frequentSites: [],
};

function nearestScale(value: unknown): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  return TEXT_SCALES.reduce((best, scale) => (Math.abs(scale - value) < Math.abs(best - value) ? scale : best));
}

export class PrefsStore {
  #prefs: Prefs = DEFAULT_PREFS;
  #writing: Promise<void> = Promise.resolve();
  /** El archivo existe pero no se pudo leer: no se escribe hasta poder leerlo. */
  #unreadable = false;
  /** Cambios de esta sesión mientras el archivo no se pudo leer. */
  #pending: PrefsPatch = {};
  readonly #file: string;

  constructor(directory: string) {
    this.#file = join(directory, 'preferences.json');
  }

  get value(): Prefs {
    return this.#prefs;
  }

  async load(): Promise<Prefs> {
    try {
      this.#prefs = (await this.#read()) ?? DEFAULT_PREFS;
      this.#unreadable = false;
    } catch {
      this.#prefs = DEFAULT_PREFS;
      this.#unreadable = true;
    }
    return this.#prefs;
  }

  /** null si el archivo no existe o está corrupto; lanza si no se pudo leer (permisos, disco). */
  async #read(): Promise<Prefs | null> {
    let raw: string;
    try {
      raw = await readFile(this.#file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      const parsed = PrefsSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Todo o nada: `value` cambia recién cuando el archivo quedó guardado. Si la
   * escritura falla, el cambio no se aplica (ni en memoria ni en el próximo
   * guardado) y el error lo recibe solo quien lo pidió. `patch` puede ser una
   * función del valor guardado hasta ese momento, para cambios que dependen
   * del anterior.
   *
   * Excepción: si al arrancar el archivo no se pudo leer, los cambios de la
   * sesión se aplican en memoria igual (para que la app se pueda usar) y se
   * guardan recién cuando se pueda volver a leer, sin pisar lo que ya había.
   */
  update(patch: PrefsPatch | ((current: Prefs) => PrefsPatch)): Promise<void> {
    // Escrituras en serie y atómicas (archivo temporal + rename). Un fallo
    // anterior no debe frenar las siguientes: cada una parte de lo último guardado.
    const write = this.#writing
      .catch(() => undefined)
      .then(async () => {
        const change = typeof patch === 'function' ? patch(this.#prefs) : patch;
        if (this.#unreadable) {
          this.#pending = { ...this.#pending, ...change };
          this.#prefs = PrefsSchema.parse({ ...this.#prefs, ...change });
          // Se vuelve a leer antes de escribir: los valores por defecto no deben pisar
          // las condiciones aceptadas ni los datos guardados. Si sigue sin leerse, no se escribe.
          const saved = (await this.#read()) ?? DEFAULT_PREFS;
          const next = PrefsSchema.parse({ ...saved, ...this.#pending });
          await this.#persist(next);
          this.#prefs = next;
          this.#unreadable = false;
          this.#pending = {};
          return;
        }
        const next = PrefsSchema.parse({ ...this.#prefs, ...change });
        await this.#persist(next);
        this.#prefs = next;
      });
    this.#writing = write;
    return write;
  }

  async #persist(next: Prefs): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true });
    const tmp = `${this.#file}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
    await rename(tmp, this.#file);
  }

  isAiEnabled(origin: string | null): boolean {
    return origin === null || !this.#prefs.aiDisabledOrigins.includes(origin);
  }

  setAiEnabled(origin: string, enabled: boolean): Promise<void> {
    return this.update((current) => {
      const rest = current.aiDisabledOrigins.filter((o) => o !== origin);
      return { aiDisabledOrigins: enabled ? rest : [...rest, origin] };
    });
  }
}

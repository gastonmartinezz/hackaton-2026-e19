/**
 * Preferencias locales en un JSON versionado dentro de userData. Sin secretos.
 * También guarda los datos de la pantalla inicial: solo salen del equipo
 * dentro de /v1/interpret (ver user-context.ts).
 * Un archivo corrupto o de otra versión vuelve a los valores por defecto.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AgeRange, CountryCode } from '@hackaton/contracts';
import { z } from 'zod';
import { TEXT_SCALES } from '../shared/ipc';

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
  textScale: z.union(TEXT_SCALES.map((s) => z.literal(s))).default(1),
  /** Orígenes en los que la persona desactivó la ayuda con IA. */
  aiDisabledOrigins: z.array(z.string().max(200)).max(500).default([]),
  /** Versión de las condiciones de uso aceptadas; null si nunca las aceptó. */
  termsAccepted: z.string().max(40).nullable().default(null),
  profile: ProfileSchema.default({ country: null, region: '', city: '', ageRange: null }),
});
export type Prefs = z.infer<typeof PrefsSchema>;

export const DEFAULT_PREFS: Prefs = {
  version: 1,
  textScale: 1,
  aiDisabledOrigins: [],
  termsAccepted: null,
  profile: { country: null, region: '', city: '', ageRange: null },
};

export class PrefsStore {
  #prefs: Prefs = DEFAULT_PREFS;
  #writing: Promise<void> = Promise.resolve();
  readonly #file: string;

  constructor(directory: string) {
    this.#file = join(directory, 'preferences.json');
  }

  get value(): Prefs {
    return this.#prefs;
  }

  async load(): Promise<Prefs> {
    try {
      const parsed = PrefsSchema.safeParse(JSON.parse(await readFile(this.#file, 'utf8')));
      this.#prefs = parsed.success ? parsed.data : DEFAULT_PREFS;
    } catch {
      this.#prefs = DEFAULT_PREFS;
    }
    return this.#prefs;
  }

  update(patch: Partial<Omit<Prefs, 'version'>>): Promise<void> {
    this.#prefs = PrefsSchema.parse({ ...this.#prefs, ...patch });
    const snapshot = JSON.stringify(this.#prefs, null, 2);
    // Escrituras en serie y atómicas (archivo temporal + rename). Un fallo
    // anterior no debe frenar las siguientes: solo lo recibe quien lo causó.
    this.#writing = this.#writing.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.#file), { recursive: true });
      const tmp = `${this.#file}.tmp`;
      await writeFile(tmp, snapshot, 'utf8');
      await rename(tmp, this.#file);
    });
    return this.#writing;
  }

  isAiEnabled(origin: string | null): boolean {
    return origin === null || !this.#prefs.aiDisabledOrigins.includes(origin);
  }

  setAiEnabled(origin: string, enabled: boolean): Promise<void> {
    const rest = this.#prefs.aiDisabledOrigins.filter((o) => o !== origin);
    return this.update({ aiDisabledOrigins: enabled ? rest : [...rest, origin] });
  }
}

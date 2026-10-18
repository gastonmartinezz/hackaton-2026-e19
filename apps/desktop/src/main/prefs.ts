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
import { DEFAULT_TEXT_SCALE, TEXT_SCALES, VOICE_MODES } from '../shared/ipc';

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
});
export type Prefs = z.infer<typeof PrefsSchema>;

export const DEFAULT_PREFS: Prefs = {
  version: 1,
  textScale: DEFAULT_TEXT_SCALE,
  aiDisabledOrigins: [],
  termsAccepted: null,
  profile: { country: null, region: '', city: '', ageRange: null },
  voiceMode: 'auto',
};

function nearestScale(value: unknown): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  return TEXT_SCALES.reduce((best, scale) => (Math.abs(scale - value) < Math.abs(best - value) ? scale : best));
}

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

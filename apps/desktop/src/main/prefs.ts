/**
 * Preferencias locales en un JSON versionado dentro de userData. Sin secretos.
 * Un archivo corrupto o de otra versión vuelve a los valores por defecto.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_TEXT_SCALE, TEXT_SCALES } from '../shared/ipc';

const PrefsSchema = z.object({
  version: z.literal(1),
  /** Las escalas anteriores (1, 1.25, 1.5) pasan a la permitida más cercana. */
  textScale: z.preprocess(nearestScale, z.union(TEXT_SCALES.map((s) => z.literal(s)))).default(DEFAULT_TEXT_SCALE),
  /** Orígenes en los que la persona desactivó la ayuda con IA. */
  aiDisabledOrigins: z.array(z.string().max(200)).max(500).default([]),
});
export type Prefs = z.infer<typeof PrefsSchema>;

export const DEFAULT_PREFS: Prefs = { version: 1, textScale: DEFAULT_TEXT_SCALE, aiDisabledOrigins: [] };

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

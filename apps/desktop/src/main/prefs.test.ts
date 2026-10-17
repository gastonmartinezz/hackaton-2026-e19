import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrefsStore } from './prefs';

describe('PrefsStore', () => {
  it('una escritura fallida no frena las siguientes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prefs-'));
    const dir = join(root, 'userData');
    // Un archivo donde debería ir el directorio hace fallar la primera escritura.
    await writeFile(dir, 'x');
    const store = new PrefsStore(dir);
    await expect(store.update({ textScale: 1.45 })).rejects.toThrow();

    await rm(dir);
    await store.setAiEnabled('https://a.gob.ar', false);
    const saved = JSON.parse(await readFile(join(dir, 'preferences.json'), 'utf8'));
    expect(saved).toMatchObject({ textScale: 1.45, aiDisabledOrigins: ['https://a.gob.ar'] });
    await rm(root, { recursive: true });
  });
});

describe('PrefsStore · escala de letra', () => {
  it('lleva las escalas viejas a la permitida más cercana', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prefs-'));
    await writeFile(join(dir, 'preferences.json'), JSON.stringify({ version: 1, textScale: 1.5, aiDisabledOrigins: [] }));
    const store = new PrefsStore(dir);
    expect((await store.load()).textScale).toBe(1.45);
    await writeFile(join(dir, 'preferences.json'), JSON.stringify({ version: 1, textScale: 1, aiDisabledOrigins: [] }));
    expect((await store.load()).textScale).toBe(1.2);
    await rm(dir, { recursive: true });
  });
});

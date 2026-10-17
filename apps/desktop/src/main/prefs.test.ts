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
    await expect(store.update({ textScale: 1.5 })).rejects.toThrow();

    await rm(dir);
    await store.setAiEnabled('https://a.gob.ar', false);
    const saved = JSON.parse(await readFile(join(dir, 'preferences.json'), 'utf8'));
    expect(saved).toMatchObject({ textScale: 1.5, aiDisabledOrigins: ['https://a.gob.ar'] });
    await rm(root, { recursive: true });
  });
});

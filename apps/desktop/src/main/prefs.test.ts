import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    await store.setAiEnabled('https://a.gub.uy', false);
    const saved = JSON.parse(await readFile(join(dir, 'preferences.json'), 'utf8'));
    expect(saved).toMatchObject({ textScale: 1.45, aiDisabledOrigins: ['https://a.gub.uy'] });
    await rm(root, { recursive: true });
  });

  it('un archivo anterior a la pantalla inicial conserva sus datos y pide las condiciones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prefs-'));
    await writeFile(join(dir, 'preferences.json'), JSON.stringify({ version: 1, textScale: 1.25, aiDisabledOrigins: [] }));
    const prefs = await new PrefsStore(dir).load();
    expect(prefs).toMatchObject({ textScale: 1.2, termsAccepted: null, profile: { country: null, city: '', ageRange: null } });
    await rm(dir, { recursive: true });
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

  it('si el archivo no se pudo leer al arrancar, no lo pisa con los valores por defecto', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prefs-'));
    const file = join(dir, 'preferences.json');
    // Un directorio en lugar del archivo hace fallar la lectura sin que sea ENOENT.
    await mkdir(file);
    const store = new PrefsStore(dir);
    expect((await store.load()).termsAccepted).toBeNull();
    await expect(store.update({ textScale: 1.75 })).rejects.toThrow();

    // El archivo vuelve a poder leerse: la escritura siguiente conserva lo guardado.
    await rm(file, { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1, termsAccepted: '2026-10-17', profile: { city: 'Salto' } }));
    await store.setAiEnabled('https://a.gub.uy', false);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved).toMatchObject({ termsAccepted: '2026-10-17', profile: { city: 'Salto' }, textScale: 1.75, aiDisabledOrigins: ['https://a.gub.uy'] });
    expect(store.value.termsAccepted).toBe('2026-10-17');
    await rm(dir, { recursive: true });
  });
});

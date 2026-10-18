import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrefsStore } from './prefs';
import { VoiceModeState } from './voice-mode';

describe('VoiceModeState', () => {
  it('auto (por defecto): se prende al buscar dictando, para ese recorrido', () => {
    const mode = new VoiceModeState('auto');
    expect(mode.active).toBe(false);
    expect(mode.dictated()).toBe(true);
    expect(mode.active).toBe(true);
    expect(mode.dictated()).toBe(false); // ya estaba prendido: no cambia
    mode.newJourney(); // Inicio
    expect(mode.active).toBe(false);
    expect(mode.preference).toBe('auto');
  });

  it('off: dictar no lo prende', () => {
    const mode = new VoiceModeState('off');
    expect(mode.dictated()).toBe(false);
    expect(mode.active).toBe(false);
  });

  it('on: siempre prendido, también después de Inicio', () => {
    const mode = new VoiceModeState('on');
    expect(mode.active).toBe(true);
    mode.newJourney();
    expect(mode.active).toBe(true);
  });

  it('el interruptor deja la preferencia en on u off', () => {
    const mode = new VoiceModeState('auto');
    mode.dictated();
    mode.set('off');
    expect([mode.preference, mode.active]).toEqual(['off', false]);
    expect(mode.dictated()).toBe(false);
    mode.set('on');
    expect([mode.preference, mode.active]).toEqual(['on', true]);
  });
});

describe('PrefsStore · modo voz', () => {
  it('por defecto es auto, se guarda y se recupera; un valor desconocido vuelve a auto', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prefs-'));
    const store = new PrefsStore(dir);
    expect((await store.load()).voiceMode).toBe('auto');
    await store.update({ voiceMode: 'on' });
    expect(JSON.parse(await readFile(join(dir, 'preferences.json'), 'utf8')).voiceMode).toBe('on');
    expect((await new PrefsStore(dir).load()).voiceMode).toBe('on');
    await writeFile(join(dir, 'preferences.json'), JSON.stringify({ version: 1, textScale: 1.2, voiceMode: 'siempre' }));
    const fallback = await new PrefsStore(dir).load();
    expect(fallback.voiceMode).toBe('auto');
    expect(fallback.textScale).toBe(1.2);
    await rm(dir, { recursive: true });
  });

  it('un archivo anterior al modo voz queda en auto sin perder lo demás', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prefs-'));
    await writeFile(join(dir, 'preferences.json'), JSON.stringify({ version: 1, textScale: 1.45, aiDisabledOrigins: [], termsAccepted: 'x' }));
    expect(await new PrefsStore(dir).load()).toMatchObject({ voiceMode: 'auto', textScale: 1.45, termsAccepted: 'x' });
    await rm(dir, { recursive: true });
  });
});

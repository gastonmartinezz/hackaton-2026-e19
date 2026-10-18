import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { UiCommandSchema } from '../shared/ipc';
import { PrefsStore } from './prefs';
import { changeVoiceMode, isDictatedSearch, VoiceModeState } from './voice-mode';

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

describe('changeVoiceMode: primero se guarda, después se aplica', () => {
  const effects = () => {
    const calls: string[] = [];
    return {
      calls,
      save: vi.fn(async (mode: 'on' | 'off') => void calls.push(`save:${mode}`)),
      stopAll: vi.fn(() => void calls.push('stopAll')),
      publish: vi.fn(() => void calls.push('publish')),
    };
  };

  it('guarda, aplica, corta el audio (al apagar) y publica, en ese orden', async () => {
    const state = new VoiceModeState('on');
    const fx = effects();
    await changeVoiceMode(state, 'off', fx);
    expect(fx.calls).toEqual(['save:off', 'stopAll', 'publish']);
    expect([state.preference, state.active]).toEqual(['off', false]);
  });

  it('si guardar falla, el estado no cambia, no se corta ni se publica, y el error sigue', async () => {
    const state = new VoiceModeState('on');
    const fx = effects();
    fx.save.mockRejectedValueOnce(new Error('disco lleno'));
    await expect(changeVoiceMode(state, 'off', fx)).rejects.toThrow('disco lleno');
    expect([state.preference, state.active]).toEqual(['on', true]);
    expect(fx.stopAll).not.toHaveBeenCalled();
    expect(fx.publish).not.toHaveBeenCalled();
  });
});

describe('isDictatedSearch: solo una búsqueda dictada que se envió prende el modo', () => {
  it('dictada con texto → sí; escrita, en blanco u otro comando → no', () => {
    expect(isDictatedSearch({ type: 'submitIntent', text: 'renovar la cédula', guide: true, dictated: true })).toBe(true);
    expect(isDictatedSearch({ type: 'submitIntent', text: 'renovar la cédula', guide: true })).toBe(false);
    expect(isDictatedSearch({ type: 'submitIntent', text: '   ', dictated: true })).toBe(false);
    expect(isDictatedSearch({ type: 'search', text: 'x' })).toBe(false);
  });

  it('el contrato IPC acepta `dictated: true` y rechaza otros valores', () => {
    expect(UiCommandSchema.safeParse({ type: 'submitIntent', text: 'hola', guide: true, dictated: true }).success).toBe(true);
    expect(UiCommandSchema.safeParse({ type: 'submitIntent', text: 'hola', dictated: false }).success).toBe(false);
  });

  it('una transcripción sola (sin búsqueda enviada) no prende el modo', () => {
    // El proceso principal ya no lo prende al transcribir: solo al recibir la búsqueda dictada.
    const state = new VoiceModeState('auto');
    expect(state.active).toBe(false);
    if (isDictatedSearch({ type: 'submitIntent', text: 'hola', dictated: true })) state.dictated();
    expect(state.active).toBe(true);
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

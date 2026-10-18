// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeakResult } from '../../../shared/ipc';
import { pickSpanishVoice, type Playback } from './playback';
import { SpeakButton } from './SpeakButton';
import { SPEECH_TEXTS } from './speechText';
import { speechSource, type ReadAloudDeps } from './useReadAloud';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  speechSource.mode = 'server';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));
const button = () => container.querySelector<HTMLButtonElement>('button.speak-btn');
const click = () => act(async () => button()!.click());
const flush = () => act(async () => {});

/** Reproducción simulada que se puede terminar desde el test. */
function fakePlayback() {
  let finish: (r: 'ended' | 'failed' | 'stopped') => void = () => {};
  const playback: Playback & { stop: ReturnType<typeof vi.fn> } = {
    done: new Promise((resolve) => (finish = resolve)),
    stop: vi.fn(() => finish('stopped')),
  };
  return { playback, end: (r: 'ended' | 'failed' = 'ended') => finish(r) };
}

function fakeDeps(result: SpeakResult = { status: 'ok', audio: new Uint8Array([1]) }) {
  const mp3 = fakePlayback();
  const system = fakePlayback();
  /** Lo que haría el proceso principal al avisar «cortá» a esta vista. */
  const cutListeners = new Set<() => void>();
  const deps = {
    speak: vi.fn(async () => result),
    stopSpeaking: vi.fn(),
    onCut: vi.fn((listener: () => void) => {
      cutListeners.add(listener);
      return () => cutListeners.delete(listener);
    }),
    playMp3: vi.fn(() => mp3.playback),
    systemSpeak: vi.fn(async (): Promise<Playback | null> => system.playback),
  } satisfies ReadAloudDeps;
  const cutFromMain = () => act(async () => cutListeners.forEach((l) => l()));
  return { deps, mp3, system, cutFromMain, cutListeners };
}

describe('SpeakButton', () => {
  it('en reposo dice «Escuchar»; no suena solo', async () => {
    const { deps } = fakeDeps();
    render(<SpeakButton text="Hacé clic en «Sacar turno»." deps={deps} />);
    await flush();
    expect(button()!.textContent).toBe(SPEECH_TEXTS.listen);
    expect(deps.speak).not.toHaveBeenCalled();
  });

  it('al tocarlo lee el texto; mientras suena dice «Detener» y lo detiene sin mover el foco', async () => {
    const { deps, mp3 } = fakeDeps();
    render(<SpeakButton text="Hacé clic en «Sacar turno»." deps={deps} />);
    button()!.focus();
    await click();
    expect(deps.speak).toHaveBeenCalledWith('Hacé clic en «Sacar turno».');
    expect(button()!.textContent).toBe(SPEECH_TEXTS.stop);
    expect(button()!.dataset.active).toBe('true');
    await click();
    expect(mp3.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent).toBe(SPEECH_TEXTS.listen);
    expect(document.activeElement).toBe(button());
  });

  it('al terminar de sonar vuelve a «Escuchar»', async () => {
    const { deps, mp3 } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await act(async () => mp3.end());
    expect(button()!.textContent).toBe(SPEECH_TEXTS.listen);
  });

  it('al cambiar de instrucción se corta el audio', async () => {
    const { deps, mp3 } = fakeDeps();
    render(<SpeakButton text="Primera instrucción" deps={deps} />);
    await click();
    render(<SpeakButton text="Segunda instrucción" deps={deps} />);
    await flush();
    expect(mp3.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent).toBe(SPEECH_TEXTS.listen);
  });

  it('si cambia la instrucción mientras descarga, se cancela la descarga y no suena', async () => {
    const { deps } = fakeDeps();
    let resolve: (r: SpeakResult) => void = () => {};
    deps.speak.mockImplementationOnce(() => new Promise<SpeakResult>((r) => (resolve = r)));
    render(<SpeakButton text="Primera" deps={deps} />);
    await click();
    render(<SpeakButton text="Segunda" deps={deps} />);
    await flush();
    expect(deps.stopSpeaking).toHaveBeenCalled();
    await act(async () => resolve({ status: 'ok', audio: new Uint8Array([1]) }));
    expect(deps.playMp3).not.toHaveBeenCalled();
  });

  it('al cerrar la tarjeta (desmontar) se corta el audio', async () => {
    const { deps, mp3 } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    act(() => root.render(null));
    expect(mp3.playback.stop).toHaveBeenCalled();
  });

  it('ocupado (retryable): mensaje breve sin culpa, con role="alert"', async () => {
    const { deps } = fakeDeps({ status: 'error', reason: 'busy' });
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(SPEECH_TEXTS.busy);
    expect(button()!.textContent).toBe(SPEECH_TEXTS.listen);
  });

  it('error: «Fue un problema de mi lado, no tuyo»', async () => {
    const { deps } = fakeDeps({ status: 'error', reason: 'failed' });
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Fue un problema de mi lado, no tuyo');
  });

  it('voz apagada en el servidor (off): lee con la voz del sistema y la próxima vez va directo al sistema', async () => {
    const { deps, system } = fakeDeps({ status: 'error', reason: 'off' });
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await flush();
    expect(deps.systemSpeak).toHaveBeenCalledWith('Hola');
    expect(button()!.textContent).toBe(SPEECH_TEXTS.stop);
    await act(async () => system.end());
    expect(speechSource.mode).toBe('system');
    await click();
    await flush();
    expect(deps.speak).toHaveBeenCalledOnce();
    expect(deps.systemSpeak).toHaveBeenCalledTimes(2);
  });

  it('voz apagada y sin voz del sistema en español: el botón se oculta', async () => {
    const { deps } = fakeDeps({ status: 'error', reason: 'off' });
    deps.systemSpeak.mockResolvedValue(null);
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await flush();
    expect(button()).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('«Detener» avisa al proceso principal aunque ya esté sonando (para que corte la otra vista)', async () => {
    const { deps } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    expect(deps.stopSpeaking).not.toHaveBeenCalled();
    await click();
    expect(deps.stopSpeaking).toHaveBeenCalledOnce();
  });

  it('si otra vista empieza a leer, el proceso principal avisa y esta corta y vuelve a «Escuchar»', async () => {
    const { deps, mp3, cutFromMain } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    expect(button()!.textContent).toBe(SPEECH_TEXTS.stop);
    await cutFromMain();
    expect(mp3.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent).toBe(SPEECH_TEXTS.listen);
    // El aviso viene del proceso principal: no se reenvía (sin rebotes).
    expect(deps.stopSpeaking).not.toHaveBeenCalled();
  });

  it('el aviso corta también una descarga en curso: el audio que llega tarde no suena', async () => {
    const { deps, cutFromMain } = fakeDeps();
    let resolve: (r: SpeakResult) => void = () => {};
    deps.speak.mockImplementationOnce(() => new Promise<SpeakResult>((r) => (resolve = r)));
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await cutFromMain();
    await act(async () => resolve({ status: 'ok', audio: new Uint8Array([1]) }));
    expect(deps.playMp3).not.toHaveBeenCalled();
    expect(button()!.textContent).toBe(SPEECH_TEXTS.listen);
  });

  it('con la voz del sistema: avisa al empezar y el aviso de la otra vista la corta', async () => {
    speechSource.mode = 'system';
    const { deps, system, cutFromMain } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await flush();
    expect(deps.speak).not.toHaveBeenCalled();
    expect(deps.stopSpeaking).toHaveBeenCalledOnce();
    expect(button()!.textContent).toBe(SPEECH_TEXTS.stop);
    await cutFromMain();
    expect(system.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent).toBe(SPEECH_TEXTS.listen);
  });

  it('dos botones en la misma vista: empezar uno calla al otro', async () => {
    const a = fakeDeps();
    const b = fakeDeps();
    render(
      <>
        <SpeakButton text="Primero" deps={a.deps} />
        <SpeakButton text="Segundo" deps={b.deps} />
      </>,
    );
    const [first, second] = [...container.querySelectorAll<HTMLButtonElement>('button.speak-btn')];
    await act(async () => first!.click());
    expect(first!.textContent).toBe(SPEECH_TEXTS.stop);
    await act(async () => second!.click());
    expect(a.mp3.playback.stop).toHaveBeenCalled();
    expect(first!.textContent).toBe(SPEECH_TEXTS.listen);
    expect(second!.textContent).toBe(SPEECH_TEXTS.stop);
  });

  it('al desmontar deja de escuchar los avisos', async () => {
    const { deps, cutListeners } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    expect(cutListeners.size).toBe(1);
    act(() => root.render(null));
    expect(cutListeners.size).toBe(0);
  });

  it('sin texto no se muestra', () => {
    render(<SpeakButton text="  " deps={fakeDeps().deps} />);
    expect(button()).toBeNull();
  });
});

describe('pickSpanishVoice', () => {
  const v = (lang: string, localService = true) => ({ lang, localService, name: lang });

  it('prefiere es-UY, después es-AR y después cualquier es-*', () => {
    expect(pickSpanishVoice([v('en-US'), v('es-ES'), v('es-AR'), v('es-UY')])?.lang).toBe('es-UY');
    expect(pickSpanishVoice([v('es-MX'), v('es_AR'), v('fr-FR')])?.lang).toBe('es_AR');
    expect(pickSpanishVoice([v('en-GB'), v('es-MX')])?.lang).toBe('es-MX');
    expect(pickSpanishVoice([v('es')])?.lang).toBe('es');
  });

  it('entre iguales prefiere la voz local; sin español, null', () => {
    expect(pickSpanishVoice([v('es-ES', false), v('es-MX', true)])?.lang).toBe('es-MX');
    expect(pickSpanishVoice([v('en-US'), v('pt-BR'), v('est')])).toBeNull();
  });
});

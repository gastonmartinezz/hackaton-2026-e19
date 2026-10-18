// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeakResult, SpeechAudioEvent } from '../../../shared/ipc';
import { pickSpanishVoice, systemSpeak, systemVoices, type Mp3Stream, type Playback, type SystemSpeechProblem } from './playback';
import { SpeakButton } from './SpeakButton';
import { SPEECH_TEXTS, optionsReadKey } from './speechText';
import { autoRead, speechSource, type ReadAloudDeps } from './useReadAloud';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  speechSource.mode = 'server';
  autoRead.last = '';
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

function fakeDeps(result: SpeakResult = { status: 'ok' }) {
  const mp3 = fakePlayback();
  /** La reproducción progresiva simulada: registra lo que le llega. */
  const stream = { mode: 'progressive' as const, playback: mp3.playback, push: vi.fn(), end: vi.fn(), fail: vi.fn() };
  /** Lo que el proceso principal le manda a esta vista para la última lectura. */
  let onAudio: (event: SpeechAudioEvent) => void = () => {};
  const system = fakePlayback();
  /** Lo que haría el proceso principal al avisar «cortá» a esta vista. */
  const cutListeners = new Set<() => void>();
  const deps = {
    speak: vi.fn(async (_text: string, listener: (event: SpeechAudioEvent) => void) => {
      onAudio = listener;
      return result;
    }),
    stopSpeaking: vi.fn(),
    onCut: vi.fn((listener: () => void) => {
      cutListeners.add(listener);
      return () => cutListeners.delete(listener);
    }),
    openMp3Stream: vi.fn((): Mp3Stream => stream),
    systemSpeak: vi.fn(async (_text: string, _stillWanted: () => boolean): Promise<Playback | SystemSpeechProblem> => system.playback),
    warmUpVoices: vi.fn(),
  } satisfies ReadAloudDeps;
  const cutFromMain = () => act(async () => cutListeners.forEach((l) => l()));
  const audio = (event: SpeechAudioEvent) => act(async () => onAudio(event));
  return { deps, mp3, stream, system, cutFromMain, cutListeners, audio };
}

describe('SpeakButton', () => {
  it('en reposo dice «Escuchar»; no suena solo', async () => {
    const { deps } = fakeDeps();
    render(<SpeakButton text="Hacé clic en «Sacar turno»." deps={deps} />);
    await flush();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
    expect(deps.speak).not.toHaveBeenCalled();
  });

  it('al tocarlo lee el texto; mientras suena dice «Detener» y lo detiene sin mover el foco', async () => {
    const { deps, mp3 } = fakeDeps();
    render(<SpeakButton text="Hacé clic en «Sacar turno»." deps={deps} />);
    button()!.focus();
    await click();
    expect(deps.speak.mock.calls[0]![0]).toBe('Hacé clic en «Sacar turno».');
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
    expect(button()!.dataset.active).toBe('true');
    await click();
    expect(mp3.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
    expect(document.activeElement).toBe(button());
  });

  it('al terminar de sonar vuelve a «Escuchar»', async () => {
    const { deps, mp3 } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await act(async () => mp3.end());
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
  });

  it('al cambiar de instrucción se corta el audio', async () => {
    const { deps, mp3 } = fakeDeps();
    render(<SpeakButton text="Primera instrucción" deps={deps} />);
    await click();
    render(<SpeakButton text="Segunda instrucción" deps={deps} />);
    await flush();
    expect(mp3.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
  });

  it('si cambia la instrucción mientras descarga, se cancela la descarga y no suena', async () => {
    const { deps, stream } = fakeDeps();
    let resolve: (r: SpeakResult) => void = () => {};
    deps.speak.mockImplementationOnce(() => new Promise<SpeakResult>((r) => (resolve = r)));
    render(<SpeakButton text="Primera" deps={deps} />);
    await click();
    render(<SpeakButton text="Segunda" deps={deps} />);
    await flush();
    expect(deps.stopSpeaking).toHaveBeenCalled();
    await act(async () => resolve({ status: 'ok' }));
    // La respuesta tardía no suena: se cierra la reproducción que se había abierto.
    expect(stream.playback.stop).toHaveBeenCalled();
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
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
  });

  it('error: «Fue un problema mío, no tuyo»', async () => {
    const { deps } = fakeDeps({ status: 'error', reason: 'failed' });
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Fue un problema mío, no tuyo');
  });

  it('voz apagada en el servidor (off): lee con la voz del sistema y la próxima vez va directo al sistema', async () => {
    const { deps, system } = fakeDeps({ status: 'error', reason: 'off' });
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await flush();
    expect(deps.systemSpeak).toHaveBeenCalledWith('Hola', expect.any(Function));
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
    await act(async () => system.end());
    expect(speechSource.mode).toBe('system');
    await click();
    await flush();
    expect(deps.speak).toHaveBeenCalledOnce();
    expect(deps.systemSpeak).toHaveBeenCalledTimes(2);
  });

  it('voz apagada y sin voz del sistema en español: lo explica una vez y recién ahí oculta el botón', async () => {
    const { deps } = fakeDeps({ status: 'error', reason: 'off' });
    deps.systemSpeak.mockResolvedValue('noSpanishVoice');
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await flush();
    expect(button()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(SPEECH_TEXTS.noVoice);
    // En la próxima vista (otra instrucción) ya no aparece, sin repetir el aviso.
    render(<SpeakButton text="Otra instrucción" deps={deps} />);
    await flush();
    expect(button()).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('si las voces del sistema no llegan a tiempo, el botón NO se oculta (puede ser momentáneo)', async () => {
    const { deps } = fakeDeps({ status: 'error', reason: 'off' });
    deps.systemSpeak.mockResolvedValue('noVoices');
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await flush();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(SPEECH_TEXTS.failed);
    expect(speechSource.mode).toBe('system');
    deps.systemSpeak.mockResolvedValue(fakePlayback().playback);
    await click();
    await flush();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
  });

  it('pide las voces del sistema al mostrarse (para no esperarlas al tocar)', async () => {
    const { deps } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await flush();
    expect(deps.warmUpVoices).toHaveBeenCalled();
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
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
    await cutFromMain();
    expect(mp3.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
    // El aviso viene del proceso principal: no se reenvía (sin rebotes).
    expect(deps.stopSpeaking).not.toHaveBeenCalled();
  });

  it('el aviso corta también una descarga en curso: el audio que llega tarde no suena', async () => {
    const { deps, stream, cutFromMain } = fakeDeps();
    let resolve: (r: SpeakResult) => void = () => {};
    deps.speak.mockImplementationOnce(() => new Promise<SpeakResult>((r) => (resolve = r)));
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await cutFromMain();
    await act(async () => resolve({ status: 'ok' }));
    // La respuesta tardía no suena: se cierra la reproducción que se había abierto.
    expect(stream.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
  });

  it('con la voz del sistema: avisa al empezar y el aviso de la otra vista la corta', async () => {
    speechSource.mode = 'system';
    const { deps, system, cutFromMain } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await flush();
    expect(deps.speak).not.toHaveBeenCalled();
    expect(deps.stopSpeaking).toHaveBeenCalledOnce();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
    await cutFromMain();
    expect(system.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
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
    expect(first!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
    await act(async () => second!.click());
    expect(a.mp3.playback.stop).toHaveBeenCalled();
    expect(first!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
    expect(second!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
  });

  it('al desmontar deja de escuchar los avisos', async () => {
    const { deps, cutListeners } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    expect(cutListeners.size).toBe(1);
    act(() => root.render(null));
    expect(cutListeners.size).toBe(0);
  });

  it('reproducción progresiva: los pedazos van al stream en orden, apenas llegan', async () => {
    const { deps, stream, audio } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    expect(deps.openMp3Stream).toHaveBeenCalledOnce();
    const [first, second] = [new Uint8Array([1]), new Uint8Array([2])];
    await audio({ type: 'chunk', chunk: first });
    expect(stream.push).toHaveBeenCalledWith(first);
    expect(stream.end).not.toHaveBeenCalled();
    await audio({ type: 'chunk', chunk: second });
    await audio({ type: 'end' });
    expect(stream.push.mock.calls.map(([c]) => c)).toEqual([first, second]);
    expect(stream.end).toHaveBeenCalledOnce();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
  });

  it('si la descarga falla en el medio, se corta la reproducción', async () => {
    const { deps, stream, audio } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await audio({ type: 'error', reason: 'failed' });
    expect(stream.fail).toHaveBeenCalledOnce();
  });

  it('los pedazos de una lectura cortada se ignoran', async () => {
    const { deps, stream, audio } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await click();
    await audio({ type: 'chunk', chunk: new Uint8Array([9]) });
    expect(stream.push).not.toHaveBeenCalled();
  });

  it('si se cierra la vista mientras llega el audio, se pide cortar la descarga', async () => {
    const { deps, audio } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await audio({ type: 'chunk', chunk: new Uint8Array([1]) });
    act(() => root.render(null));
    expect(deps.stopSpeaking).toHaveBeenCalledOnce();
  });

  it('si ya llegó todo, cerrar la vista no vuelve a pedir cortar la descarga', async () => {
    const { deps, audio } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await audio({ type: 'end' });
    act(() => root.render(null));
    expect(deps.stopSpeaking).not.toHaveBeenCalled();
  });

  it('sin texto no se muestra', () => {
    render(<SpeakButton text="  " deps={fakeDeps().deps} />);
    expect(button()).toBeNull();
  });
});

describe('modo voz: lectura automática', () => {
  it('con el modo activo lee solo apenas aparece, una sola vez (no en cada render)', async () => {
    const { deps } = fakeDeps();
    render(<SpeakButton text="Hacé clic en «Sacar turno»." deps={deps} auto />);
    await flush();
    expect(deps.speak).toHaveBeenCalledOnce();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
    render(<SpeakButton text="Hacé clic en «Sacar turno»." deps={deps} auto />);
    await flush();
    expect(deps.speak).toHaveBeenCalledOnce();
  });

  it('el mismo contenido que ya se leyó no se vuelve a leer al volver a mostrarse', async () => {
    const { deps, mp3 } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    await act(async () => mp3.end());
    act(() => root.render(null));
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    expect(deps.speak).toHaveBeenCalledOnce();
  });

  it('un contenido nuevo corta el anterior y se lee', async () => {
    const { deps, mp3 } = fakeDeps();
    render(<SpeakButton text="Primera instrucción" deps={deps} auto />);
    await flush();
    render(<SpeakButton text="Segunda instrucción" deps={deps} auto />);
    await flush();
    expect(mp3.playback.stop).toHaveBeenCalled();
    expect(deps.speak.mock.calls.map(([t]) => t)).toEqual(['Primera instrucción', 'Segunda instrucción']);
  });

  it('«Repetir» (otra contentKey) vuelve a leer el mismo texto', async () => {
    const { deps } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} auto contentKey={1} />);
    await flush();
    render(<SpeakButton text="Hola" deps={deps} auto contentKey={2} />);
    await flush();
    expect(deps.speak).toHaveBeenCalledTimes(2);
  });

  it('un paso nuevo con el mismo texto (otra clave) se lee; el mismo paso dibujado de nuevo, no', async () => {
    const { deps } = fakeDeps();
    render(<SpeakButton text="Tocá «Siguiente»." deps={deps} auto contentKey="1:0" />);
    await flush();
    render(<SpeakButton text="Tocá «Siguiente»." deps={deps} auto contentKey="1:0" />);
    await flush();
    expect(deps.speak).toHaveBeenCalledOnce();
    render(<SpeakButton text="Tocá «Siguiente»." deps={deps} auto contentKey="2:0" />);
    await flush();
    expect(deps.speak).toHaveBeenCalledTimes(2);
  });

  it('«Listo.» de un recorrido nuevo (otra solicitud) se lee aunque repita el texto; redibujarlo, no', async () => {
    const { deps } = fakeDeps();
    render(<SpeakButton text="Listo." deps={deps} auto contentKey="listo:4" />);
    await flush();
    act(() => root.render(null));
    // La tarjeta se vuelve a montar con la misma aparición (por ejemplo, al cambiar de tamaño): no se repite.
    render(<SpeakButton text="Listo." deps={deps} auto contentKey="listo:4" />);
    await flush();
    expect(deps.speak).toHaveBeenCalledOnce();
    act(() => root.render(null));
    render(<SpeakButton text="Listo." deps={deps} auto contentKey="listo:9" />);
    await flush();
    expect(deps.speak).toHaveBeenCalledTimes(2);
  });

  it('apagar el modo corta lo que suena', async () => {
    const { deps, mp3 } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    render(<SpeakButton text="Hola" deps={deps} auto={false} />);
    await flush();
    expect(mp3.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
  });

  it('con el modo apagado no lee solo: solo «Escuchar» manual', async () => {
    const { deps } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} />);
    await flush();
    render(<SpeakButton text="Otra" deps={deps} />);
    await flush();
    expect(deps.speak).not.toHaveBeenCalled();
  });

  it('si la lectura automática falla (ocupado, error), el contenido no queda marcado como leído', async () => {
    for (const reason of ['busy', 'failed'] as const) {
      autoRead.last = '';
      const { deps } = fakeDeps({ status: 'error', reason });
      render(<SpeakButton text={`Hola ${reason}`} deps={deps} auto />);
      await flush();
      act(() => root.render(null));
      deps.speak.mockResolvedValue({ status: 'ok' });
      render(<SpeakButton text={`Hola ${reason}`} deps={deps} auto />);
      await flush();
      expect(deps.speak).toHaveBeenCalledTimes(2);
      act(() => root.render(null));
    }
  });

  it('voz del sistema sin voces (noVoices): el contenido se vuelve a leer cuando reaparece', async () => {
    speechSource.mode = 'system';
    const { deps } = fakeDeps();
    deps.systemSpeak.mockResolvedValueOnce('noVoices');
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    act(() => root.render(null));
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    expect(deps.systemSpeak).toHaveBeenCalledTimes(2);
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
  });

  it('si la vista se cierra mientras espera las voces del sistema, el contenido se vuelve a leer después', async () => {
    speechSource.mode = 'system';
    const { deps, system } = fakeDeps();
    let resolveVoices: (p: Playback | SystemSpeechProblem) => void = () => {};
    deps.systemSpeak.mockImplementationOnce(() => new Promise((r) => (resolveVoices = r)));
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    act(() => root.render(null));
    await act(async () => resolveVoices(system.playback));
    expect(system.playback.stop).toHaveBeenCalled(); // la que llegó tarde no suena
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    expect(deps.systemSpeak).toHaveBeenCalledTimes(2);
  });

  it('«Repetir» con el mismo texto corta la lectura propia en curso: nunca dos voces', async () => {
    const first = fakePlayback();
    const second = fakePlayback();
    const { deps } = fakeDeps();
    deps.openMp3Stream.mockReturnValueOnce({ mode: 'progressive', playback: first.playback, push: vi.fn(), end: vi.fn(), fail: vi.fn() });
    deps.openMp3Stream.mockReturnValueOnce({ mode: 'progressive', playback: second.playback, push: vi.fn(), end: vi.fn(), fail: vi.fn() });
    render(<SpeakButton text="Hacé clic en «Sacar turno»." deps={deps} auto contentKey={1} />);
    await flush();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
    render(<SpeakButton text="Hacé clic en «Sacar turno»." deps={deps} auto contentKey={2} />);
    await flush();
    expect(first.playback.stop).toHaveBeenCalled();
    expect(second.playback.stop).not.toHaveBeenCalled();
    expect(deps.speak).toHaveBeenCalledTimes(2);
  });

  it('si falla mientras suena, no queda marcada como leída: se vuelve a leer cuando reaparece (sin reintentar en bucle)', async () => {
    const { deps, mp3 } = fakeDeps();
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    await act(async () => mp3.end('failed'));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(SPEECH_TEXTS.failed);
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    expect(deps.speak).toHaveBeenCalledOnce();
    act(() => root.render(null));
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    expect(deps.speak).toHaveBeenCalledTimes(2);
  });

  it('una lectura automática cortada al desmontarse se puede volver a leer (StrictMode en desarrollo)', async () => {
    const { deps } = fakeDeps();
    let resolve: (r: SpeakResult) => void = () => {};
    deps.speak.mockImplementationOnce(() => new Promise<SpeakResult>((r) => (resolve = r)));
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    act(() => root.render(null));
    await act(async () => resolve({ status: 'ok' }));
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    expect(deps.speak).toHaveBeenCalledTimes(2);
  });
});

describe('voz del sistema: la lectura que espera las voces se puede cortar', () => {
  /** systemSpeak simulado que queda esperando las voces; guarda `stillWanted` para mirarlo. */
  function waitingVoices(deps: ReturnType<typeof fakeDeps>['deps']) {
    const calls: Array<{ wanted: () => boolean; resolve: (p: Playback | SystemSpeechProblem) => void }> = [];
    deps.systemSpeak.mockImplementation(
      (_text: string, wanted: () => boolean) => new Promise<Playback | SystemSpeechProblem>((resolve) => calls.push({ wanted, resolve })),
    );
    return calls;
  }
  beforeEach(() => {
    speechSource.mode = 'system';
  });

  it('un aviso de la otra vista la corta mientras espera, y cuando llegan las voces no suena', async () => {
    const { deps, system, cutFromMain } = fakeDeps();
    const calls = waitingVoices(deps);
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
    expect(calls[0]!.wanted()).toBe(true);
    await cutFromMain();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
    // Ya no hace falta: systemSpeak no la hace sonar ni llama a speechSynthesis.cancel().
    expect(calls[0]!.wanted()).toBe(false);
    await act(async () => calls[0]!.resolve(system.playback));
    expect(system.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
  });

  it('otra lectura de esta vista también la corta mientras espera', async () => {
    const a = fakeDeps();
    const b = fakeDeps();
    const waitingA = waitingVoices(a.deps);
    render(
      <>
        <SpeakButton text="Primero" deps={a.deps} />
        <SpeakButton text="Segundo" deps={b.deps} />
      </>,
    );
    const [first, second] = [...container.querySelectorAll<HTMLButtonElement>('button.speak-btn')];
    await act(async () => first!.click());
    await act(async () => second!.click());
    expect(waitingA[0]!.wanted()).toBe(false);
    expect(first!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
    expect(second!.textContent?.trim()).toBe(SPEECH_TEXTS.stop);
  });

  it('«Detener» mientras espera las voces: no suena después', async () => {
    const { deps } = fakeDeps();
    const calls = waitingVoices(deps);
    render(<SpeakButton text="Hola" deps={deps} />);
    await click();
    await click();
    expect(calls[0]!.wanted()).toBe(false);
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
  });

  it('apagar el modo voz mientras espera las voces: no suena después', async () => {
    const { deps, system } = fakeDeps();
    const calls = waitingVoices(deps);
    render(<SpeakButton text="Hola" deps={deps} auto />);
    await flush();
    expect(calls).toHaveLength(1);
    render(<SpeakButton text="Hola" deps={deps} auto={false} />);
    await flush();
    expect(calls[0]!.wanted()).toBe(false);
    await act(async () => calls[0]!.resolve(system.playback));
    expect(system.playback.stop).toHaveBeenCalled();
    expect(button()!.textContent?.trim()).toBe(SPEECH_TEXTS.listen);
  });

  it('«Repetir» mientras espera las voces: solo la última puede sonar', async () => {
    const { deps } = fakeDeps();
    const calls = waitingVoices(deps);
    render(<SpeakButton text="Hola" deps={deps} auto contentKey="1:0" />);
    await flush();
    render(<SpeakButton text="Hola" deps={deps} auto contentKey="1:1" />);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.wanted()).toBe(false);
    expect(calls[1]!.wanted()).toBe(true);
  });
});

describe('systemSpeak: una lectura vieja nunca corta a una más nueva', () => {
  const realSynthesis = Object.getOwnPropertyDescriptor(globalThis, 'speechSynthesis');
  const realUtterance = Object.getOwnPropertyDescriptor(globalThis, 'SpeechSynthesisUtterance');
  let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; getVoices: () => unknown[] };
  beforeEach(() => {
    synth = Object.assign(new EventTarget(), {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => [{ lang: 'es-MX', name: 'Paulina', localService: true }],
    });
    Object.defineProperty(globalThis, 'speechSynthesis', { value: synth, configurable: true });
    class FakeUtterance extends EventTarget {
      voice: unknown = null;
      lang = '';
      constructor(readonly text: string) {
        super();
      }
    }
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
  });
  afterEach(() => {
    for (const [name, real] of [
      ['speechSynthesis', realSynthesis],
      ['SpeechSynthesisUtterance', realUtterance],
    ] as const) {
      if (real) Object.defineProperty(globalThis, name, real);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  });

  it('si al llegar las voces ya no hace falta, no suena ni llama a cancel()', async () => {
    const report = vi.fn();
    const result = await systemSpeak('Hola', 5_000, report, () => false);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(typeof result).toBe('object');
    const playback = result as Playback;
    playback.stop();
    expect(synth.cancel).not.toHaveBeenCalled();
    await expect(playback.done).resolves.toBe('stopped');
  });

  it('detener una lectura ya reemplazada no calla a la que suena ahora', async () => {
    const first = (await systemSpeak('Primera')) as Playback;
    const second = (await systemSpeak('Segunda')) as Playback;
    expect(synth.speak).toHaveBeenCalledTimes(2);
    const cancels = synth.cancel.mock.calls.length;
    first.stop();
    expect(synth.cancel.mock.calls.length).toBe(cancels);
    await expect(first.done).resolves.toBe('stopped');
    second.stop();
    expect(synth.cancel.mock.calls.length).toBe(cancels + 1);
  });

  it('detener una lectura que ya terminó no calla nada', async () => {
    const playback = (await systemSpeak('Hola')) as Playback;
    const utterance = synth.speak.mock.calls[0]![0] as EventTarget;
    utterance.dispatchEvent(new Event('end'));
    await expect(playback.done).resolves.toBe('ended');
    const cancels = synth.cancel.mock.calls.length;
    playback.stop();
    expect(synth.cancel.mock.calls.length).toBe(cancels);
  });
});

describe('volver de «Ver otras opciones»: una aparición nueva de las opciones', () => {
  it('con otra vuelta (optionsReadKey) las opciones se vuelven a leer y avisan de nuevo para escuchar', async () => {
    const { deps, mp3 } = fakeDeps();
    const onDone = vi.fn();
    const text = '¿Qué querés hacer acá? Encontré estas opciones en esta página: A o B.';
    render(<SpeakButton text={text} deps={deps} auto contentKey={optionsReadKey(7, 0)} onDone={onDone} />);
    await flush();
    await act(async () => mp3.end());
    expect(onDone).toHaveBeenCalledTimes(1);
    // «Ver otras opciones» desmonta la lista; «Volver» la monta con otra vuelta.
    act(() => root.render(null));
    const again = fakePlayback();
    deps.openMp3Stream.mockReturnValueOnce({ mode: 'progressive', playback: again.playback, push: vi.fn(), end: vi.fn(), fail: vi.fn() });
    render(<SpeakButton text={text} deps={deps} auto contentKey={optionsReadKey(7, 1)} onDone={onDone} />);
    await flush();
    expect(deps.speak).toHaveBeenCalledTimes(2);
    await act(async () => again.end());
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('sin vuelta nueva (misma clave) no se vuelve a leer', () => {
    expect(optionsReadKey(7, 0)).not.toBe(optionsReadKey(7, 1));
    expect(optionsReadKey(7, 1)).toBe(optionsReadKey(7, 1));
  });
});

describe('onDone: para escuchar la respuesta después de leer', () => {
  it('avisa `ended` cuando la lectura sonó completa', async () => {
    const { deps, mp3 } = fakeDeps();
    const onDone = vi.fn();
    render(<SpeakButton text="Hola" deps={deps} auto onDone={onDone} />);
    await flush();
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => mp3.end());
    expect(onDone).toHaveBeenCalledExactlyOnceWith('ended');
  });

  it('avisa `failed` si no se pudo leer (ocupado)', async () => {
    const { deps } = fakeDeps({ status: 'error', reason: 'busy' });
    const onDone = vi.fn();
    render(<SpeakButton text="Hola" deps={deps} auto onDone={onDone} />);
    await flush();
    expect(onDone).toHaveBeenCalledExactlyOnceWith('failed');
  });

  it('no avisa si se cortó («Detener»): no se abre el micrófono', async () => {
    const { deps } = fakeDeps();
    const onDone = vi.fn();
    render(<SpeakButton text="Hola" deps={deps} auto onDone={onDone} />);
    await flush();
    await click();
    await flush();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('pickSpanishVoice', () => {
  const v = (lang: string, localService = true, name = lang) => ({ lang, localService, name });

  it('prefiere es-UY, después es-AR y después cualquier es-*', () => {
    expect(pickSpanishVoice([v('en-US'), v('es-ES'), v('es-AR'), v('es-UY')])?.lang).toBe('es-UY');
    expect(pickSpanishVoice([v('es-MX'), v('es_AR'), v('fr-FR')])?.lang).toBe('es_AR');
    expect(pickSpanishVoice([v('en-GB'), v('es-MX')])?.lang).toBe('es-MX');
    expect(pickSpanishVoice([v('es')])?.lang).toBe('es');
  });

  it('macOS (es-ES y es-MX, sin es-UY): elige una voz clásica de Latinoamérica, no las variantes', () => {
    const mac = [
      v('es-ES', true, 'Eddy (español (España))'),
      v('es-MX', true, 'Eddy (español (México))'),
      v('es-ES', true, 'Grandma (español (España))'),
      v('es-MX', true, 'Grandpa (español (México))'),
      v('es-ES', true, 'Mónica'),
      v('es-MX', true, 'Paulina'),
      v('en-US', true, 'Samantha'),
    ];
    expect(pickSpanishVoice(mac)?.name).toBe('Paulina');
    expect(pickSpanishVoice(mac.filter((x) => x.lang !== 'es-MX'))?.name).toBe('Mónica');
    expect(pickSpanishVoice([v('es-ES', true, 'Grandma (español (España))')])?.name).toBe('Grandma (español (España))');
  });

  it('entre iguales prefiere la voz local; sin español, null', () => {
    expect(pickSpanishVoice([v('es-ES', false), v('es-MX', true)])?.lang).toBe('es-MX');
    expect(pickSpanishVoice([v('en-US'), v('pt-BR'), v('est')])).toBeNull();
  });
});

describe('systemVoices: esperar las voces sin ocultar el botón por apuro', () => {
  const realSynthesis = Object.getOwnPropertyDescriptor(globalThis, 'speechSynthesis');
  /** speechSynthesis simulado: la lista se llena cuando el test quiere. */
  function fakeSynthesis() {
    let voices: Array<{ lang: string; name: string; localService: boolean }> = [];
    const target = new EventTarget();
    const synth = Object.assign(target, { getVoices: () => voices });
    Object.defineProperty(globalThis, 'speechSynthesis', { value: synth, configurable: true });
    return {
      fill: () => (voices = [{ lang: 'es-MX', name: 'Paulina', localService: true }]),
      changed: () => target.dispatchEvent(new Event('voiceschanged')),
    };
  }
  afterEach(() => {
    vi.useRealTimers();
    if (realSynthesis) Object.defineProperty(globalThis, 'speechSynthesis', realSynthesis);
    else delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it('si el primer «voiceschanged» llega con la lista vacía, sigue esperando', async () => {
    vi.useFakeTimers();
    const synth = fakeSynthesis();
    const pending = systemVoices(5_000);
    synth.changed(); // llega el aviso, pero todavía sin voces (lo que se vio en Electron en frío)
    await vi.advanceTimersByTimeAsync(300);
    synth.fill();
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toHaveLength(1);
  });

  it('espera más de 1 s si hace falta (en frío tardó ~0,8 s)', async () => {
    vi.useFakeTimers();
    const synth = fakeSynthesis();
    const pending = systemVoices(5_000);
    await vi.advanceTimersByTimeAsync(1_800);
    synth.fill();
    synth.changed();
    await expect(pending).resolves.toHaveLength(1);
  });

  it('si nunca llegan, devuelve la lista vacía al tope', async () => {
    vi.useFakeTimers();
    fakeSynthesis();
    const pending = systemVoices(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toEqual([]);
  });
});

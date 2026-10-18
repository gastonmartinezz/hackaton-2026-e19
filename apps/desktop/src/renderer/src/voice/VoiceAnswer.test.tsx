// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscribeResult } from '../../../shared/ipc';
import type { Playback } from '../speech/playback';
import { autoRead, speechSource, type ReadAloudDeps } from '../speech/useReadAloud';
import type { AutoStopReason } from './capture';
import { ANSWER_TEXTS, VoiceAnswer, type VoiceAnswerDeps, type VoiceChoice } from './VoiceAnswer';

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
const flush = () => act(async () => {});
const status = () => (container.querySelector('[aria-live="polite"]')?.textContent ?? '').trim();
const stopButton = () => container.querySelector<HTMLButtonElement>('button.voice-answer-stop');

/** Lectura simulada de los avisos: termina sola enseguida. */
function readDeps(): ReadAloudDeps & { spoken: string[] } {
  const spoken: string[] = [];
  const playback = (): Playback => ({ done: Promise.resolve('ended'), stop: vi.fn() });
  return {
    spoken,
    speak: vi.fn(async (text: string) => (spoken.push(text), { status: 'ok' as const })),
    stopSpeaking: vi.fn(),
    onCut: () => () => {},
    openMp3Stream: () => ({ mode: 'progressive', playback: playback(), push: vi.fn(), end: vi.fn(), fail: vi.fn() }),
    systemSpeak: vi.fn(async () => playback()),
    warmUpVoices: vi.fn(),
  };
}

/** Micrófono simulado: cada apertura se termina con `autoStop`. Las transcripciones salen en orden. */
function fakeDeps(...transcripts: TranscribeResult[]) {
  const captures: Array<{ finish: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
  let autoStop: (reason: AutoStopReason) => void = () => {};
  const read = readDeps();
  const deps: VoiceAnswerDeps & { open: ReturnType<typeof vi.fn>; transcribe: ReturnType<typeof vi.fn> } = {
    open: vi.fn(async (onAutoStop: (reason: AutoStopReason) => void) => {
      autoStop = onAutoStop;
      const capture = { finish: vi.fn(async () => new ArrayBuffer(8)), close: vi.fn() };
      captures.push(capture);
      return capture;
    }),
    transcribe: vi.fn(async () => transcripts.shift() ?? { status: 'empty' as const }),
    read,
  };
  return { deps, captures, read, stopBy: (reason: AutoStopReason = 'silence') => act(async () => autoStop(reason)) };
}

function choices() {
  const run = { cedula: vi.fn(), pasaporte: vi.fn(), unsure: vi.fn() };
  const list: VoiceChoice[] = [
    { label: 'Cédula de identidad', run: run.cedula },
    { label: 'Pasaporte', run: run.pasaporte },
    { label: 'No estoy seguro', kind: 'unsure', run: run.unsure },
  ];
  return { list, run };
}

describe('VoiceAnswer: responder con la voz', () => {
  it('con el modo voz apagado nunca abre el micrófono', async () => {
    const { deps } = fakeDeps();
    const { list } = choices();
    render(<VoiceAnswer choices={list} active={false} trigger={0} deps={deps} />);
    render(<VoiceAnswer choices={list} active={false} trigger={1} deps={deps} />);
    await flush();
    expect(deps.open).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('con modo voz, escucha solo después de la lectura (trigger) y muestra «Te escucho» y «Terminar»', async () => {
    const { deps } = fakeDeps();
    const { list } = choices();
    render(<VoiceAnswer choices={list} active trigger={0} deps={deps} />);
    await flush();
    expect(deps.open).not.toHaveBeenCalled();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} />);
    await flush();
    expect(deps.open).toHaveBeenCalledOnce();
    expect(status()).toBe(ANSWER_TEXTS.listening);
    expect(stopButton()?.textContent).toContain('Terminar');
  });

  it('reconoce la opción, anuncia «Elegiste…» (región polite y voz) y ejecuta lo mismo que el botón', async () => {
    const { deps, stopBy, read } = fakeDeps({ status: 'ok', text: 'el pasaporte' });
    const { list, run } = choices();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} />);
    await flush();
    await stopBy('silence');
    await flush();
    await flush();
    expect(read.spoken).toEqual([ANSWER_TEXTS.chosen('Pasaporte')]);
    expect(run.pasaporte).toHaveBeenCalledOnce();
    expect(run.cedula).not.toHaveBeenCalled();
  });

  it('«Terminar» corta y reconoce lo dicho («la primera»)', async () => {
    const { deps } = fakeDeps({ status: 'ok', text: 'la primera' });
    const { list, run } = choices();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} />);
    await flush();
    await act(async () => stopButton()!.click());
    await flush();
    await flush();
    expect(run.cedula).toHaveBeenCalledOnce();
  });

  it('«no sé» elige «No estoy seguro»', async () => {
    const { deps, stopBy } = fakeDeps({ status: 'ok', text: 'no sé' });
    const { list, run } = choices();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} />);
    await flush();
    await stopBy();
    await flush();
    await flush();
    expect(run.unsure).toHaveBeenCalledOnce();
  });

  it('si no entiende, pregunta una vez «No te entendí…», vuelve a escuchar; si falla otra vez, deja los botones', async () => {
    const { deps, stopBy, read } = fakeDeps({ status: 'ok', text: 'mañana llueve' }, { status: 'empty' });
    const { list, run } = choices();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} />);
    await flush();
    await stopBy();
    await flush();
    await flush();
    expect(read.spoken).toEqual([ANSWER_TEXTS.retry]);
    expect(deps.open).toHaveBeenCalledTimes(2);
    await stopBy();
    await flush();
    await flush();
    expect(deps.open).toHaveBeenCalledTimes(2);
    expect(Object.values(run).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    expect(status()).toBe('');
  });

  it('con `onFreeText`, si después de repreguntar sigue sin ser ninguna opción, se toma como un pedido propio', async () => {
    const { deps, stopBy, read } = fakeDeps({ status: 'ok', text: 'no entendí, repetí' }, { status: 'ok', text: 'Quiero cambiar mi dirección.' });
    const { list, run } = choices();
    const onFreeText = vi.fn();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} onFreeText={onFreeText} />);
    await flush();
    await stopBy();
    await flush();
    await flush();
    // La primera vez siempre se repregunta.
    expect(read.spoken).toEqual([ANSWER_TEXTS.retry]);
    expect(onFreeText).not.toHaveBeenCalled();
    await stopBy();
    await flush();
    await flush();
    expect(read.spoken).toEqual([ANSWER_TEXTS.retry, ANSWER_TEXTS.searching]);
    expect(onFreeText).toHaveBeenCalledWith('Quiero cambiar mi dirección.');
    expect(Object.values(run).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('con `onFreeText`, algo muy corto o un empate no se busca: se vuelve a preguntar', async () => {
    const { deps, stopBy, read } = fakeDeps({ status: 'ok', text: 'eh' });
    const { list } = choices();
    const onFreeText = vi.fn();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} onFreeText={onFreeText} />);
    await flush();
    await stopBy();
    await flush();
    await flush();
    expect(read.spoken).toEqual([ANSWER_TEXTS.retry]);
    expect(onFreeText).not.toHaveBeenCalled();
  });

  it('si no dice nada, deja de escuchar sin error y sin transcribir', async () => {
    const { deps, stopBy, captures } = fakeDeps();
    const { list } = choices();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} />);
    await flush();
    await stopBy('noSpeech');
    expect(captures[0]!.close).toHaveBeenCalled();
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(status()).toBe('');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('apagar el modo voz mientras escucha cierra el micrófono', async () => {
    const { deps, captures } = fakeDeps();
    const { list } = choices();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} />);
    await flush();
    render(<VoiceAnswer choices={list} active={false} trigger={1} deps={deps} />);
    await flush();
    expect(captures[0]!.close).toHaveBeenCalled();
  });

  it('dos disparos seguidos dejan una sola captura abierta: la primera se libera', async () => {
    const { deps, captures } = fakeDeps();
    const { list } = choices();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} />);
    await flush();
    render(<VoiceAnswer choices={list} active trigger={2} deps={deps} />);
    await flush();
    expect(deps.open).toHaveBeenCalledTimes(2);
    expect(captures[0]!.close).toHaveBeenCalled();
    expect(captures[1]!.close).not.toHaveBeenCalled();
  });

  it('con `onMessage` no agrega otra región aria-live: el estado se anuncia en la de la vista', async () => {
    const { deps } = fakeDeps();
    const { list } = choices();
    const onMessage = vi.fn();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} onMessage={onMessage} />);
    await flush();
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(0);
    expect(onMessage).toHaveBeenLastCalledWith(ANSWER_TEXTS.listening);
    expect(container.querySelector('.voice-status')?.textContent?.trim()).toBe(ANSWER_TEXTS.listening);
  });

  it('sin `onMessage` (opciones de la tarjeta) usa su propia región: una sola', async () => {
    const { deps } = fakeDeps();
    const { list } = choices();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} />);
    await flush();
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it('al salir de la vista se cierra el micrófono', async () => {
    const { deps, captures } = fakeDeps();
    const { list } = choices();
    render(<VoiceAnswer choices={list} active trigger={1} deps={deps} />);
    await flush();
    act(() => root.render(null));
    expect(captures[0]!.close).toHaveBeenCalled();
  });
});

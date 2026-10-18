// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictateFieldResult, UiCommand } from '../../../shared/ipc';
import type { Playback } from '../speech/playback';
import { autoRead, speechSource, type ReadAloudDeps } from '../speech/useReadAloud';
import type { AutoStopReason } from './capture';
import { DICTATE_TEXTS, FieldDictation, type FieldDictationDeps } from './FieldDictation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
let sent: UiCommand[];
beforeEach(() => {
  speechSource.mode = 'server';
  autoRead.last = '';
  sent = [];
  (window as unknown as { asistente: unknown }).asistente = {
    command: vi.fn(async (c: UiCommand) => void sent.push(c)),
    speak: vi.fn(async () => ({ status: 'error', reason: 'off' })),
    stopSpeaking: vi.fn(),
    onSpeechCut: () => () => {},
    speechDiagnostic: vi.fn(),
  };
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
const button = (text: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);

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

/** Micrófono simulado; los resultados del dictado salen en orden. */
function fakeDeps(...results: DictateFieldResult[]) {
  let autoStop: (reason: AutoStopReason) => void = () => {};
  const read = readDeps();
  const deps: FieldDictationDeps & { open: ReturnType<typeof vi.fn>; dictate: ReturnType<typeof vi.fn> } = {
    open: vi.fn(async (onAutoStop: (reason: AutoStopReason) => void) => {
      autoStop = onAutoStop;
      return { finish: vi.fn(async () => new ArrayBuffer(8)), close: vi.fn() };
    }),
    dictate: vi.fn(async () => results.shift() ?? { status: 'empty' as const }),
    read,
  };
  return { deps, read, stopBy: (reason: AutoStopReason = 'silence') => act(async () => autoStop(reason)) };
}

describe('FieldDictation: dictar un dato del formulario', () => {
  it('sin escucha automática espera «Hablar»; lo dictado va al proceso principal y nunca se muestra', async () => {
    const { deps, stopBy } = fakeDeps({ status: 'filled' });
    render(<FieldDictation filled={false} auto={false} trigger={1} stepKey="a" deps={deps} />);
    await flush();
    expect(deps.open).not.toHaveBeenCalled();
    act(() => button('Hablar')!.click());
    await flush();
    expect(container.textContent).toContain(DICTATE_TEXTS.listening);
    await stopBy();
    expect(deps.dictate).toHaveBeenCalledTimes(1);
    // El proceso principal escribió el dato: la tarjeta pide revisarlo.
    render(<FieldDictation filled auto={false} trigger={1} stepKey="a" deps={deps} />);
    await flush();
    expect(container.textContent).toContain(DICTATE_TEXTS.filled);
    act(() => button(DICTATE_TEXTS.ok)!.click());
    act(() => button(DICTATE_TEXTS.myself)!.click());
    expect(sent).toEqual([{ type: 'confirmDone' }, { type: 'typeMyself' }]);
  });

  it('con escucha automática, escucha al terminar la pregunta y, si no entendió, pregunta una sola vez más', async () => {
    const { deps, read, stopBy } = fakeDeps({ status: 'empty' }, { status: 'noMatch' });
    render(<FieldDictation filled={false} auto trigger={0} stepKey="b" deps={deps} />);
    await flush();
    expect(deps.open).not.toHaveBeenCalled();
    render(<FieldDictation filled={false} auto trigger={1} stepKey="b" deps={deps} />);
    await flush();
    expect(deps.open).toHaveBeenCalledTimes(1);
    await stopBy();
    await flush();
    expect(read.spoken).toContain(DICTATE_TEXTS.retry);
    expect(deps.open).toHaveBeenCalledTimes(2);
    await stopBy();
    await flush();
    expect(deps.open).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(DICTATE_TEXTS.noMatch);
    expect(button('Hablar')).toBeDefined();
  });

  it('«Decirlo de nuevo» vuelve a escuchar aunque el dato ya esté escrito', async () => {
    const { deps } = fakeDeps();
    render(<FieldDictation filled auto={false} trigger={0} stepKey="c" deps={deps} />);
    await flush();
    act(() => button(DICTATE_TEXTS.again)!.click());
    await flush();
    expect(deps.open).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(DICTATE_TEXTS.listening);
  });
});

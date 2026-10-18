// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscribeResult } from '../../../shared/ipc';
import { MicError, type AutoStopReason } from './capture';
import { MicButton, VOICE_TEXTS, VoiceMessages } from './VoiceSearch';
import { useVoiceInput, voiceAvailability, type VoiceDeps, type VoiceStatus } from './useVoiceInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  voiceAvailability.off = false;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));
const button = () => container.querySelector<HTMLButtonElement>('button.mic')!;

describe('MicButton', () => {
  it('en reposo: solo el ícono, con nombre accesible y sin presionar', () => {
    render(<MicButton status={{ kind: 'idle' }} onToggle={() => {}} />);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(button().textContent?.trim()).toBe(VOICE_TEXTS.speak);
    expect(button().querySelector('.sr-only')?.textContent).toBe(VOICE_TEXTS.speak);
    expect(button().querySelector('.ic')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('escuchando: presionado y con «Terminar» visible', () => {
    render(<MicButton status={{ kind: 'listening' }} onToggle={() => {}} />);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().querySelector('.mic-label')?.textContent).toBe(VOICE_TEXTS.stop);
  });

  it('transcribiendo: aria-disabled (sin perder el foco) y no hace nada', () => {
    const onToggle = vi.fn();
    render(<MicButton status={{ kind: 'transcribing' }} onToggle={onToggle} />);
    button().focus();
    act(() => button().click());
    expect(onToggle).not.toHaveBeenCalled();
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(button().disabled).toBe(false);
    expect(document.activeElement).toBe(button());
  });
});

describe('VoiceMessages', () => {
  const show = (status: VoiceStatus) => {
    render(<VoiceMessages status={status} />);
    return { polite: container.querySelector('[aria-live="polite"]'), alert: container.querySelector('[role="alert"] p') };
  };

  it('la región polite está siempre montada', () => {
    const { polite, alert } = show({ kind: 'idle' });
    expect(polite?.textContent).toBe('');
    expect(alert).toBeNull();
  });

  it('anuncia el texto dictado y el «no te escuché» sin alerta', () => {
    expect(show({ kind: 'heard', text: 'turno médico' }).polite?.textContent).toContain('«turno médico»');
    const empty = show({ kind: 'empty' });
    expect(empty.polite?.textContent).toBe(VOICE_TEXTS.empty);
    expect(empty.alert).toBeNull();
  });

  it('los errores van con role="alert" y sin culpa', () => {
    expect(show({ kind: 'error', reason: 'failed' }).alert?.textContent).toContain('Fue un problema de mi lado, no tuyo');
    expect(show({ kind: 'mic', problem: 'denied' }).alert?.textContent).toBe(VOICE_TEXTS.denied);
    expect(show({ kind: 'mic', problem: 'missing' }).alert?.textContent).toContain('escribir');
  });
});

/** El buscador mínimo: campo + micrófono, como en Home (`busy` = búsqueda en curso). */
function Harness({ deps, busy = false, onSubmit }: { deps: VoiceDeps; busy?: boolean; onSubmit?: (text: string) => void }) {
  const [text, setText] = useState('');
  const voice = useVoiceInput(setText, { deps, blocked: busy, onSubmit });
  return (
    <>
      <input aria-label="buscador" value={text} onChange={(e) => setText(e.target.value)} />
      {voice.available ? <MicButton status={voice.status} onToggle={voice.toggle} blocked={busy} /> : null}
      <VoiceMessages status={voice.status} />
    </>
  );
}

function fakeDeps(result: TranscribeResult, wav: ArrayBuffer | null = new ArrayBuffer(8)) {
  const capture = { finish: vi.fn(async () => wav), close: vi.fn() };
  let autoStop: (reason: AutoStopReason) => void = () => {};
  const deps: VoiceDeps = {
    open: vi.fn(async (onAutoStop: (reason: AutoStopReason) => void) => ((autoStop = onAutoStop), capture)),
    transcribe: vi.fn(async () => result),
  };
  return { deps, capture, autoStop: (reason: AutoStopReason = 'silence') => autoStop(reason) };
}

const flush = () => act(async () => {});

describe('useVoiceInput', () => {
  it('escuchar → «Terminar» → el texto queda visible en el buscador y se busca solo, sin mover el foco', async () => {
    const { deps, capture } = fakeDeps({ status: 'ok', text: 'horarios de la biblioteca' });
    const onSubmit = vi.fn();
    render(<Harness deps={deps} onSubmit={onSubmit} />);
    button().focus();
    await act(async () => button().click());
    expect(button().getAttribute('aria-pressed')).toBe('true');
    await act(async () => button().click());
    await flush();
    const input = container.querySelector('input')!;
    expect(input.value).toBe('horarios de la biblioteca');
    expect(document.activeElement).toBe(button());
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(capture.finish).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('horarios de la biblioteca');
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(VOICE_TEXTS.heard('horarios de la biblioteca'));
  });

  it('tras 5 s de silencio corta solo, pone el texto y lo busca', async () => {
    const fake = fakeDeps({ status: 'ok', text: 'renovar la cédula' });
    const onSubmit = vi.fn();
    render(<Harness deps={fake.deps} onSubmit={onSubmit} />);
    await act(async () => button().click());
    await act(async () => fake.autoStop('silence'));
    await flush();
    expect(container.querySelector('input')!.value).toBe('renovar la cédula');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('renovar la cédula');
  });

  it('sin hablar en los primeros 5 s: «no te escuché», sin mandar audio ni buscar', async () => {
    const fake = fakeDeps({ status: 'ok', text: 'no tiene que llegar' });
    const onSubmit = vi.fn();
    render(<Harness deps={fake.deps} onSubmit={onSubmit} />);
    await act(async () => button().click());
    await act(async () => fake.autoStop('noSpeech'));
    await flush();
    expect(fake.capture.close).toHaveBeenCalled();
    expect(fake.capture.finish).not.toHaveBeenCalled();
    expect(fake.deps.transcribe).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(VOICE_TEXTS.empty);
  });

  it('texto vacío del servidor: «no te escuché» y no se busca', async () => {
    const { deps } = fakeDeps({ status: 'empty' });
    const onSubmit = vi.fn();
    render(<Harness deps={deps} onSubmit={onSubmit} />);
    await act(async () => button().click());
    await act(async () => button().click());
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(VOICE_TEXTS.empty);
  });

  it('no busca solo si ya hay una búsqueda en curso', async () => {
    let resolve: (r: TranscribeResult) => void = () => {};
    const { deps } = fakeDeps({ status: 'ok', text: 'x' });
    deps.transcribe = vi.fn(() => new Promise<TranscribeResult>((r) => (resolve = r)));
    const onSubmit = vi.fn();
    render(<Harness deps={deps} onSubmit={onSubmit} />);
    await act(async () => button().click());
    await act(async () => button().click());
    render(<Harness deps={deps} onSubmit={onSubmit} busy />);
    await act(async () => resolve({ status: 'ok', text: 'tarde' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('al empezar la búsqueda que disparó el dictado, el aviso «Entendí…» queda', async () => {
    const { deps } = fakeDeps({ status: 'ok', text: 'turno médico' });
    let busy = false;
    const onSubmit = vi.fn(() => (busy = true));
    render(<Harness deps={deps} onSubmit={onSubmit} />);
    await act(async () => button().click());
    await act(async () => button().click());
    await flush();
    render(<Harness deps={deps} onSubmit={onSubmit} busy={busy} />);
    await flush();
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(VOICE_TEXTS.heard('turno médico'));
    expect(button().getAttribute('aria-disabled')).toBe('true');
  });

  it('corta solo (silencio o 30 s)', async () => {
    const fake = fakeDeps({ status: 'ok', text: 'hola' });
    render(<Harness deps={fake.deps} />);
    await act(async () => button().click());
    await act(async () => fake.autoStop());
    await flush();
    expect(container.querySelector('input')!.value).toBe('hola');
  });

  it('audio demasiado corto → «no te escuché» sin llamar al servidor', async () => {
    const { deps } = fakeDeps({ status: 'ok', text: 'x' }, null);
    render(<Harness deps={deps} />);
    await act(async () => button().click());
    await act(async () => button().click());
    await flush();
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(VOICE_TEXTS.empty);
  });

  it('sin permiso del micrófono el buscador sigue funcionando y se explica', async () => {
    const deps: VoiceDeps = { open: vi.fn(async () => Promise.reject(new MicError('denied'))), transcribe: vi.fn() };
    render(<Harness deps={deps} />);
    await act(async () => button().click());
    expect(container.querySelector('[role="alert"] p')?.textContent).toBe(VOICE_TEXTS.denied);
    expect(container.querySelector('input')!.readOnly).toBe(false);
  });

  it('al desmontar cierra el micrófono', async () => {
    const { deps, capture } = fakeDeps({ status: 'ok', text: 'x' });
    render(<Harness deps={deps} />);
    await act(async () => button().click());
    act(() => root.render(null));
    expect(capture.close).toHaveBeenCalled();
  });

  it('con una búsqueda en curso el micrófono queda aria-disabled y no empieza a escuchar', async () => {
    const { deps } = fakeDeps({ status: 'ok', text: 'x' });
    render(<Harness deps={deps} busy />);
    expect(button().getAttribute('aria-disabled')).toBe('true');
    await act(async () => button().click());
    expect(deps.open).not.toHaveBeenCalled();
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('si empieza una búsqueda mientras escucha, se cancela la captura y se cierran las pistas', async () => {
    const { deps, capture } = fakeDeps({ status: 'ok', text: 'no tiene que llegar' });
    render(<Harness deps={deps} />);
    await act(async () => button().click());
    expect(button().getAttribute('aria-pressed')).toBe('true');
    render(<Harness deps={deps} busy />);
    await flush();
    expect(capture.close).toHaveBeenCalled();
    expect(capture.finish).not.toHaveBeenCalled();
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('input')!.value).toBe('');
  });

  it('si empieza una búsqueda mientras transcribe, el resultado se descarta', async () => {
    let resolve: (r: TranscribeResult) => void = () => {};
    const { deps } = fakeDeps({ status: 'ok', text: 'x' });
    deps.transcribe = vi.fn(() => new Promise<TranscribeResult>((r) => (resolve = r)));
    render(<Harness deps={deps} />);
    await act(async () => button().click());
    await act(async () => button().click());
    await flush();
    render(<Harness deps={deps} busy />);
    await act(async () => resolve({ status: 'ok', text: 'tarde' }));
    expect(container.querySelector('input')!.value).toBe('');
  });

  it('voz apagada en el servidor (off): se explica sin «probá de nuevo» y el micrófono no se ofrece más', async () => {
    const { deps } = fakeDeps({ status: 'error', reason: 'off' });
    render(<Harness deps={deps} />);
    await act(async () => button().click());
    await act(async () => button().click());
    await flush();
    const alert = container.querySelector('[role="alert"] p')?.textContent ?? '';
    expect(alert).toBe(VOICE_TEXTS.off);
    expect(alert).not.toMatch(/prob/i);
    expect(container.querySelector('button.mic')).toBeNull();
    // Dura toda la ejecución: un inicio nuevo tampoco lo muestra.
    act(() => root.render(null));
    render(<Harness deps={deps} />);
    expect(container.querySelector('button.mic')).toBeNull();
  });

  it('ocupado (retryable): el micrófono sigue disponible', async () => {
    const { deps } = fakeDeps({ status: 'error', reason: 'busy' });
    render(<Harness deps={deps} />);
    await act(async () => button().click());
    await act(async () => button().click());
    await flush();
    expect(container.querySelector('[role="alert"] p')?.textContent).toBe(VOICE_TEXTS.busy);
    expect(button()).not.toBeNull();
  });
});

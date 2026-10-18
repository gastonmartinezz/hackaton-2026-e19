// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VOICE_TOGGLE_TEXTS, VoiceToggle } from './TopBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
let command: ReturnType<typeof vi.fn>;
beforeEach(() => {
  command = vi.fn(async () => {});
  (window as unknown as { asistente: unknown }).asistente = { command };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const toggle = () => container.querySelector<HTMLButtonElement>('button.voice-toggle')!;

describe('Interruptor «Voz»', () => {
  it('es un button con aria-pressed y nombre «Voz: leer en voz alta»', () => {
    act(() => root.render(<VoiceToggle active={false} />));
    expect(toggle().tagName).toBe('BUTTON');
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(toggle().textContent).toBe(`${VOICE_TOGGLE_TEXTS.label}${VOICE_TOGGLE_TEXTS.description}`);
  });

  it('apagado: tocarlo lo deja en on; prendido: tocarlo lo deja en off', () => {
    act(() => root.render(<VoiceToggle active={false} />));
    act(() => toggle().click());
    expect(command).toHaveBeenLastCalledWith({ type: 'setVoiceMode', mode: 'on' });
    act(() => root.render(<VoiceToggle active />));
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(toggle().querySelector('.ic')?.getAttribute('aria-hidden')).toBe('true');
    act(() => toggle().click());
    expect(command).toHaveBeenLastCalledWith({ type: 'setVoiceMode', mode: 'off' });
  });

  it('prendido se marca con el ícono Lucide «check» de design/icons (aria-hidden), no con un carácter', () => {
    act(() => root.render(<VoiceToggle active />));
    const icon = toggle().querySelector('.ic');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    const svg = icon?.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('lucide-check');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
    expect(toggle().textContent).not.toMatch(/[✓✔☑]/);
    // El estado lo comunica aria-pressed, no el ícono.
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    act(() => root.render(<VoiceToggle active={false} />));
    expect(toggle().querySelector('.ic')).toBeNull();
  });
});

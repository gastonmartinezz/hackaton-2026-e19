// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrequentSites } from './Home';

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

describe('Opciones rápidas del inicio', () => {
  it('sin sitios guardados no muestra nada', () => {
    act(() => root.render(<FrequentSites sites={[]} />));
    expect(container.innerHTML).toBe('');
  });

  it('cada sitio es un ul > li > button con su nombre y lo abre por su origen', () => {
    const sites = [
      { origin: 'https://agenda.ejemplo.gub.uy', domain: 'agenda.ejemplo.gub.uy' },
      { origin: 'https://www.tiendamac.ejemplo.com.uy', domain: 'tiendamac.ejemplo.com.uy' },
    ];
    act(() => root.render(<FrequentSites sites={sites} />));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('ul > li > button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['agenda.ejemplo.gub.uy', 'tiendamac.ejemplo.com.uy']);
    act(() => buttons[1]!.click());
    expect(command).toHaveBeenLastCalledWith({ type: 'openFrequentSite', origin: 'https://www.tiendamac.ejemplo.com.uy' });
  });
});

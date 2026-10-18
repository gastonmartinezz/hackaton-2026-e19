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

  it('cada sitio es un nav «Lo que hiciste antes» > ul > li > button con su nombre y lo abre por su origen', () => {
    const sites = [
      { origin: 'https://agenda.ejemplo.gub.uy', domain: 'agenda.ejemplo.gub.uy', task: null },
      { origin: 'https://www.tiendamac.ejemplo.com.uy', domain: 'tiendamac.ejemplo.com.uy', task: null },
    ];
    act(() => root.render(<FrequentSites sites={sites} />));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Lo que hiciste antes"] > ul > li > button')];
    // El ícono es decorativo: el nombre accesible es solo el texto visible.
    expect(container.querySelector('.home-recent-icon .ic')?.getAttribute('aria-hidden')).toBe('true');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['agenda.ejemplo.gub.uy', 'tiendamac.ejemplo.com.uy']);
    act(() => buttons[1]!.click());
    expect(command).toHaveBeenLastCalledWith({ type: 'openFrequentSite', origin: 'https://www.tiendamac.ejemplo.com.uy' });
  });

  it('con tarea guardada muestra qué se hizo y deja el dominio en el título', () => {
    act(() => root.render(<FrequentSites sites={[{ origin: 'https://agenda.ejemplo.gub.uy', domain: 'agenda.ejemplo.gub.uy', task: 'Renovar la cédula' }]} />));
    const button = container.querySelector<HTMLButtonElement>('nav[aria-label="Lo que hiciste antes"] ul > li > button')!;
    expect(button.textContent?.trim()).toBe('Renovar la cédula');
    expect(button.title).toBe('agenda.ejemplo.gub.uy');
  });
});

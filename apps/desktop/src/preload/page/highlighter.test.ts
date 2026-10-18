// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { badgePosition, Highlighter, labelPlacement } from './highlighter';

function box(el: Element, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = () => ({ x: 0, y: 0, top: 10, left: 10, width: 100, height: 30, right: 110, bottom: 40, toJSON() {}, ...rect }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = '<input id="a"><button id="b">Horarios</button><button id="c" style="display:none">Oculto</button>';
});

describe('Highlighter', () => {
  it('muestra la indicación sin mover el foco ni interceptar clics', () => {
    const input = document.getElementById('a') as HTMLInputElement;
    const button = document.getElementById('b')!;
    box(button, {});
    input.focus();
    const h = new Highlighter(document);
    expect(h.show(button, { scroll: false })).toBe('shown');
    expect(document.activeElement).toBe(input);
    const host = document.querySelector('[data-asistente-overlay]')!;
    expect(host).not.toBeNull();
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(h.targetPresent()).toBe(true);
    h.clear();
    expect(document.querySelector('[data-asistente-overlay]')).toBeNull();
    expect(h.targetPresent()).toBeNull();
  });

  it('no muestra destinos invisibles y detecta cuando el destino desaparece', () => {
    const h = new Highlighter(document);
    const hidden = document.getElementById('c')!;
    box(hidden, { width: 0, height: 0 });
    expect(h.show(hidden, { scroll: false })).toBe('notVisible');
    const button = document.getElementById('b')!;
    box(button, {});
    h.show(button, { scroll: false });
    button.remove();
    expect(h.targetPresent()).toBe(false);
  });

  it('vuelve a insertarse si la página quitó el overlay', () => {
    const button = document.getElementById('b')!;
    box(button, {});
    const h = new Highlighter(document);
    h.show(button, { scroll: false });
    document.querySelector('[data-asistente-overlay]')!.remove();
    h.show(button, { scroll: false });
    expect(document.querySelectorAll('[data-asistente-overlay]')).toHaveLength(1);
  });
});

describe('labelPlacement', () => {
  const VIEW = { width: 1200, height: 800 };
  const rect = (top: number, right = 200, left = 100) => ({ top, right, left, bottom: top + 30, width: right - left, height: 30 }) as DOMRect;
  it('arriba por defecto, abajo si arriba no entra y al costado en campos', () => {
    const button = document.getElementById('b')!;
    const input = document.getElementById('a')!;
    expect(labelPlacement(button, rect(200), VIEW)).toBe('above');
    expect(labelPlacement(button, rect(20), VIEW)).toBe('below');
    expect(labelPlacement(input, rect(200), VIEW)).toBe('side');
    expect(labelPlacement(input, rect(200, 1180), VIEW)).toBe('above');
  });

  it('nunca tapa texto si hay otro lugar libre; si no, el que menos tapa (R8)', () => {
    const button = document.getElementById('b')!;
    const input = document.getElementById('a')!;
    // Texto encima del control: va abajo aunque arriba entre.
    expect(labelPlacement(button, rect(200), VIEW, (box) => (box.top < 200 ? 3 : 0))).toBe('below');
    // Sin lugar arriba y texto abajo: a la derecha.
    expect(labelPlacement(button, rect(20), VIEW, (box) => (box.top > 50 ? 2 : 0))).toBe('side');
    // Todo tapa algo: el que menos.
    expect(labelPlacement(button, rect(200), VIEW, (box) => (box.left > 200 ? 1 : box.top < 200 ? 4 : 2))).toBe('side');
    // En un campo, a la derecha salvo que tape su etiqueta u otro texto.
    expect(labelPlacement(input, rect(200), VIEW, (box) => (box.left > 200 ? 2 : 0))).toBe('above');
  });

  it('el rótulo nunca se sale de la ventana (abajo ni a la derecha)', () => {
    const button = document.getElementById('b')!;
    const size = { width: 72, height: 36 };
    // Control pegado abajo: arriba, no abajo de la ventana.
    expect(labelPlacement(button, rect(760), VIEW)).toBe('above');
    // Control pegado a la derecha: el rótulo se corre hacia adentro.
    const right = badgePosition('above', rect(300, 1199, 1160), size, VIEW);
    expect(right.left + size.width).toBeLessThanOrEqual(VIEW.width - 4);
    // Control más alto que la ventana: el rótulo queda dentro igual.
    const tall = { top: -50, bottom: 900, left: 100, right: 300, width: 200, height: 950 } as DOMRect;
    const place = labelPlacement(button, tall, VIEW);
    const pos = badgePosition(place, tall, size, VIEW);
    expect(pos.top).toBeGreaterThanOrEqual(4);
    expect(pos.top + size.height).toBeLessThanOrEqual(VIEW.height - 4);
  });
});

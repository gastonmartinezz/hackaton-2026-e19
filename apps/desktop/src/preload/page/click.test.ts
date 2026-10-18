// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clickControl, isClickable } from './click';

beforeEach(() => {
  document.body.innerHTML = '';
});

const el = (selector: string) => document.querySelector(selector) as HTMLElement;
/** happy-dom no calcula tamaños: los controles de la prueba se ven. */
const visible = (element: HTMLElement) => {
  element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 80, height: 30, top: 0, left: 0, right: 80, bottom: 30, toJSON: () => ({}) }) as DOMRect;
  return element;
};

describe('clickControl: tocar el botón por la persona', () => {
  it('toca un botón o enlace habilitado y el sitio recibe el clic', () => {
    document.body.innerHTML = '<button id="b">Continuar</button><a id="a" href="#agenda">Agenda</a><div id="r" role="button">Siguiente</div>';
    for (const id of ['b', 'a', 'r']) {
      const element = visible(el(`#${id}`));
      const onClick = vi.fn();
      element.addEventListener('click', onClick);
      expect(clickControl(element)).toBe('clicked');
      expect(onClick).toHaveBeenCalledOnce();
    }
  });

  it('nunca toca pagar, comprar, transferir o borrar, aunque la IA lo haya marcado', () => {
    document.body.innerHTML = '<button id="p">Pagar $ 1.200</button><input id="c" type="submit" value="Confirmar compra"><button id="d" aria-label="Eliminar cuenta">x</button>';
    for (const id of ['p', 'c', 'd']) {
      const element = visible(el(`#${id}`));
      const onClick = vi.fn();
      element.addEventListener('click', onClick);
      expect(clickControl(element)).toBe('refused');
      expect(onClick).not.toHaveBeenCalled();
    }
  });

  it('no toca lugares para escribir, casilleros, controles deshabilitados ni invisibles', () => {
    document.body.innerHTML = '<input id="t"><input id="k" type="checkbox"><button id="d" disabled>Seguir</button><button id="h">Seguir</button>';
    for (const id of ['t', 'k', 'd']) expect(clickControl(visible(el(`#${id}`)))).toBe('refused');
    expect(isClickable(el('#h'))).toBe(false);
  });
});

// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fillableType, focusField, looksSensitive, writeDictated } from './fill';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  document.body.innerHTML = '';
});

const el = <T extends Element>(selector: string) => document.querySelector(selector) as T;

describe('writeDictated: escribir un dato dictado', () => {
  it('escribe en un lugar de texto, con input y change, marcando que no fue la persona', () => {
    document.body.innerHTML = '<label>Nombre <input id="n"></label>';
    const input = el<HTMLInputElement>('#n');
    const events: Array<{ type: string; writing: boolean }> = [];
    let writing = false;
    for (const type of ['input', 'change']) input.addEventListener(type, () => events.push({ type, writing }));
    expect(writeDictated(input, 'Marta Gómez.', (active) => (writing = active))).toBe('filled');
    expect(input.value).toBe('Marta Gómez');
    expect(document.activeElement).toBe(input);
    // Los eventos salen mientras «writing» está prendido: el observador no los cuenta como de la persona.
    expect(events).toEqual([
      { type: 'input', writing: true },
      { type: 'change', writing: true },
    ]);
    expect(writing).toBe(false);
  });

  it('adapta lo dicho al tipo: correo, teléfono, número y fecha', () => {
    document.body.innerHTML = '<input id="c" type="email"><input id="t" type="tel"><input id="x" type="number"><input id="f" type="date">';
    const noop = () => {};
    writeDictated(el('#c'), 'marta punto gomez arroba gmail punto com', noop);
    writeDictated(el('#t'), '099 123 456', noop);
    writeDictated(el('#x'), '3,5', noop);
    writeDictated(el('#f'), '3 de mayo de 1950', noop);
    expect(el<HTMLInputElement>('#c').value).toBe('marta.gomez@gmail.com');
    expect(el<HTMLInputElement>('#t').value).toBe('099123456');
    expect(el<HTMLInputElement>('#x').value).toBe('3.5');
    expect(el<HTMLInputElement>('#f').value).toBe('1950-05-03');
  });

  it('elige la opción dicha en una lista y, si no está, no toca nada', () => {
    document.body.innerHTML = '<select id="s"><option value="">Elegí una</option><option>Centro</option><option>Norte</option></select>';
    const select = el<HTMLSelectElement>('#s');
    const change = vi.fn();
    select.addEventListener('change', change);
    expect(writeDictated(select, 'la del norte', () => {})).toBe('filled');
    expect(select.value).toBe('Norte');
    expect(change).toHaveBeenCalledOnce();
    expect(writeDictated(select, 'Pocitos', () => {})).toBe('noMatch');
    expect(select.value).toBe('Norte');
  });

  it('nunca escribe en un dato sensible ni donde no corresponde', () => {
    document.body.innerHTML = `
      <input id="p" type="password">
      <input id="d" name="nroDocumento">
      <input id="cc" autocomplete="cc-number">
      <input id="cv" aria-label="Código de seguridad">
      <input id="k" type="checkbox">
      <input id="ro" readonly>
      <button id="b">Enviar</button>`;
    for (const id of ['p', 'd', 'cc', 'cv']) {
      expect(looksSensitive(el(`#${id}`))).toBe(true);
      expect(writeDictated(el(`#${id}`), '1234', () => {})).toBe('refused');
      expect(el<HTMLInputElement>(`#${id}`).value).toBe('');
    }
    for (const id of ['k', 'ro', 'b']) expect(writeDictated(el(`#${id}`), 'sí', () => {})).toBe('refused');
    expect(fillableType(el('#k'))).toBeNull();
  });

  it('una fecha que no se entiende no se escribe', () => {
    document.body.innerHTML = '<input id="f" type="date">';
    expect(writeDictated(el('#f'), 'el martes que viene', () => {})).toBe('noMatch');
    expect(el<HTMLInputElement>('#f').value).toBe('');
  });

  it('un formulario hecho con React registra lo escrito (setter nativo)', () => {
    const seen: string[] = [];
    function Form() {
      const [name, setName] = useState('');
      return (
        <label>
          Nombre
          <input
            id="r"
            value={name}
            onChange={(e) => {
              seen.push(e.target.value);
              setName(e.target.value);
            }}
          />
          <output id="eco">{name}</output>
        </label>
      );
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<Form />));
    act(() => {
      writeDictated(el('#r'), 'Marta Gómez', () => {});
    });
    expect(seen).toEqual(['Marta Gómez']);
    expect(el('#eco').textContent).toBe('Marta Gómez');
    expect(el<HTMLInputElement>('#r').value).toBe('Marta Gómez');
    act(() => root.unmount());
  });
});

describe('focusField: dato sensible', () => {
  it('pone el cursor en el lugar sin escribir nada', () => {
    document.body.innerHTML = '<button id="otro">x</button><input id="p" type="password">';
    el<HTMLButtonElement>('#otro').focus();
    focusField(el('#p'));
    expect(document.activeElement).toBe(el('#p'));
    expect(el<HTMLInputElement>('#p').value).toBe('');
  });
});

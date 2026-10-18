/**
 * Escribir un dato dictado y poner el cursor en un dato sensible (CLAUDE.md
 * §2). Corre en el preload de la página; sin Electron, para poder probarlo.
 * Nunca lee ni informa el valor que ya tenía el lugar.
 */
import { isSensitiveField } from '@asistente/guidance';
import { DICTATABLE_TYPES, dictatedValue, matchListOption } from '../../shared/dictation';
import type { FillResult } from '../../shared/ipc';

/** Tipo de lugar donde Guíame puede escribir lo dictado, o null (botones, casilleros, archivos, sin habilitar). */
export function fillableType(element: Element): string | null {
  const view = element.ownerDocument.defaultView;
  if (!view) return null;
  if (element instanceof view.HTMLSelectElement) return element.multiple || element.disabled ? null : 'select';
  if (element instanceof view.HTMLTextAreaElement) return element.disabled || element.readOnly ? null : 'textarea';
  if (!(element instanceof view.HTMLInputElement) || element.disabled || element.readOnly) return null;
  const type = (element.getAttribute('type') ?? 'text').toLowerCase();
  return DICTATABLE_TYPES.has(type) ? type : null;
}

/** Solo atributos del sitio (tipo, autocomplete, nombre, id, rótulos): nunca el valor. */
export function looksSensitive(element: Element): boolean {
  const attr = (name: string) => element.getAttribute(name) ?? '';
  return isSensitiveField({
    inputType: attr('type'),
    autocomplete: attr('autocomplete'),
    label: [attr('aria-label'), attr('placeholder'), attr('title')].join(' '),
    name: [attr('name'), attr('id')].join(' '),
  });
}

/**
 * Escribe lo dictado como si lo hubiera escrito la persona: el sitio recibe
 * `input` y `change`, y se usa el setter nativo para que los sitios hechos con
 * React u otros marcos lo registren. Nunca en un dato sensible. `writing` se
 * llama con true antes de disparar los eventos y con false después: esos
 * eventos no son de la persona y no avanzan el paso.
 */
export function writeDictated(element: Element, said: string, writing: (active: boolean) => void): FillResult {
  const view = element.ownerDocument.defaultView;
  const type = fillableType(element);
  if (!view || !type || looksSensitive(element)) return 'refused';
  let apply: () => void;
  if (element instanceof view.HTMLSelectElement) {
    const index = matchListOption(said, Array.from(element.options, (option) => option.label || option.text));
    if (index === null) return 'noMatch';
    apply = () => {
      element.selectedIndex = index;
    };
  } else {
    const value = dictatedValue(said, type);
    if (value === null) return 'noMatch';
    const proto = element instanceof view.HTMLTextAreaElement ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    apply = () => Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
  }
  writing(true);
  try {
    (element as HTMLElement).focus({ preventScroll: true });
    apply();
    element.dispatchEvent(new view.Event('input', { bubbles: true }));
    element.dispatchEvent(new view.Event('change', { bubbles: true }));
  } finally {
    writing(false);
  }
  return 'filled';
}

/** Pone el cursor en el lugar para que la persona escriba un dato sensible. */
export function focusField(element: Element): void {
  const view = element.ownerDocument.defaultView;
  if (view && element instanceof view.HTMLElement) element.focus({ preventScroll: true });
}

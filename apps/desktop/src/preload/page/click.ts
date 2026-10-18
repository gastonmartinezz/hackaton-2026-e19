/**
 * Tocar por la persona el botón o enlace señalado, solo después de que ella lo
 * confirmó en la tarjeta (CLAUDE.md §2). Corre en el preload de la página; sin
 * Electron, para poder probarlo. El clic llega al sitio como uno de la persona
 * y el paso avanza por el camino de siempre (el observador lo informa).
 */
import { isIrreversibleAction } from '@asistente/guidance';
import type { ClickResult } from '../../shared/ipc';

/** Botones y enlaces habilitados y visibles. Nunca lugares para escribir, casilleros ni archivos. */
export function isClickable(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view || !(element instanceof view.HTMLElement)) return false;
  if (element.closest('[aria-disabled="true"]') || element.matches(':disabled')) return false;
  const role = element.getAttribute('role');
  const tag = element.localName;
  const kind =
    tag === 'button' ||
    (tag === 'a' && element.hasAttribute('href')) ||
    (tag === 'input' && ['submit', 'button'].includes((element.getAttribute('type') ?? '').toLowerCase())) ||
    role === 'button' ||
    role === 'link';
  if (!kind) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 || box.height > 0;
}

/** Texto visible del control (o su valor si es un botón input): para la barrera de acciones irreversibles. */
function controlText(element: Element): string {
  return [element.textContent, element.getAttribute('aria-label'), element.getAttribute('value'), element.getAttribute('title')].filter(Boolean).join(' ');
}

/** Toca el control si es un botón o enlace y no dice pagar, comprar, transferir, firmar o borrar. */
export function clickControl(element: Element): ClickResult {
  if (!isClickable(element) || isIrreversibleAction(controlText(element))) return 'refused';
  (element as HTMLElement).click();
  return 'clicked';
}

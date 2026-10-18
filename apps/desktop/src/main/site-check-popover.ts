/**
 * Panel de Protección de sitios que flota sobre el sitio (como la tarjeta de
 * ayuda): una vista propia anclada debajo del indicador de la píldora «Estás
 * en». El sitio y la tarjeta no se mueven al abrirlo, cerrarlo ni al expandir
 * «Ver por qué». Al ser una vista nativa encima de las demás, la página no
 * puede taparla, leerla ni imitarla.
 *
 * Muestra el panel (título, frases, acción principal y «Ver por qué») y, si el
 * indicador no entra en la píldora, el indicador mismo, flotando debajo de ella.
 * La vista mide su contenido y lo informa (`siteCheckPopoverLayout`); acá se
 * decide dónde va.
 */
import type { WebContentsView } from 'electron';
import type { SiteCheckLayout, UiCommand } from '../shared/ipc';
import { CARD_GAP, CARD_SHADOW, createOverlayView, type Rect } from './help-card';

/** Margen transparente alrededor del contenido para el halo, igual que la tarjeta. */
export const POPOVER_SHADOW = CARD_SHADOW;
/** Separación entre el panel y la tarjeta de ayuda (separación mínima entre objetivos). */
export const POPOVER_CARD_GAP = 12;

/** Píldora «Estás en» en px de la ventana, e indicador dentro o fuera de ella (lo mide la ventana). */
export interface PopoverAnchor {
  left: number;
  right: number;
  inline: boolean;
}

/** Comandos que acepta el proceso principal desde esta vista: solo los del panel. */
export const POPOVER_COMMANDS: ReadonlySet<UiCommand['type']> = new Set([
  'ready',
  'siteCheckPanel',
  'siteCheckRetry',
  'siteCheckLeave',
  'siteCheckContinue',
  'siteCheckPopoverLayout',
]);

export interface PopoverPlacement {
  /** Contenido sin el halo, en px de la ventana. */
  box: Rect;
  maxWidth: number;
  maxHeight: number;
  /** Cuánto se corre el indicador a la derecha dentro de la vista (SiteCheckLayout.chipOffset). */
  chipOffset: number;
}

/**
 * Ubica el contenido (sin el halo) debajo de la barra. `top` es el alto de la
 * barra: la vista empieza ahí, así nunca tapa el indicador ni los controles.
 *
 * - Indicador en la píldora: el panel cuelga del borde derecho de la píldora
 *   (justo debajo del indicador).
 * - Indicador fuera: el indicador flota debajo del borde izquierdo de la
 *   píldora y el panel, debajo de él.
 *
 * Si el panel tocaría la tarjeta de ayuda (`card`), se corre a la izquierda;
 * el indicador que flota no se mueve. Nunca se sale de la ventana.
 * `panelWidth` es el ancho del panel (el de la tarjeta, R4).
 */
export function placePopover(
  window: { width: number; height: number },
  top: number,
  anchor: PopoverAnchor,
  size: { width: number; height: number },
  options: { card?: Rect | null; panelOpen?: boolean; panelWidth?: number } = {},
): PopoverPlacement {
  const edge = POPOVER_SHADOW;
  const y = top + POPOVER_SHADOW;
  const maxWidth = Math.max(0, window.width - edge * 2);
  const maxHeight = Math.max(0, window.height - y - CARD_GAP);
  const width = Math.min(size.width, maxWidth);
  const height = Math.min(size.height, maxHeight);
  const { card = null, panelOpen = false } = options;
  const panelWidth = Math.min(options.panelWidth ?? width, maxWidth);
  // Borde derecho que el panel no debería pasar para no tocar la tarjeta.
  const limit = card && card.y < y + height && y < card.y + card.height ? card.x - POPOVER_CARD_GAP : Infinity;
  const fit = (x: number, w: number) => Math.max(edge, Math.min(x, window.width - edge - w));

  if (anchor.inline) {
    const x = fit(Math.min(anchor.right, limit) - width, width);
    return { box: { x, y, width, height }, maxWidth, maxHeight, chipOffset: 0 };
  }
  const chipX = fit(anchor.left, 0);
  const panelX = panelOpen ? fit(Math.min(chipX, limit - panelWidth), panelWidth) : chipX;
  const x = Math.min(chipX, panelX);
  return { box: { x, y, width, height }, maxWidth, maxHeight, chipOffset: chipX - x };
}

export class SiteCheckPopoverView {
  readonly view: WebContentsView;
  #size = { width: 0, height: 0 };

  constructor(preloadPath: string) {
    this.view = createOverlayView(preloadPath);
  }

  get contents() {
    return this.view.webContents;
  }

  get visible(): boolean {
    return this.view.getVisible();
  }

  /** Lo que la vista informa después de dibujarse. Devuelve true si cambió algo. */
  report(size: { width: number; height: number }): boolean {
    if (size.width === this.#size.width && size.height === this.#size.height) return false;
    this.#size = { ...size };
    return true;
  }

  /**
   * Ubica la vista. Devuelve los máximos que el contenido tiene que respetar y
   * el corrimiento del indicador (se publican en `AppState.layout.siteCheck`).
   */
  layout(
    window: { width: number; height: number },
    top: number,
    anchor: PopoverAnchor,
    show: boolean,
    options: { card?: Rect | null; panelOpen?: boolean; panelWidth?: number } = {},
  ): Omit<SiteCheckLayout, 'indicatorInline'> {
    const { box, maxWidth, maxHeight, chipOffset } = placePopover(window, top, anchor, this.#size, options);
    if (!show || box.width === 0 || box.height === 0) {
      this.view.setVisible(false);
      return { maxWidth, maxHeight, chipOffset };
    }
    this.view.setBounds({
      x: Math.round(box.x - POPOVER_SHADOW),
      y: Math.round(box.y - POPOVER_SHADOW),
      width: Math.round(box.width + POPOVER_SHADOW * 2),
      height: Math.round(box.height + POPOVER_SHADOW * 2),
    });
    this.view.setVisible(true);
    return { maxWidth, maxHeight, chipOffset };
  }
}

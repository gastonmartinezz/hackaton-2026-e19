/**
 * Tarjeta flotante de ayuda (handoff §4.6). Es una vista propia encima del
 * sitio, como el popup de una extensión: la página no puede taparla, leerla ni
 * imitarla. Fuera de la tarjeta, los clics siguen yendo al sitio.
 *
 * La tarjeta mide su contenido y lo informa (comando `cardLayout`); acá se
 * decide dónde va. Nunca tapa el control resaltado: si lo taparía, baja; si
 * tampoco entra abajo, se achica a una línea (pantalla 12).
 */
import { WebContentsView } from 'electron';
import type { CardLayout, CardMode, TargetRect } from '../shared/ipc';

/** --card-gap de design/tokens.css: distancia al borde de la vista del sitio. */
export const CARD_GAP = 24;
/** Margen transparente alrededor de la tarjeta para que se vea su sombra. */
export const CARD_SHADOW = 16;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class HelpCardView {
  readonly view: WebContentsView;
  #mode: CardMode = 'none';
  #height = 0;
  /** Alto natural de la tarjeta completa, para decidir si entra sin tapar el control. */
  #cardHeight = 0;

  constructor(preloadPath: string) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        spellcheck: true,
      },
    });
    this.view.setBackgroundColor('#00000000');
    this.view.setVisible(false);
    const wc = this.view.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (event) => event.preventDefault());
  }

  get contents() {
    return this.view.webContents;
  }

  /** Lo que la tarjeta informa después de dibujarse. Devuelve true si cambió algo. */
  report({ mode, height }: { mode: CardMode; height: number }): boolean {
    if (mode === this.#mode && height === this.#height) return false;
    this.#mode = mode;
    this.#height = height;
    if (mode === 'card') this.#cardHeight = height;
    return true;
  }

  /**
   * Ubica la vista dentro del área del sitio. `target` es el control resaltado
   * en coordenadas de esa área. Devuelve la disposición que la tarjeta tiene que usar.
   */
  layout(area: Rect, sizes: { cardWidth: number; pillWidth: number }, target: (TargetRect & { field?: boolean }) | null, visible: boolean): CardLayout {
    const width = Math.min(sizes.cardWidth, Math.round(area.width * 0.42));
    const maxHeight = Math.max(0, area.height - CARD_GAP * 2);
    const right = area.x + area.width - CARD_GAP;
    const { placement, top, bottom } = placeCard(area, width, Math.min(this.#cardHeight, maxHeight), target);
    const layout: CardLayout = { placement, maxHeight };

    if (!visible || this.#mode === 'none' || this.#height === 0) {
      this.view.setVisible(false);
      return layout;
    }
    const height = Math.min(this.#height, maxHeight);
    let box: Rect;
    if (this.#mode === 'card') {
      box = { ...(placement === 'bottom' ? bottom : top), height };
    } else {
      // Achicada (12) o aviso al salir (21): una línea abajo a la derecha.
      const pill = Math.min(sizes.pillWidth, Math.round(area.width * 0.6));
      box = { x: right - pill, y: area.y + area.height - CARD_GAP - height, width: pill, height };
    }
    this.view.setBounds({
      x: Math.round(box.x - CARD_SHADOW),
      y: Math.round(box.y - CARD_SHADOW),
      width: Math.round(box.width + CARD_SHADOW * 2),
      height: Math.round(box.height + CARD_SHADOW * 2),
    });
    this.view.setVisible(true);
    return layout;
  }
}

/**
 * Arriba a la derecha; si así tapa el control resaltado, abajo; si también lo
 * tapa, achicada. `target` está en coordenadas del área del sitio.
 */
export function placeCard(area: Rect, width: number, height: number, target: (TargetRect & { field?: boolean }) | null) {
  const right = area.x + area.width - CARD_GAP;
  const top: Rect = { x: right - width, y: area.y + CARD_GAP, width, height };
  const bottom: Rect = { ...top, y: area.y + area.height - CARD_GAP - height };
  // El anillo y el rótulo «Acá» (arriba, o al costado en los campos) también cuentan como parte del control.
  const label = target?.field ? 120 : 0;
  const hit = target ? { x: target.x + area.x - 12, y: target.y + area.y - 56, width: target.width + 24 + label, height: target.height + 68 } : null;
  const placement: CardLayout['placement'] = !hit || !intersects(top, hit) ? 'top' : !intersects(bottom, hit) ? 'bottom' : 'compact';
  return { placement, top, bottom };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Indicación visual dentro de la página (R8). Anillo blanco, borde azul y halo,
 * con el rótulo «Acá», en un shadow root cerrado con estilos propios. No tapa
 * el control, no intercepta clics y no mueve el foco.
 *
 * La página puede interferir con este overlay: nunca se usa como superficie de
 * seguridad ni de confirmación.
 */

// Valores de .g-highlight y .g-highlight__label en design/tokens/tokens.css. La
// página no ve las variables de Guíame (shadow root cerrado), así que se
// repiten acá. Poppins no está en la página: el rótulo cae a la letra del sistema.
const STYLE = `
  :host { all: initial; }
  .frame {
    position: fixed;
    pointer-events: none;
    box-sizing: border-box;
    border-radius: 12px;
    box-shadow: 0 0 0 3px #FFFFFF inset, 0 0 0 4px #1F8BFF, 0 0 0 12px rgba(31, 139, 255, 0.25);
    z-index: 2147483646;
    animation: appear 280ms cubic-bezier(0.2, 0, 0, 1), breathe 900ms ease-in-out 280ms 2;
  }
  .badge {
    position: fixed;
    pointer-events: none;
    z-index: 2147483646;
    font: 600 20px/1.2 "Poppins", "Segoe UI", system-ui, sans-serif;
    color: #FFFFFF;
    background: linear-gradient(135deg, #3BA3FF 0%, #1D4ED8 100%);
    border-radius: 8px;
    padding: 6px 14px;
    box-shadow: 0 0 0 3px #FFFFFF, 0 12px 26px -8px rgba(22, 56, 184, 0.75);
    white-space: nowrap;
  }
  @keyframes appear { from { opacity: 0; } }
  @keyframes breathe { 50% { box-shadow: 0 0 0 3px #FFFFFF inset, 0 0 0 4px #1F8BFF, 0 0 0 18px rgba(31, 139, 255, 0.35); } }
  @media (prefers-reduced-motion: reduce) {
    .frame { animation: none; }
  }
`;

/** Padding de .g-highlight (4) + anillo blanco (3): el anillo queda separado del control. */
const MARGIN = 7;
const BADGE_GAP = 16;
const BADGE_HEIGHT = 36;
const BADGE_WIDTH = 72;

export type HighlightResult = 'shown' | 'notVisible';

export class Highlighter {
  #host: HTMLElement | null = null;
  #frame: HTMLElement | null = null;
  #badge: HTMLElement | null = null;
  #target: Element | null = null;
  #resize: ResizeObserver | null = null;
  #raf = 0;

  constructor(private readonly doc: Document) {}

  get target(): Element | null {
    return this.#target;
  }

  show(target: Element, { scroll }: { scroll: boolean }): HighlightResult {
    if (!isDisplayed(target)) return 'notVisible';
    this.#ensureHost();
    this.#target = target;
    if (scroll) {
      const reduced = this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
    this.#listen();
    this.#position();
    return 'shown';
  }

  clear(): void {
    this.#target = null;
    this.#unlisten();
    this.#host?.remove();
  }

  /** true si el destino actual sigue en el documento y visible. */
  targetPresent(): boolean | null {
    if (!this.#target) return null;
    return this.#target.isConnected && isDisplayed(this.#target);
  }

  #ensureHost(): void {
    if (!this.#host) {
      const host = this.doc.createElement('div');
      host.setAttribute('data-asistente-overlay', '');
      host.setAttribute('aria-hidden', 'true');
      const root = host.attachShadow({ mode: 'closed' });
      const style = this.doc.createElement('style');
      style.textContent = STYLE;
      const frame = this.doc.createElement('div');
      frame.className = 'frame';
      const badge = this.doc.createElement('div');
      badge.className = 'badge';
      badge.textContent = 'Acá';
      root.append(style, frame, badge);
      this.#host = host;
      this.#frame = frame;
      this.#badge = badge;
    }
    // La página puede haberlo quitado; se vuelve a insertar.
    if (!this.#host.isConnected) this.doc.documentElement.append(this.#host);
  }

  #position = (): void => {
    this.#raf = 0;
    const target = this.#target;
    if (!target || !this.#frame || !this.#badge) return;
    if (!target.isConnected || !isDisplayed(target)) {
      this.#frame.style.display = 'none';
      this.#badge.style.display = 'none';
      return;
    }
    const rect = target.getBoundingClientRect();
    Object.assign(this.#frame.style, {
      display: 'block',
      left: `${rect.left - MARGIN}px`,
      top: `${rect.top - MARGIN}px`,
      width: `${rect.width + MARGIN * 2}px`,
      height: `${rect.height + MARGIN * 2}px`,
    });
    // Rótulo (R8): arriba a la izquierda; a la derecha si es un campo (no tapa
    // su etiqueta); abajo si arriba no entra o tapa texto. Nunca tapa texto.
    const view = this.doc.defaultView;
    const size = { width: this.#badge.offsetWidth || BADGE_WIDTH, height: this.#badge.offsetHeight || BADGE_HEIGHT };
    const place = labelPlacement(target, rect, view?.innerWidth ?? Infinity, (box) => coveredContent(this.doc, box), size);
    this.#badge.dataset.place = place;
    const position = badgePosition(place, rect, size);
    Object.assign(this.#badge.style, { display: 'block', left: `${position.left}px`, top: `${position.top}px` });
  };

  #schedule = (): void => {
    const view = this.doc.defaultView;
    if (!view || this.#raf) return;
    this.#raf = view.requestAnimationFrame(this.#position);
  };

  #listen(): void {
    this.#unlisten();
    const view = this.doc.defaultView;
    view?.addEventListener('scroll', this.#schedule, { capture: true, passive: true });
    view?.addEventListener('resize', this.#schedule, { passive: true });
    if (view && 'ResizeObserver' in view && this.#target) {
      this.#resize = new view.ResizeObserver(this.#schedule);
      this.#resize.observe(this.#target);
    }
  }

  #unlisten(): void {
    const view = this.doc.defaultView;
    view?.removeEventListener('scroll', this.#schedule, { capture: true });
    view?.removeEventListener('resize', this.#schedule);
    this.#resize?.disconnect();
    this.#resize = null;
    if (this.#raf) view?.cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }
}

/** Campos de texto y listas: la persona escribe o elige ahí. */
export function isField(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === 'select' || tag === 'textarea') return true;
  if (tag === 'input') return !['submit', 'button', 'reset', 'image', 'checkbox', 'radio'].includes((element as HTMLInputElement).type);
  return element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox' || element.getAttribute('role') === 'combobox';
}

type Placement = 'above' | 'side' | 'below';
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Dónde va el rótulo. En orden de R8 (al costado en campos, arriba, abajo) se
 * elige el primer lugar que entra en la pantalla y no tapa contenido de la
 * página; si todos tapan algo, el que menos tapa. `covered` cuenta cuánto
 * contenido queda debajo de un lugar (sin medirlo, se elige solo por espacio).
 */
export function labelPlacement(
  target: Element,
  rect: DOMRect,
  viewportWidth: number,
  covered: (box: Box) => number = () => 0,
  size = { width: BADGE_WIDTH, height: BADGE_HEIGHT },
): Placement {
  const order: Placement[] = isField(target) ? ['side', 'above', 'below'] : ['above', 'below', 'side'];
  const fits = (place: Placement) => {
    const box = badgePosition(place, rect, size);
    if (place === 'side') return box.left + size.width < viewportWidth;
    return place === 'below' || box.top > 0;
  };
  let best: { place: Placement; score: number } | null = null;
  for (const place of order.filter(fits)) {
    const score = covered({ ...badgePosition(place, rect, size), ...size });
    if (score === 0) return place;
    if (!best || score < best.score) best = { place, score };
  }
  return best?.place ?? 'below';
}

function badgePosition(place: Placement, rect: DOMRect, size: { width: number; height: number }): { left: number; top: number } {
  const position =
    place === 'side'
      ? { left: rect.right + MARGIN + BADGE_GAP, top: rect.top + rect.height / 2 - size.height / 2 }
      : place === 'above'
        ? { left: rect.left - MARGIN, top: rect.top - MARGIN - BADGE_GAP - size.height }
        : { left: rect.left - MARGIN, top: rect.bottom + MARGIN + BADGE_GAP };
  return { left: Math.max(4, position.left), top: position.top };
}

/**
 * Cuántos puntos de una grilla sobre `box` caen en texto o en un control de la
 * página. El overlay no intercepta clics (pointer-events: none), así que no se
 * mide a sí mismo.
 */
function coveredContent(doc: Document, box: Box): number {
  const caret = (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint;
  if (typeof doc.elementFromPoint !== 'function') return 0;
  let hits = 0;
  for (const fx of [0.1, 0.5, 0.9]) {
    for (const fy of [0.2, 0.8]) {
      const x = box.left + box.width * fx;
      const y = box.top + box.height * fy;
      const element = doc.elementFromPoint(x, y);
      if (!element) continue;
      if (element.closest('a, button, input, select, textarea, label, img, svg, video, [role="button"], [role="link"]')) {
        hits++;
        continue;
      }
      const range = caret?.call(doc, x, y);
      const node = range?.startContainer;
      if (node?.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
      const text = doc.createRange();
      text.selectNodeContents(node);
      if ([...text.getClientRects()].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) hits++;
    }
  }
  return hits;
}

function isDisplayed(element: Element): boolean {
  const check = (element as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof check === 'function' && !check.call(element, { checkOpacity: true, checkVisibilityCSS: true })) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

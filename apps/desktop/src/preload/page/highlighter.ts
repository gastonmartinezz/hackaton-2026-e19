/**
 * Indicación visual dentro de la página (S08). Un borde de alto contraste con
 * dos tonos y un rótulo de texto, en un shadow root cerrado con estilos propios.
 * No tapa el control, no intercepta clics y no mueve el foco.
 *
 * La página puede interferir con este overlay: nunca se usa como superficie de
 * seguridad ni de confirmación.
 */

// Valores de --hl-* en design/tokens.css. La página no ve las variables de
// Mostrame (shadow root cerrado), así que se repiten acá.
const STYLE = `
  :host { all: initial; }
  .frame {
    position: fixed;
    pointer-events: none;
    box-sizing: border-box;
    border-radius: 12px;
    box-shadow: 0 0 0 3px #111111 inset, 0 0 0 4px #FFD23F;
    z-index: 2147483646;
    animation: appear 280ms cubic-bezier(0.2, 0, 0, 1), breathe 900ms ease-in-out 280ms 2;
  }
  .badge {
    position: fixed;
    pointer-events: none;
    z-index: 2147483646;
    font: 800 18px/1.3 system-ui, "Segoe UI", sans-serif;
    color: #FFD23F;
    background: #111111;
    border: 2px solid #FFD23F;
    border-radius: 6px;
    padding: 3px 12px;
    white-space: nowrap;
  }
  .badge::after {
    content: "";
    position: absolute;
    border: 9px solid transparent;
  }
  .badge[data-place="above"]::after { left: 16px; top: 100%; border-top-color: #FFD23F; }
  .badge[data-place="below"]::after { left: 16px; bottom: 100%; border-bottom-color: #FFD23F; }
  .badge[data-place="side"]::after { right: 100%; top: 50%; transform: translateY(-50%); border-right-color: #FFD23F; }
  @keyframes appear { from { opacity: 0; } }
  @keyframes breathe { 50% { box-shadow: 0 0 0 3px #111111 inset, 0 0 0 10px rgb(255 210 63 / 0.55); } }
  @media (prefers-reduced-motion: reduce) {
    .frame { animation: none; box-shadow: 0 0 0 3px #111111 inset, 0 0 0 6px #FFD23F; }
  }
`;

/** --hl-gap + --hl-inner-w: el anillo queda separado del control. */
const MARGIN = 7;
const BADGE_GAP = 16;
const BADGE_HEIGHT = 34;
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
    // Rótulo (handoff §4.7): arriba a la izquierda; al costado si es un campo
    // (no tapa su etiqueta); abajo si arriba no entra.
    const view = this.doc.defaultView;
    const place = labelPlacement(target, rect, view?.innerWidth ?? Infinity);
    this.#badge.dataset.place = place;
    const position =
      place === 'side'
        ? { left: rect.right + MARGIN + BADGE_GAP, top: rect.top + rect.height / 2 - BADGE_HEIGHT / 2 }
        : place === 'above'
          ? { left: rect.left - MARGIN, top: rect.top - MARGIN - BADGE_GAP - BADGE_HEIGHT }
          : { left: rect.left - MARGIN, top: rect.bottom + MARGIN + BADGE_GAP };
    Object.assign(this.#badge.style, { display: 'block', left: `${Math.max(4, position.left)}px`, top: `${position.top}px` });
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

export function labelPlacement(target: Element, rect: DOMRect, viewportWidth: number): 'above' | 'side' | 'below' {
  if (isField(target) && rect.right + MARGIN + BADGE_GAP + BADGE_WIDTH < viewportWidth) return 'side';
  return rect.top - MARGIN - BADGE_GAP - BADGE_HEIGHT > 0 ? 'above' : 'below';
}

function isDisplayed(element: Element): boolean {
  const check = (element as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof check === 'function' && !check.call(element, { checkOpacity: true, checkVisibilityCSS: true })) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

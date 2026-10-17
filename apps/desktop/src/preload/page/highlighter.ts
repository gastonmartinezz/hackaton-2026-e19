/**
 * Indicación visual dentro de la página (S08). Un borde de alto contraste con
 * dos tonos y un rótulo de texto, en un shadow root cerrado con estilos propios.
 * No tapa el control, no intercepta clics y no mueve el foco.
 *
 * La página puede interferir con este overlay: nunca se usa como superficie de
 * seguridad ni de confirmación.
 */

const STYLE = `
  :host { all: initial; }
  .frame {
    position: fixed;
    pointer-events: none;
    box-sizing: border-box;
    border: 5px solid #ffbf00;
    outline: 3px solid #000;
    box-shadow: 0 0 0 6px #fff;
    border-radius: 6px;
    z-index: 2147483647;
    animation: pulse 1.6s ease-in-out infinite;
  }
  .badge {
    position: fixed;
    pointer-events: none;
    z-index: 2147483647;
    font: 700 16px/1.2 system-ui, sans-serif;
    color: #000;
    background: #ffbf00;
    border: 2px solid #000;
    border-radius: 4px;
    padding: 2px 8px;
    white-space: nowrap;
  }
  @keyframes pulse { 50% { box-shadow: 0 0 0 10px rgba(255, 255, 255, 0.6); } }
  @media (prefers-reduced-motion: reduce) { .frame { animation: none; } }
`;

const MARGIN = 6;

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
    const above = rect.top - MARGIN - 30 > 0;
    Object.assign(this.#badge.style, {
      display: 'block',
      left: `${Math.max(4, rect.left - MARGIN)}px`,
      top: above ? `${rect.top - MARGIN - 30}px` : `${rect.bottom + MARGIN + 4}px`,
    });
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

function isDisplayed(element: Element): boolean {
  const check = (element as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof check === 'function' && !check.call(element, { checkOpacity: true, checkVisibilityCSS: true })) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

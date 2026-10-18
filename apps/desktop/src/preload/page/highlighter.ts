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
  /* Velo del sitio (R9, .g-site-veil v2.3): parejo, con un hueco en el control resaltado. */
  .veil {
    position: fixed;
    inset: 0;
    pointer-events: none;
    background: rgba(11, 27, 63, 0.12);
    z-index: 2147483645;
  }
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
/** Separación mínima del rótulo con los bordes de la ventana. */
const EDGE = 4;
/** Espera después del último desplazamiento antes de volver a medir. */
const SETTLE_MS = 150;

export type HighlightResult = 'shown' | 'notVisible';

export class Highlighter {
  #host: HTMLElement | null = null;
  #frame: HTMLElement | null = null;
  #badge: HTMLElement | null = null;
  #veil: HTMLElement | null = null;
  /** La tarjeta de ayuda está abierta o achicada: el sitio lleva velo (R9). */
  #veiled = false;
  #target: Element | null = null;
  #resize: ResizeObserver | null = null;
  #raf = 0;
  /** Lugar del rótulo elegido midiendo la página; mientras se desplaza solo se verifica que siga entrando. */
  #place: Placement | null = null;
  #settle: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly doc: Document) {}

  get target(): Element | null {
    return this.#target;
  }

  show(target: Element, { scroll }: { scroll: boolean }): HighlightResult {
    if (!isDisplayed(target)) return 'notVisible';
    this.#ensureHost();
    this.#target = target;
    this.#place = null;
    if (scroll) {
      const reduced = this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
    this.#listen();
    this.#position(true);
    return 'shown';
  }

  clear(): void {
    this.#target = null;
    this.#unlisten();
    if (!this.#veiled) {
      this.#host?.remove();
      return;
    }
    // Sin resaltado, el velo queda parejo (sin hueco).
    if (this.#frame) this.#frame.style.display = 'none';
    if (this.#badge) this.#badge.style.display = 'none';
    this.#placeVeil(null);
  }

  /** Prende o apaga el velo del sitio. Nunca recibe clics (pointer-events: none). */
  setVeil(on: boolean): void {
    this.#veiled = on;
    if (on) {
      this.#ensureHost();
      this.#placeVeil(this.#target && this.#target.isConnected && isDisplayed(this.#target) ? this.#target.getBoundingClientRect() : null);
    } else if (this.#veil) {
      this.#veil.style.display = 'none';
      if (!this.#target) this.#host?.remove();
    }
  }

  /** El control resaltado (con su anillo) queda fuera del velo: «lo único que sube por encima» (R9). */
  #placeVeil(rect: DOMRect | null): void {
    if (!this.#veil) return;
    if (!this.#veiled) {
      this.#veil.style.display = 'none';
      return;
    }
    this.#veil.style.display = 'block';
    if (!rect) {
      this.#veil.style.clipPath = '';
      return;
    }
    const [l, t, r, b] = [rect.left - MARGIN, rect.top - MARGIN, rect.right + MARGIN, rect.bottom + MARGIN].map((n) => `${Math.round(n)}px`);
    this.#veil.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l} ${t}, ${r} ${t}, ${r} ${b}, ${l} ${b}, ${l} ${t})`;
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
      const veil = this.doc.createElement('div');
      veil.className = 'veil';
      veil.style.display = 'none';
      const frame = this.doc.createElement('div');
      frame.className = 'frame';
      const badge = this.doc.createElement('div');
      badge.className = 'badge';
      badge.textContent = 'Acá';
      root.append(style, veil, frame, badge);
      this.#host = host;
      this.#veil = veil;
      this.#frame = frame;
      this.#badge = badge;
    }
    // La página puede haberlo quitado; se vuelve a insertar.
    if (!this.#host.isConnected) this.doc.documentElement.append(this.#host);
  }

  /**
   * Ubica el anillo y el rótulo. Medir qué contenido tapa el rótulo fuerza
   * layout: se hace al mostrar y cuando la página deja de moverse, no en cada
   * cuadro del desplazamiento.
   */
  #position(measure: boolean): void {
    const target = this.#target;
    if (!target || !this.#frame || !this.#badge) return;
    if (!target.isConnected || !isDisplayed(target)) {
      this.#frame.style.display = 'none';
      this.#badge.style.display = 'none';
      this.#placeVeil(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    this.#placeVeil(rect);
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
    const viewport = { width: view?.innerWidth ?? Infinity, height: view?.innerHeight ?? Infinity };
    const size = { width: this.#badge.offsetWidth || BADGE_WIDTH, height: this.#badge.offsetHeight || BADGE_HEIGHT };
    if (measure) this.#place = labelPlacement(target, rect, viewport, (box) => coveredContent(this.doc, box), size);
    else if (!this.#place || !placementFits(this.#place, rect, size, viewport)) this.#place = labelPlacement(target, rect, viewport, undefined, size);
    this.#badge.dataset.place = this.#place;
    const position = badgePosition(this.#place, rect, size, viewport);
    Object.assign(this.#badge.style, { display: 'block', left: `${position.left}px`, top: `${position.top}px` });
  }

  #frameUpdate = (): void => {
    this.#raf = 0;
    this.#position(false);
  };

  #schedule = (): void => {
    const view = this.doc.defaultView;
    if (!view) return;
    if (!this.#raf) this.#raf = view.requestAnimationFrame(this.#frameUpdate);
    // Cuando la página deja de moverse, se vuelve a medir qué tapa el rótulo.
    clearTimeout(this.#settle);
    this.#settle = setTimeout(() => this.#position(true), SETTLE_MS);
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
    clearTimeout(this.#settle);
    this.#settle = undefined;
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
interface Size {
  width: number;
  height: number;
}
interface Viewport {
  width: number;
  height: number;
}

/**
 * Dónde va el rótulo. En orden de R8 (al costado en campos, arriba, abajo) se
 * elige el primer lugar que entra entero en la ventana y no tapa contenido de
 * la página; si todos tapan algo, el que menos tapa. `covered` cuenta cuánto
 * contenido queda debajo de un lugar (sin medirlo, se elige solo por espacio).
 * Si ningún lugar entra, el de arriba o el de abajo, según dónde haya más lugar.
 */
export function labelPlacement(
  target: Element,
  rect: DOMRect,
  viewport: Viewport,
  covered: (box: Box) => number = () => 0,
  size: Size = { width: BADGE_WIDTH, height: BADGE_HEIGHT },
): Placement {
  const order: Placement[] = isField(target) ? ['side', 'above', 'below'] : ['above', 'below', 'side'];
  let best: { place: Placement; score: number } | null = null;
  for (const place of order.filter((p) => placementFits(p, rect, size, viewport))) {
    const score = covered({ ...badgePosition(place, rect, size, viewport), ...size });
    if (score === 0) return place;
    if (!best || score < best.score) best = { place, score };
  }
  return best?.place ?? (rect.top > viewport.height - rect.bottom ? 'above' : 'below');
}

/**
 * El rótulo entra entero en la ventana en ese lugar. Al costado alcanza con
 * que entre a lo ancho: su altura se acomoda dentro de la ventana (badgePosition).
 */
export function placementFits(place: Placement, rect: DOMRect, size: Size, viewport: Viewport): boolean {
  const { left, top } = rawPosition(place, rect, size);
  if (place === 'side') return left + size.width <= viewport.width - EDGE;
  return top >= EDGE && top + size.height <= viewport.height - EDGE;
}

/** Posición en la ventana; arriba y abajo se corren para no salirse por los costados. */
export function badgePosition(place: Placement, rect: DOMRect, size: Size, viewport: Viewport): { left: number; top: number } {
  const { left, top } = rawPosition(place, rect, size);
  const clamp = (value: number, max: number) => Math.max(EDGE, Math.min(value, max - EDGE));
  return { left: clamp(left, viewport.width - size.width), top: clamp(top, viewport.height - size.height) };
}

function rawPosition(place: Placement, rect: DOMRect, size: Size): { left: number; top: number } {
  if (place === 'side') return { left: rect.right + MARGIN + BADGE_GAP, top: rect.top + rect.height / 2 - size.height / 2 };
  if (place === 'above') return { left: rect.left - MARGIN, top: rect.top - MARGIN - BADGE_GAP - size.height };
  return { left: rect.left - MARGIN, top: rect.bottom + MARGIN + BADGE_GAP };
}

const CONTENT = 'a, button, input, select, textarea, label, img, svg, video, canvas, iframe, frame, [role="button"], [role="link"], [contenteditable="true"]';

/**
 * Cuántos puntos de una grilla de 5 × 3 sobre `box` caen en texto o en un
 * control de la página (separados menos que una línea de texto). Entra en los
 * shadow roots abiertos; un iframe o un componente con shadow root cerrado
 * cuenta como contenido. El overlay no intercepta clics (pointer-events: none),
 * así que no se mide a sí mismo.
 */
function coveredContent(doc: Document, box: Box): number {
  if (typeof doc.elementFromPoint !== 'function') return 0;
  let hits = 0;
  for (const fx of [0.08, 0.3, 0.5, 0.7, 0.92]) {
    for (const fy of [0.15, 0.5, 0.85]) {
      const x = box.left + box.width * fx;
      const y = box.top + box.height * fy;
      const element = deepElementFromPoint(doc, x, y);
      if (element && (element.closest(CONTENT) || isOpaqueComponent(element) || hasTextAt(doc, element, x, y))) hits++;
    }
  }
  return hits;
}

function deepElementFromPoint(doc: Document, x: number, y: number): Element | null {
  let element = doc.elementFromPoint(x, y);
  while (element?.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }
  return element;
}

/** Componente con shadow root cerrado: no se puede mirar adentro, se trata como contenido. */
function isOpaqueComponent(element: Element): boolean {
  return element.localName.includes('-') && !element.shadowRoot;
}

/** El punto cae sobre un texto propio del elemento (sus nodos de texto, no los de sus hijos). */
function hasTextAt(doc: Document, element: Element, x: number, y: number): boolean {
  for (const node of element.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    if ([...range.getClientRects()].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return true;
  }
  return false;
}

function isDisplayed(element: Element): boolean {
  const check = (element as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof check === 'function' && !check.call(element, { checkOpacity: true, checkVisibilityCSS: true })) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

/**
 * Observación de cambios e interacciones (S09). Agrupa mutaciones con debounce
 * para no generar una llamada por cambio. Los eventos de formularios solo
 * informan qué control se usó, nunca su contenido.
 */

const EVENTS = ['click', 'change', 'input', 'submit'];
const ATTRIBUTES = ['disabled', 'aria-disabled', 'hidden', 'aria-hidden', 'aria-expanded', 'aria-invalid', 'open', 'class', 'style'];

export interface ObserverCallbacks {
  /** structural: se agregaron o quitaron elementos (no solo atributos). */
  onChange(structural: boolean): void;
  onInteraction(target: Element): void;
  onValidationError(): void;
}

/**
 * `class` y `style` se observan para saber si el destino resaltado dejó de
 * verse. Sin destino resaltado, un cambio solo de atributos (animaciones,
 * spinners) no le interesa al proceso principal y no se informa.
 */
export function isRelevantChange(structural: boolean, targetPresent: boolean | null): boolean {
  return structural || targetPresent !== null;
}

export function observePage(doc: Document, callbacks: ObserverCallbacks, { debounceMs = 700, maxWaitMs = 2500 } = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstPending = 0;
  let structural = false;

  const flush = () => {
    timer = undefined;
    firstPending = 0;
    const wasStructural = structural;
    structural = false;
    callbacks.onChange(wasStructural);
  };

  const schedule = () => {
    const now = Date.now();
    if (!firstPending) firstPending = now;
    if (timer) clearTimeout(timer);
    const wait = Math.max(0, Math.min(debounceMs, firstPending + maxWaitMs - now));
    timer = setTimeout(flush, wait);
  };

  const isOwnOverlay = (node: Node | null): boolean => {
    const element = node instanceof Element ? node : (node?.parentElement ?? null);
    return element?.closest('[data-asistente-overlay]') != null;
  };
  const isRelevant = (record: MutationRecord): boolean => {
    if (isOwnOverlay(record.target)) return false;
    if (record.type !== 'childList') return true;
    return [...record.addedNodes, ...record.removedNodes].some((node) => !isOwnOverlay(node));
  };

  const mutations = new MutationObserver((records) => {
    const relevant = records.filter(isRelevant);
    if (relevant.length === 0) return;
    if (relevant.some((r) => r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1))) {
      structural = true;
    }
    schedule();
  });
  mutations.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRIBUTES });

  const onInteraction = (event: Event) => {
    const target = event.composedPath()[0];
    if (target instanceof Element && !isOwnOverlay(target)) callbacks.onInteraction(target);
  };
  const onInvalid = () => callbacks.onValidationError();

  for (const type of EVENTS) doc.addEventListener(type, onInteraction, { capture: true, passive: true });
  doc.addEventListener('invalid', onInvalid, { capture: true, passive: true });

  return () => {
    mutations.disconnect();
    if (timer) clearTimeout(timer);
    for (const type of EVENTS) doc.removeEventListener(type, onInteraction, { capture: true });
    doc.removeEventListener('invalid', onInvalid, { capture: true });
  };
}

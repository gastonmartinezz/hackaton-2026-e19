/**
 * Extracción local de la página (S04). Corre dentro del preload aislado de la
 * vista del sitio. Construye el snapshot por lista de campos permitidos: nunca
 * lee `.value`, opciones seleccionadas, cookies ni almacenamiento.
 */
import { sanitizeLabel, sanitizeOrigin } from '@asistente/privacy';
import { SNAPSHOT_LIMITS as LIMITS, type PageElement, type PageSnapshot } from './snapshot';

export * from './snapshot';

export interface ExtractOptions {
  pageId: string;
  navigationId: string;
  revision: number;
  maxElements?: number;
  /**
   * Registro de la extracción anterior. Si es de la misma navegación, los nodos
   * que siguen presentes conservan su ID, así las opciones siguen siendo válidas.
   */
  previous?: ElementRegistry | undefined;
}

export type UnsupportedNote = 'frames' | 'canvas' | 'truncated' | 'closedShadowSuspected';

export interface ExtractResult {
  snapshot: PageSnapshot;
  registry: ElementRegistry;
  notes: UnsupportedNote[];
}

/** Mapa local id → nodo. Los IDs no salen nunca acompañados de selectores. */
export class ElementRegistry {
  readonly #byId = new Map<string, Element>();
  readonly #byElement = new Map<Element, string>();

  constructor(
    readonly navigationId: string,
    readonly revision: number,
    /** Último número usado para IDs `el-N` en esta navegación. */
    public counter = 0,
  ) {}

  set(id: string, element: Element): void {
    this.#byId.set(id, element);
    this.#byElement.set(element, id);
  }

  /** Devuelve el nodo solo si sigue conectado al documento. */
  resolve(id: string): Element | undefined {
    const element = this.#byId.get(id);
    return element?.isConnected ? element : undefined;
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  exactIdOf(element: Element): string | undefined {
    return this.#byElement.get(element);
  }

  /** ID del elemento registrado más cercano que contiene al nodo (incluido él mismo). */
  idOf(node: Element): string | undefined {
    let current: Element | null = node;
    while (current) {
      const id = this.#byElement.get(current);
      if (id) return id;
      current = parentComposed(current);
    }
    return undefined;
  }

  get size(): number {
    return this.#byId.size;
  }
}

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="option"]',
].join(',');

const STRUCTURE_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  '[role="heading"]',
  'main',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'search',
  '[role="main"]',
  '[role="navigation"]',
  '[role="search"]',
  '[role="form"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[role="region"][aria-label]',
  '[role="region"][aria-labelledby]',
  '[role="dialog"]',
  '[role="alert"]',
].join(',');

const SECTION_ROLES = new Set([
  'main',
  'navigation',
  'search',
  'form',
  'banner',
  'contentinfo',
  'complementary',
  'region',
  'dialog',
]);

/** Roles cuya etiqueta es imprescindible para que el elemento sea útil. */
const NEEDS_LABEL = new Set(['link', 'button', 'heading', 'menuitem', 'tab', 'option']);

const INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'tel',
  'url',
  'number',
  'password',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'checkbox',
  'radio',
  'file',
  'range',
  'color',
  'submit',
  'button',
  'reset',
  'image',
]);

const FORM_CONTROL = 'input,select,textarea,button,[contenteditable]:not([contenteditable="false"])';

/** Roles cuyo texto propio puede ser lo que la persona escribió. */
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);

export function extractSnapshot(doc: Document, options: ExtractOptions): ExtractResult {
  const maxElements = Math.min(options.maxElements ?? LIMITS.elements, LIMITS.elements);
  const previous = options.previous?.navigationId === options.navigationId ? options.previous : undefined;
  const registry = new ElementRegistry(options.navigationId, options.revision, previous?.counter ?? 0);
  const notes = new Set<UnsupportedNote>();

  const candidates: Array<{ element: Element; role: string; priority: boolean }> = [];
  for (const element of walk(doc)) {
    if (element.matches('iframe,frame,object,embed') && isVisible(element)) notes.add('frames');
    if (element.matches('canvas') && isVisible(element) && isLarge(element)) notes.add('canvas');
    if (isCustomElementWithoutShadow(element)) notes.add('closedShadowSuspected');

    if (!element.matches(INTERACTIVE_SELECTOR) && !element.matches(STRUCTURE_SELECTOR)) continue;
    if (!isVisible(element)) continue;
    const role = roleOf(element);
    if (!role) continue;
    candidates.push({ element, role, priority: SECTION_ROLES.has(role) || role === 'heading' || inPriorityRegion(element) });
  }

  let selected = candidates;
  if (candidates.length > maxElements) {
    notes.add('truncated');
    const keep = new Set<Element>();
    for (const c of candidates) if (c.priority && keep.size < maxElements) keep.add(c.element);
    for (const c of candidates) if (!c.priority && keep.size < maxElements) keep.add(c.element);
    selected = candidates.filter((c) => keep.has(c.element));
  }

  const elementIds = new Map<Element, string>();
  const elements: PageElement[] = [];
  for (const { element, role } of selected) {
    const label = sanitizeLabel(accessibleName(element, role), LIMITS.labelLength);
    if (!label && NEEDS_LABEL.has(role)) continue;

    const id = previous?.exactIdOf(element) ?? `el-${++registry.counter}`;
    elementIds.set(element, id);
    registry.set(id, element);

    const entry: PageElement = { id, role, label, enabled: isEnabled(element) };
    const inputType = inputTypeOf(element);
    if (inputType) entry.inputType = inputType;
    const sectionId = nearestSectionId(element, elementIds);
    if (sectionId) entry.sectionId = sectionId;
    elements.push(entry);
  }

  const origin = sanitizeOrigin(doc.location?.href ?? '') ?? 'https://invalid.local';
  const snapshot: PageSnapshot = {
    pageId: options.pageId,
    navigationId: options.navigationId,
    revision: options.revision,
    origin,
    extraction: notes.size > 0 ? 'partial' : 'complete',
    elements,
  };
  return { snapshot, registry, notes: [...notes] };
}

/** Recorre el documento en orden, entrando en shadow roots abiertos. */
function* walk(doc: Document): Generator<Element> {
  const stack: Element[] = doc.documentElement ? [doc.documentElement] : [];
  const pushChildren = (node: ParentNode) => {
    const children = Array.from(node.children);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  };
  while (stack.length > 0) {
    const element = stack.pop()!;
    if (element.matches('script,style,template,noscript,[data-asistente-overlay]')) continue;
    if (element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('inert')) continue;
    yield element;
    if (element.shadowRoot) {
      // Con shadow root, lo visible es su árbol más los hijos asignados a un <slot>.
      const slotted = Array.from(element.children).filter((child) => child.assignedSlot);
      for (let i = slotted.length - 1; i >= 0; i--) stack.push(slotted[i]!);
      pushChildren(element.shadowRoot);
    } else {
      pushChildren(element);
    }
  }
}

function isVisible(element: Element): boolean {
  if ((element as HTMLElement).hidden) return false;
  const check = (element as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof check === 'function') {
    return check.call(element, { checkOpacity: true, checkVisibilityCSS: true });
  }
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  return !style || (style.display !== 'none' && style.visibility !== 'hidden');
}

function isLarge(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width * rect.height > 40_000;
}

/** Un custom element grande, sin hijos ni shadow root abierto, suele tener shadow DOM cerrado. */
function isCustomElementWithoutShadow(element: Element): boolean {
  if (!element.localName.includes('-') || element.shadowRoot || element.children.length > 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width >= 80 && rect.height >= 24;
}

function inPriorityRegion(element: Element): boolean {
  return closestComposed(element, 'main,[role="main"],form,[role="form"],search,[role="search"],[role="dialog"]') !== null;
}

function closestComposed(element: Element, selector: string): Element | null {
  let current: Element | null = element;
  while (current) {
    if (current.matches(selector)) return current;
    current = parentComposed(current);
  }
  return null;
}

function parentComposed(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function nearestSectionId(element: Element, ids: Map<Element, string>): string | undefined {
  let current = parentComposed(element);
  while (current) {
    const id = ids.get(current);
    if (id) {
      const role = roleOf(current);
      if (role && SECTION_ROLES.has(role)) return id;
    }
    current = parentComposed(current);
  }
  return undefined;
}

function roleOf(element: Element): string | undefined {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0]?.toLowerCase();
  if (explicit && explicit !== 'presentation' && explicit !== 'none' && /^[a-z]+$/.test(explicit)) return explicit;

  const tag = element.localName;
  switch (tag) {
    case 'a':
      return element.hasAttribute('href') ? 'link' : undefined;
    case 'button':
    case 'summary':
      return 'button';
    case 'select':
      return (element as HTMLSelectElement).multiple || Number(element.getAttribute('size')) > 1 ? 'listbox' : 'combobox';
    case 'textarea':
      return 'textbox';
    case 'input': {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
      return 'textbox';
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'main':
      return 'main';
    case 'nav':
      return 'navigation';
    case 'search':
      return 'search';
    case 'header':
      return 'banner';
    case 'footer':
      return 'contentinfo';
    case 'aside':
      return 'complementary';
    case 'form':
      return 'form';
    default:
      return undefined;
  }
}

function inputTypeOf(element: Element): string | undefined {
  if (element.localName === 'textarea') return 'textarea';
  if (element.localName === 'select') return 'select';
  if (element.localName !== 'input') return undefined;
  const type = (element.getAttribute('type') ?? 'text').toLowerCase();
  return INPUT_TYPES.has(type) ? type : 'text';
}

function isEnabled(element: Element): boolean {
  if (closestComposed(element, '[aria-disabled="true"]')) return false;
  try {
    return !element.matches(':disabled');
  } catch {
    return !element.hasAttribute('disabled');
  }
}

/**
 * Nombre accesible simplificado. Orden: aria-labelledby, aria-label, <label>,
 * texto propio (sin descender en controles), alt, title, placeholder.
 */
function accessibleName(element: Element, role: string): string {
  const doc = element.getRootNode() as Document | ShadowRoot;

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById?.(id) ?? element.ownerDocument.getElementById(id))
      .filter((node): node is HTMLElement => node !== null)
      .map((node) => visibleText(node))
      .join(' ')
      .trim();
    if (text) return text;
  }

  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;

  if (element.matches('input,select,textarea')) {
    const id = element.getAttribute('id');
    const forLabel = id ? (doc.querySelector?.(`label[for="${cssEscape(id)}"]`) ?? null) : null;
    const wrapping = element.closest('label');
    const label = forLabel ?? wrapping;
    if (label) {
      const text = visibleText(label).trim();
      if (text) return text;
    }
    const type = (element.getAttribute('type') ?? '').toLowerCase();
    // El atributo value de un botón submit es su texto visible, escrito por el sitio,
    // no un dato ingresado por la persona. Para cualquier otro tipo nunca se lee.
    if (['submit', 'button', 'reset'].includes(type)) {
      return element.getAttribute('value') ?? (type === 'submit' ? 'Enviar' : '');
    }
    if (type === 'image') return element.getAttribute('alt') ?? '';
  } else if (!SECTION_ROLES.has(role) && !EDITABLE_ROLES.has(role) && !(element as HTMLElement).isContentEditable) {
    const text = visibleText(element).trim();
    if (text) return text;
  }

  return (
    element.getAttribute('title')?.trim() ||
    element.getAttribute('placeholder')?.trim() ||
    element.querySelector('img[alt]')?.getAttribute('alt')?.trim() ||
    ''
  );
}

/** Texto visible del nodo sin entrar en controles de formulario (evita valores). */
function visibleText(root: Element): string {
  const parts: string[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.matches(FORM_CONTROL) && node !== root) return;
    if (node.matches('script,style,template,[aria-hidden="true"]')) return;
    if (node.localName === 'img') {
      parts.push(` ${node.getAttribute('alt') ?? ''} `);
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
    if (node.shadowRoot) for (const child of Array.from(node.shadowRoot.childNodes)) visit(child);
  };
  for (const child of Array.from(root.childNodes)) visit(child);
  return parts.join(' ').replace(/\s+/g, ' ');
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

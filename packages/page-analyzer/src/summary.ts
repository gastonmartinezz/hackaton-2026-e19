/**
 * Resumen de la página para la protección de sitios (POST /v1/site-check).
 * Corre en el preload aislado de la vista del sitio. Igual que el snapshot,
 * se arma por lista de campos permitidos: nunca lee `.value`, opciones
 * seleccionadas, `checked`, cookies ni almacenamiento, ni el texto editable.
 */
import { isPersonalizedText, redactText, sanitizeLabel, sanitizeLinkText, sanitizeTitle, sanitizeUrl } from '@asistente/privacy';
import { SiteCheckLimits, type PageForm, type PageFormField, type PageLink, type PageSummary } from '@hackaton/contracts';
import { isVisible, visibleText, walk } from './index';

/** Bloques de texto: el texto se agrupa y se depura por bloque, no por nodo suelto. */
const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'dd', 'dt', 'td', 'th', 'caption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header',
  'footer', 'main', 'aside', 'nav', 'blockquote', 'pre', 'figcaption', 'legend', 'label', 'summary', 'details', 'form',
  'body', 'dialog', 'address', 'button', 'a',
]);
const EDITABLE = 'input,select,textarea,option,[contenteditable]:not([contenteditable="false"])';
const FIELD_TAGS = new Set(['input', 'select', 'textarea']);
const BUTTON_TYPES = new Set(['submit', 'button', 'reset', 'image']);
const MAX_VISITED = 20_000;
const MAX_BLOCK = 400;

const INPUT_TYPE_MAP: Record<string, PageFormField['type']> = {
  text: 'text',
  email: 'email',
  password: 'password',
  tel: 'tel',
  number: 'number',
  date: 'date',
  'datetime-local': 'date',
  month: 'date',
  week: 'date',
  time: 'other',
  search: 'search',
  url: 'url',
  hidden: 'hidden',
  file: 'file',
  checkbox: 'checkbox',
  radio: 'radio',
};

export function extractPageSummary(doc: Document): PageSummary {
  const blocks = new Map<Element, string[]>();
  const fields: Element[] = [];
  const anchors: Element[] = [];
  let visited = 0;

  for (const element of walk(doc)) {
    if (++visited > MAX_VISITED) break;
    const tag = element.localName;
    if (FIELD_TAGS.has(tag)) fields.push(element);
    else if (tag === 'a' && element.hasAttribute('href')) anchors.push(element);
    collectText(element, blocks);
  }

  const summary: PageSummary = {
    text: joinBlocks(blocks),
    forms: summarizeForms(doc, fields),
    links: summarizeLinks(doc, anchors),
  };
  const title = sanitizeTitle(doc.title ?? '', 200);
  if (title) summary.title = title;
  const language = doc.documentElement?.getAttribute('lang')?.trim();
  if (language && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(language) && language.length <= 10) summary.language = language;
  const brand = declaredBrand(doc);
  if (brand) summary.declaredBrand = brand;
  return summary;
}

/**
 * Huella de lo que importa para reanalizar: identidad declarada y estructura de
 * los formularios (tipos de campo, método y host de destino). No incluye texto
 * escrito por la persona ni sale del equipo.
 */
export function pageSignature(doc: Document): string {
  const parts = [doc.title ?? '', declaredBrand(doc) ?? ''];
  const controls = Array.from(doc.querySelectorAll('input,select,textarea'));
  for (const form of summarizeForms(doc, controls)) {
    const host = form.action ? new URL(form.action).host : '';
    parts.push(`${form.method}>${host}:${form.fields.map((f) => `${f.type}/${f.autocomplete ?? ''}`).join(',')}`);
  }
  return hash(parts.join('|'));
}

/* --------------------------------- Texto --------------------------------- */

function collectText(element: Element, blocks: Map<Element, string[]>): void {
  if (!BLOCK_TAGS.has(element.localName) || isEditable(element)) return;
  const parts: string[] = [];
  inlineText(element, parts, true);
  const text = parts.join('').replace(/\s+/g, ' ').trim();
  if (text && isVisible(element)) blocks.set(element, [text]);
}

function isEditable(element: Element): boolean {
  return element.matches(EDITABLE) || (element as HTMLElement).isContentEditable;
}

/** Texto en orden del bloque, sin entrar en bloques anidados (tienen el suyo), controles ni ocultos. */
function inlineText(node: Node, parts: string[], isRoot = false): void {
  if (node.nodeType === 3) {
    parts.push(node.textContent ?? '');
    return;
  }
  if (!(node instanceof Element)) return;
  if (!isRoot) {
    if (BLOCK_TAGS.has(node.localName) || isEditable(node)) {
      parts.push(' ');
      return;
    }
    if (node.matches('script,style,template,noscript,[aria-hidden="true"],[inert],[data-asistente-overlay]')) return;
    if (node.localName === 'img') {
      parts.push(` ${node.getAttribute('alt') ?? ''} `);
      return;
    }
    if (!isVisible(node)) return;
  }
  const children = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
  for (const child of Array.from(children)) inlineText(child, parts);
}

/** Depura cada bloque por separado (una credencial oculta el resto de su bloque, no de la página). */
function joinBlocks(blocks: Map<Element, string[]>): string {
  const out: string[] = [];
  let length = 0;
  for (const parts of blocks.values()) {
    const redacted = redactText(parts.join(' '), { maxLength: MAX_BLOCK });
    if (!redacted || isPersonalizedText(redacted)) continue;
    if (length + redacted.length + 1 > SiteCheckLimits.maxTextLength) break;
    out.push(redacted);
    length += redacted.length + 1;
  }
  return out.join('\n');
}

/* ------------------------------ Formularios ------------------------------ */

function summarizeForms(doc: Document, controls: Element[]): PageForm[] {
  const groups = new Map<HTMLFormElement | null, Element[]>();
  for (const control of controls) {
    const type = (control.getAttribute('type') ?? '').toLowerCase();
    if (control.localName === 'input' && BUTTON_TYPES.has(type)) continue;
    const owner = (control as HTMLInputElement).form ?? (control.closest('form') as HTMLFormElement | null);
    const list = groups.get(owner);
    if (list) list.push(control);
    else groups.set(owner, [control]);
  }
  const forms: Array<PageForm & { score: number }> = [];
  for (const [form, list] of groups) {
    // Los campos visibles primero; los ocultos solo cuentan si queda lugar.
    const ordered = [...list.filter((c) => fieldType(c) !== 'hidden'), ...list.filter((c) => fieldType(c) === 'hidden')];
    const fields = ordered.slice(0, SiteCheckLimits.maxFieldsPerForm).map(summarizeField);
    const score = fields.filter((f) => f.type === 'password' || /cc-|password|one-time-code/.test(f.autocomplete ?? '')).length;
    forms.push({ method: methodOf(form), action: actionOf(doc, form), fields, score });
  }
  // Los formularios que piden datos sensibles nunca quedan afuera por el tope.
  return forms
    .map((form, index) => ({ form, index }))
    .sort((a, b) => b.form.score - a.form.score || a.index - b.index)
    .slice(0, SiteCheckLimits.maxForms)
    .sort((a, b) => a.index - b.index)
    .map(({ form: { score: _score, ...form } }) => form);
}

function fieldType(control: Element): PageFormField['type'] {
  if (control.localName === 'select') return 'select';
  if (control.localName === 'textarea') return 'textarea';
  const type = (control.getAttribute('type') ?? 'text').toLowerCase();
  return INPUT_TYPE_MAP[type] ?? 'other';
}

/** Tipo, etiqueta y autocomplete. Nunca el valor, ni `checked`, ni la opción elegida. */
function summarizeField(control: Element): PageFormField {
  const field: PageFormField = { type: fieldType(control) };
  if (field.type !== 'hidden') {
    const label = sanitizeLabel(fieldLabel(control), 120);
    if (label) field.label = label;
  }
  const autocomplete = control.getAttribute('autocomplete')?.trim().toLowerCase();
  if (autocomplete && /^[a-z0-9 -]{1,60}$/.test(autocomplete)) field.autocomplete = autocomplete;
  return field;
}

function fieldLabel(control: Element): string {
  const root = control.getRootNode() as Document | ShadowRoot;
  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => root.getElementById?.(id) ?? control.ownerDocument.getElementById(id))
      .filter((node): node is HTMLElement => node !== null)
      .map((node) => visibleText(node))
      .join(' ')
      .trim();
    if (text) return text;
  }
  const aria = control.getAttribute('aria-label')?.trim();
  if (aria) return aria;
  const id = control.getAttribute('id');
  const forLabel = id ? Array.from(root.querySelectorAll?.('label[for]') ?? []).find((l) => l.getAttribute('for') === id) : undefined;
  const label = forLabel ?? control.closest('label');
  if (label) {
    const text = visibleText(label).trim();
    if (text) return text;
  }
  return control.getAttribute('placeholder')?.trim() || control.getAttribute('title')?.trim() || '';
}

function methodOf(form: HTMLFormElement | null): PageForm['method'] {
  if (!form) return 'other';
  const method = (form.getAttribute('method') ?? 'get').trim().toLowerCase();
  return method === 'get' || method === 'post' || method === 'dialog' ? method : 'other';
}

/** Destino depurado; null si es la misma página, no es http(s) o no se pudo resolver. */
function actionOf(doc: Document, form: HTMLFormElement | null): string | null {
  const raw = form?.getAttribute('action')?.trim();
  if (!raw) return null;
  const action = sanitizeUrl(raw, doc.baseURI);
  if (!action) return null;
  const here = sanitizeUrl(doc.URL);
  const strip = (url: string) => url.replace(/[?#].*$/, '');
  return here && strip(here) === strip(action) ? null : action;
}

/* -------------------------------- Enlaces -------------------------------- */

function summarizeLinks(doc: Document, anchors: Element[]): PageLink[] {
  const pageHost = hostOf(doc.URL, doc.URL);
  const seen = new Set<string>();
  const links: Array<PageLink & { relevant: boolean; index: number }> = [];
  for (const anchor of anchors) {
    const href = sanitizeUrl(anchor.getAttribute('href') ?? '', doc.baseURI);
    if (!href || !isVisible(anchor)) continue;
    const rawText =
      visibleText(anchor).trim() ||
      anchor.getAttribute('aria-label')?.trim() ||
      anchor.querySelector('img[alt]')?.getAttribute('alt')?.trim() ||
      anchor.getAttribute('title')?.trim() ||
      '';
    const text = sanitizeLinkText(rawText, 200);
    if (!text) continue;
    const key = `${text}\u0000${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Relevantes: llevan a otro sitio o su texto parece una dirección (posible engaño).
    const relevant = hostOf(href, doc.URL) !== pageHost || /^[\w.-]+\.[a-z]{2,}$/i.test(text);
    links.push({ text, href, relevant, index: links.length });
  }
  return links
    .sort((a, b) => Number(b.relevant) - Number(a.relevant) || a.index - b.index)
    .slice(0, SiteCheckLimits.maxLinks)
    .map(({ text, href }) => ({ text, href }));
}

/* ------------------------- Identidad y orígenes ------------------------- */

function declaredBrand(doc: Document): string | undefined {
  const meta = (selector: string) => doc.querySelector(selector)?.getAttribute('content')?.trim();
  const logo = Array.from(doc.querySelectorAll('img[alt]')).find((img) =>
    /logo/i.test(`${img.getAttribute('class') ?? ''} ${img.getAttribute('id') ?? ''} ${img.getAttribute('src') ?? ''} ${img.getAttribute('alt') ?? ''}`),
  );
  const raw =
    meta('meta[property="og:site_name"]') ||
    meta('meta[name="application-name"]') ||
    logo?.getAttribute('alt')?.replace(/\blogo\b/gi, '').trim() ||
    '';
  const brand = sanitizeLabel(raw, 120);
  return brand || undefined;
}

function hostOf(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

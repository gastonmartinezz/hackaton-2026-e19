/**
 * Formato local de la página extraída. Lo define el front (spec v1.2): el
 * backend recibe HTML, así que el snapshot depurado se serializa como HTML
 * sintético con un id estable por elemento. Nunca se envía el HTML real.
 */
import { z } from 'zod';

export const SNAPSHOT_LIMITS = {
  idLength: 64,
  roleLength: 40,
  labelLength: 120,
  inputTypeLength: 20,
  originLength: 200,
  elements: 300,
  titleLength: 200,
  /** Opciones de una lista que se mandan (las escribió el sitio). */
  choices: 40,
  choiceLength: 80,
} as const;

const Id = z
  .string()
  .min(1)
  .max(SNAPSHOT_LIMITS.idLength)
  .regex(/^[A-Za-z0-9_-]+$/);

export const PageElementSchema = z.strictObject({
  id: Id,
  role: z.string().min(1).max(SNAPSHOT_LIMITS.roleLength),
  /** Etiqueta depurada; nunca el value del control. */
  label: z.string().max(SNAPSHOT_LIMITS.labelLength),
  inputType: z.string().max(SNAPSHOT_LIMITS.inputTypeLength).optional(),
  enabled: z.boolean(),
  /** El sitio marca el dato como obligatorio (required o aria-required). Nunca el valor. */
  required: z.boolean().optional(),
  /**
   * Textos de las opciones de una lista (los escribió el sitio, depurados).
   * Nunca cuál está elegida.
   */
  choices: z.array(z.string().min(1).max(SNAPSHOT_LIMITS.choiceLength)).max(SNAPSHOT_LIMITS.choices).optional(),
  sectionId: Id.optional(),
});
export type PageElement = z.infer<typeof PageElementSchema>;

export const PageSnapshotSchema = z.strictObject({
  pageId: Id,
  navigationId: Id,
  revision: z.number().int().nonnegative(),
  /** Solo origen (esquema + host + puerto). Nunca path, query ni fragmento. */
  origin: z.string().max(SNAPSHOT_LIMITS.originLength).regex(/^https?:\/\/[^/?#]+$/),
  extraction: z.enum(['complete', 'partial']),
  elements: z.array(PageElementSchema).max(SNAPSHOT_LIMITS.elements),
  /** Título del documento depurado; ausente si es dudoso (saludos, datos personales). */
  title: z.string().min(1).max(SNAPSHOT_LIMITS.titleLength).optional(),
  /** Atributo lang del documento (BCP 47). */
  language: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/).max(10).optional(),
});
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

const SECTION_TAGS: Record<string, string> = {
  main: 'main',
  navigation: 'nav',
  search: 'search',
  form: 'form',
  banner: 'header',
  contentinfo: 'footer',
  complementary: 'aside',
  region: 'section',
  dialog: 'dialog',
};

const INPUT_ROLES = new Set(['textbox', 'searchbox', 'checkbox', 'radio', 'spinbutton', 'slider']);

/**
 * HTML sintético para POST /v1/options. Cada elemento lleva `id` igual a su ID
 * local, así un selector `#el-N` se resuelve contra el registro de la página.
 * Solo contiene rol, etiqueta depurada, tipo y estado.
 */
export function snapshotToHtml(snapshot: PageSnapshot): string {
  const children = new Map<string | undefined, PageElement[]>();
  for (const element of snapshot.elements) {
    const key = element.sectionId;
    children.set(key, [...(children.get(key) ?? []), element]);
  }
  const render = (element: PageElement): string => {
    const attrs = [`id="${escape(element.id)}"`];
    if (!element.enabled) attrs.push('disabled');
    if (element.required) attrs.push('required');
    const sectionTag = SECTION_TAGS[element.role];
    if (sectionTag) {
      if (element.label) attrs.push(`aria-label="${escape(element.label)}"`);
      const inner = (children.get(element.id) ?? []).map(render).join('');
      return `<${sectionTag} ${attrs.join(' ')}>${inner}</${sectionTag}>`;
    }
    if (element.inputType === 'textarea') {
      if (element.label) attrs.push(`aria-label="${escape(element.label)}"`);
      return `<textarea ${attrs.join(' ')}></textarea>`;
    }
    if (INPUT_ROLES.has(element.role) || (element.role === 'button' && element.inputType)) {
      attrs.push(`type="${escape(element.inputType ?? inputTypeFor(element.role))}"`);
      if (element.label) attrs.push(`aria-label="${escape(element.label)}"`);
      return `<input ${attrs.join(' ')}>`;
    }
    switch (element.role) {
      case 'link':
        return `<a ${attrs.join(' ')} href="#">${escape(element.label)}</a>`;
      case 'button':
        return `<button ${attrs.join(' ')}>${escape(element.label)}</button>`;
      case 'heading':
        return `<h2 ${attrs.join(' ')}>${escape(element.label)}</h2>`;
      case 'combobox':
      case 'listbox': {
        if (element.label) attrs.push(`aria-label="${escape(element.label)}"`);
        const options = (element.choices ?? []).map((choice) => `<option>${escape(choice)}</option>`).join('');
        return `<select ${attrs.join(' ')}>${options}</select>`;
      }
      default:
        return `<div role="${escape(element.role)}" ${attrs.join(' ')}>${escape(element.label)}</div>`;
    }
  };
  // Elementos cuya sección no quedó en el snapshot se muestran en la raíz.
  const ids = new Set(snapshot.elements.map((e) => e.id));
  const roots = snapshot.elements.filter((e) => !e.sectionId || !ids.has(e.sectionId));
  const html = roots.map(render).join('\n');
  return html || '<main></main>';
}

function inputTypeFor(role: string): string {
  switch (role) {
    case 'searchbox':
      return 'search';
    case 'checkbox':
    case 'radio':
      return role;
    case 'spinbutton':
      return 'number';
    case 'slider':
      return 'range';
    default:
      return 'text';
  }
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Resuelve un selector generado por Claude a un ID local. Primero contra el
 * HTML sintético enviado (mismos ids); si no matchea, contra el documento real.
 * Con varios resultados se usa el primero que esté registrado.
 */
export function resolveSelector(
  selector: string,
  html: string,
  realDocument: Document,
  idOf: (element: Element) => string | undefined,
): string | undefined {
  const parser = new realDocument.defaultView!.DOMParser();
  const synthetic = parser.parseFromString(`<body>${html}</body>`, 'text/html');
  for (const element of query(synthetic, selector)) {
    const id = element.closest('[id]')?.getAttribute('id');
    if (id) return id;
  }
  for (const element of query(realDocument, selector)) {
    const id = idOf(element);
    if (id) return id;
  }
  return undefined;
}

function query(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
}

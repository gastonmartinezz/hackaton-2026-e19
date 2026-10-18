/**
 * Preload mínimo y aislado de la vista del sitio. Corre con sandbox y
 * contextIsolation, solo en el frame principal. No expone nada a la página:
 * escucha comandos autorizados del proceso principal (extraer, mostrar, limpiar)
 * y le informa cambios e interacciones sin valores.
 *
 * Excepción pedida por el equipo (18/10/2026): en un dato de formulario que no
 * es sensible, escribe lo que la persona dictó (`fill`) y la persona lo revisa.
 * Nunca escribe en un dato sensible (ahí solo pone el cursor, `focus`), nunca
 * hace clic ni envía el formulario, y nunca lee ni informa el valor.
 */
import { extractPageSummary, extractSnapshot, pageSignature, resolveSelector, snapshotToHtml, type ElementRegistry } from '@asistente/page-analyzer';
import { ipcRenderer } from 'electron';
import {
  ExtractRequestSchema,
  FillRequestSchema,
  FocusRequestSchema,
  PAGE_CHANNELS,
  ShowRequestSchema,
  SummarizeRequestSchema,
  type FillResult,
  type ShowResult,
} from '../../shared/ipc';
import { fillableType, focusField, looksSensitive, writeDictated } from './fill';
import { Highlighter, isField } from './highlighter';
import { isRelevantChange, observePage } from './observer';

let registry: ElementRegistry | undefined;
/** HTML sintético de la última extracción: los selectores del backend se resuelven contra él. */
let lastHtml = '';
let highlighter: Highlighter | undefined;
let invalidCount = 0;
let lastInteraction = { key: '', at: 0 };
/** Guíame está escribiendo lo dictado: esos eventos no son de la persona y no avanzan el paso. */
let filling = false;
/** Huella de formularios e identidad para la protección de sitios. */
let signature = '';

ipcRenderer.on(PAGE_CHANNELS.extract, (_event, raw: unknown) => {
  const request = ExtractRequestSchema.safeParse(raw);
  if (!request.success) return;
  const { requestId, pageId, navigationId, revision } = request.data;
  const result = extractSnapshot(document, { pageId, navigationId, revision, previous: registry });
  registry = result.registry;
  lastHtml = snapshotToHtml(result.snapshot);
  ipcRenderer.send(PAGE_CHANNELS.snapshot, { requestId, snapshot: result.snapshot, notes: result.notes });
});

ipcRenderer.on(PAGE_CHANNELS.show, async (_event, raw: unknown) => {
  const request = ShowRequestSchema.safeParse(raw);
  if (!request.success) return;
  const { requestId, navigationId, selector, scroll } = request.data;
  let result: ShowResult = 'stale';
  const current = registry?.navigationId === navigationId ? registry : undefined;
  const elementId = current ? resolveSelector(selector, lastHtml, document, (node) => current.idOf(node)) : undefined;
  const element = elementId ? current?.resolve(elementId) : undefined;
  if (element) {
    highlighter ??= new Highlighter(document);
    result = highlighter.show(element, { scroll });
    if (result !== 'shown') highlighter.clear();
  } else {
    highlighter?.clear();
  }
  if (!element) {
    ipcRenderer.send(PAGE_CHANNELS.shown, { requestId, result });
    return;
  }
  if (result === 'shown' && scroll) await scrollSettled();
  const box = element.getBoundingClientRect();
  const rect = { x: box.left, y: box.top, width: box.width, height: box.height };
  ipcRenderer.send(PAGE_CHANNELS.shown, {
    requestId,
    result,
    elementId,
    rect,
    field: isField(element),
    fillable: fillableType(element) !== null,
    sensitive: looksSensitive(element),
  });
});

ipcRenderer.on(PAGE_CHANNELS.fill, (_event, raw: unknown) => {
  const request = FillRequestSchema.safeParse(raw);
  if (!request.success) return;
  const { requestId, navigationId, elementId, value } = request.data;
  ipcRenderer.send(PAGE_CHANNELS.filled, { requestId, result: fill(navigationId, elementId, value) });
});

ipcRenderer.on(PAGE_CHANNELS.focus, (_event, raw: unknown) => {
  const request = FocusRequestSchema.safeParse(raw);
  if (!request.success) return;
  const element = resolveCurrent(request.data.navigationId, request.data.elementId);
  if (element) focusField(element);
});

// Protección de sitios: resumen sanitizado (sin valores, cookies ni almacenamiento).
ipcRenderer.on(PAGE_CHANNELS.summarize, (_event, raw: unknown) => {
  const request = SummarizeRequestSchema.safeParse(raw);
  if (!request.success) return;
  const { requestId, navigationId, contentVersion } = request.data;
  const summary = extractPageSummary(document);
  signature = pageSignature(document);
  ipcRenderer.send(PAGE_CHANNELS.summary, { requestId, navigationId, contentVersion, summary });
});

ipcRenderer.on(PAGE_CHANNELS.clear, () => {
  highlighter?.clear();
});

ipcRenderer.on(PAGE_CHANNELS.veil, (_event, on: unknown) => {
  if (on !== true && !highlighter) return;
  highlighter ??= new Highlighter(document);
  highlighter.setVeil(on === true);
});

function resolveCurrent(navigationId: string, elementId: string): Element | undefined {
  return registry?.navigationId === navigationId ? registry.resolve(elementId) : undefined;
}

/** Escribe lo dictado solo en el lugar que está señalado ahora. */
function fill(navigationId: string, elementId: string, said: string): FillResult {
  const element = resolveCurrent(navigationId, elementId);
  if (!element || element !== highlighter?.target) return 'stale';
  return writeDictated(element, said, (active) => {
    filling = active;
  });
}

/** Espera a que termine el desplazamiento suave (o un máximo) para medir el control. */
function scrollSettled(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('scrollend', done, true);
      resolve();
    };
    const timer = setTimeout(done, 700);
    window.addEventListener('scrollend', done, { capture: true, once: true });
  });
}

function start(): void {
  invalidCount = countInvalid();
  signature = pageSignature(document);
  observePage(document, {
    onChange(structural) {
      const next = pageSignature(document);
      if (next !== signature) {
        signature = next;
        ipcRenderer.send(PAGE_CHANNELS.signature, { signature: next });
      }
      const invalid = countInvalid();
      if (invalid > invalidCount) ipcRenderer.send(PAGE_CHANNELS.validation, {});
      invalidCount = invalid;
      const targetPresent = highlighter?.targetPresent() ?? null;
      if (isRelevantChange(structural, targetPresent)) ipcRenderer.send(PAGE_CHANNELS.changed, { structural, targetPresent });
    },
    onInteraction(target, event) {
      if (filling) return;
      const elementId = registry?.idOf(target);
      if (!elementId) return;
      // Lo mismo repetido sobre el mismo control se informa una sola vez por segundo
      // (por tipo: el clic para entrar no tapa el «terminó de escribir»).
      const now = Date.now();
      const key = `${elementId}:${event}`;
      if (key === lastInteraction.key && now - lastInteraction.at < 1000) return;
      lastInteraction = { key, at: now };
      ipcRenderer.send(PAGE_CHANNELS.interaction, { elementId, event });
    },
    onValidationError() {
      ipcRenderer.send(PAGE_CHANNELS.validation, {});
    },
  });
}

/** Solo cuenta controles marcados como inválidos; no lee su contenido. */
function countInvalid(): number {
  return document.querySelectorAll('[aria-invalid="true"]').length;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

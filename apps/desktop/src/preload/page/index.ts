/**
 * Preload mínimo y aislado de la vista del sitio. Corre con sandbox y
 * contextIsolation, solo en el frame principal. No expone nada a la página:
 * escucha comandos autorizados del proceso principal (extraer, mostrar, limpiar)
 * y le informa cambios e interacciones sin valores.
 */
import { extractSnapshot, type ElementRegistry } from '@asistente/page-analyzer';
import { ipcRenderer } from 'electron';
import { ExtractRequestSchema, PAGE_CHANNELS, ShowRequestSchema, type ShowResult } from '../../shared/ipc';
import { Highlighter } from './highlighter';
import { observePage } from './observer';

let registry: ElementRegistry | undefined;
let highlighter: Highlighter | undefined;
let invalidCount = 0;
let lastInteraction = { id: '', at: 0 };

ipcRenderer.on(PAGE_CHANNELS.extract, (_event, raw: unknown) => {
  const request = ExtractRequestSchema.safeParse(raw);
  if (!request.success) return;
  const { requestId, pageId, navigationId, revision } = request.data;
  const result = extractSnapshot(document, { pageId, navigationId, revision, previous: registry });
  registry = result.registry;
  ipcRenderer.send(PAGE_CHANNELS.snapshot, { requestId, snapshot: result.snapshot, notes: result.notes });
});

ipcRenderer.on(PAGE_CHANNELS.show, (_event, raw: unknown) => {
  const request = ShowRequestSchema.safeParse(raw);
  if (!request.success) return;
  const { requestId, navigationId, elementId, scroll } = request.data;
  let result: ShowResult = 'stale';
  const element = registry?.navigationId === navigationId ? registry.resolve(elementId) : undefined;
  if (element) {
    highlighter ??= new Highlighter(document);
    result = highlighter.show(element, { scroll });
    if (result !== 'shown') highlighter.clear();
  } else {
    highlighter?.clear();
  }
  ipcRenderer.send(PAGE_CHANNELS.shown, { requestId, result });
});

ipcRenderer.on(PAGE_CHANNELS.clear, () => {
  highlighter?.clear();
});

function start(): void {
  invalidCount = countInvalid();
  observePage(document, {
    onChange(structural) {
      const invalid = countInvalid();
      if (invalid > invalidCount) ipcRenderer.send(PAGE_CHANNELS.validation, {});
      invalidCount = invalid;
      ipcRenderer.send(PAGE_CHANNELS.changed, { structural, targetPresent: highlighter?.targetPresent() ?? null });
    },
    onInteraction(target) {
      const elementId = registry?.idOf(target);
      if (!elementId) return;
      // Las pulsaciones repetidas sobre el mismo control se informan una sola vez por segundo.
      const now = Date.now();
      if (elementId === lastInteraction.id && now - lastInteraction.at < 1000) return;
      lastInteraction = { id: elementId, at: now };
      ipcRenderer.send(PAGE_CHANNELS.interaction, { elementId });
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

/**
 * Agente de página para Android (spike). Es el equivalente del preload
 * `apps/desktop/src/preload/page/index.ts`: reutiliza los mismos módulos
 * (extracción, resaltado, dictado, clic confirmado, observador) y solo cambia
 * el transporte. En vez de `ipcRenderer` usa el puente `GuiameAndroid` que
 * expone el WebView, y recibe comandos con `window.__guiameAgent(canal, json)`.
 *
 * Diferencia importante con escritorio: el WebView de Android no tiene un
 * «mundo aislado» como el preload con contextIsolation. Este script corre en el
 * mismo contexto que la página, así que la página podría ver el puente y
 * mandar mensajes falsos. Kotlin valida todo lo que llega y nunca confía en el
 * puente para confirmar acciones (ver README, «Riesgos»).
 */
import { extractSnapshot, resolveSelector, snapshotToHtml, type ElementRegistry } from '@asistente/page-analyzer';
import {
  ClickRequestSchema,
  ExtractRequestSchema,
  FillRequestSchema,
  FocusRequestSchema,
  PAGE_CHANNELS,
  ShowRequestSchema,
  type FillResult,
  type ShowResult,
} from '../../desktop/src/shared/ipc';
import { clickControl, isClickable } from '../../desktop/src/preload/page/click';
import { fillableType, focusField, looksSensitive, writeDictated } from '../../desktop/src/preload/page/fill';
import { Highlighter, isField } from '../../desktop/src/preload/page/highlighter';
import { isRelevantChange, observePage } from '../../desktop/src/preload/page/observer';

interface AndroidBridge {
  postMessage(json: string): void;
}

declare global {
  interface Window {
    GuiameAndroid?: AndroidBridge;
  }
}

type Handler = (payload: unknown) => void | Promise<void>;

let registry: ElementRegistry | undefined;
let lastHtml = '';
let highlighter: Highlighter | undefined;
let lastInteraction = { key: '', at: 0 };
let filling = false;

function send(channel: string, payload: unknown): void {
  window.GuiameAndroid?.postMessage(JSON.stringify({ channel, payload }));
}

const handlers: Record<string, Handler> = {
  [PAGE_CHANNELS.extract](raw) {
    const request = ExtractRequestSchema.safeParse(raw);
    if (!request.success) return;
    const { requestId, pageId, navigationId, revision } = request.data;
    const result = extractSnapshot(document, { pageId, navigationId, revision, previous: registry });
    registry = result.registry;
    lastHtml = snapshotToHtml(result.snapshot);
    // A diferencia de escritorio, Kotlin no tiene el analizador: le mandamos
    // también el HTML sintético, que es lo que va a /v1/options.
    // Solo el título depurado: si es dudoso, el analizador no lo trae.
    const { title, language, origin } = result.snapshot;
    send(PAGE_CHANNELS.snapshot, { requestId, html: lastHtml, title, language, origin, notes: result.notes });
  },

  async [PAGE_CHANNELS.show](raw) {
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
      send(PAGE_CHANNELS.shown, { requestId, result });
      return;
    }
    if (result === 'shown' && scroll) await scrollSettled();
    send(PAGE_CHANNELS.shown, {
      requestId,
      result,
      elementId,
      field: isField(element),
      fillable: fillableType(element) !== null,
      sensitive: looksSensitive(element),
      clickable: isClickable(element),
    });
  },

  [PAGE_CHANNELS.click](raw) {
    const request = ClickRequestSchema.safeParse(raw);
    if (!request.success) return;
    const { requestId, navigationId, elementId } = request.data;
    const element = resolveCurrent(navigationId, elementId);
    const result = !element || element !== highlighter?.target ? 'stale' : clickControl(element);
    send(PAGE_CHANNELS.clicked, { requestId, result });
  },

  [PAGE_CHANNELS.fill](raw) {
    const request = FillRequestSchema.safeParse(raw);
    if (!request.success) return;
    const { requestId, navigationId, elementId, value } = request.data;
    send(PAGE_CHANNELS.filled, { requestId, result: fill(navigationId, elementId, value) });
  },

  [PAGE_CHANNELS.focus](raw) {
    const request = FocusRequestSchema.safeParse(raw);
    if (!request.success) return;
    const element = resolveCurrent(request.data.navigationId, request.data.elementId);
    if (element) focusField(element);
  },

  [PAGE_CHANNELS.clear]() {
    highlighter?.clear();
  },
};

function resolveCurrent(navigationId: string, elementId: string): Element | undefined {
  return registry?.navigationId === navigationId ? registry.resolve(elementId) : undefined;
}

function fill(navigationId: string, elementId: string, said: string): FillResult {
  const element = resolveCurrent(navigationId, elementId);
  if (!element || element !== highlighter?.target) return 'stale';
  return writeDictated(element, said, (active) => {
    filling = active;
  });
}

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
  observePage(document, {
    onChange(structural) {
      const targetPresent = highlighter?.targetPresent() ?? null;
      if (isRelevantChange(structural, targetPresent)) send(PAGE_CHANNELS.changed, { structural, targetPresent });
    },
    onInteraction(target, event) {
      if (filling) return;
      const elementId = registry?.idOf(target);
      if (!elementId) return;
      const now = Date.now();
      const key = `${elementId}:${event}`;
      if (key === lastInteraction.key && now - lastInteraction.at < 1000) return;
      lastInteraction = { key, at: now };
      send(PAGE_CHANNELS.interaction, { elementId, event });
    },
    onValidationError() {
      send(PAGE_CHANNELS.validation, {});
    },
  });
  send('page:ready', { origin: location.origin });
}

// Solo en el frame principal y una vez por documento (el script se inyecta al
// inicio del documento y, como respaldo, al terminar de cargar).
if (window.top === window && !Object.getOwnPropertyDescriptor(window, '__guiameAgent')) {
  // No se puede reemplazar ni borrar desde la página.
  Object.defineProperty(window, '__guiameAgent', {
    value: (channel: string, json: string) => {
      const handler = Object.hasOwn(handlers, channel) ? handlers[channel] : undefined;
      if (!handler) return;
      let payload: unknown;
      try {
        payload = JSON.parse(json);
      } catch {
        return;
      }
      void handler(payload);
    },
    writable: false,
    configurable: false,
    enumerable: false,
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

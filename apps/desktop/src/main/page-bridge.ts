/**
 * Puente proceso principal ↔ preload de la página. Cada mensaje entrante se
 * valida por esquema, por emisor (la vista del sitio) y por frame (el principal).
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PageSnapshot } from '@asistente/page-analyzer';
import type { PageSummary } from '@hackaton/contracts';
import { sanitizeLabel } from '@asistente/privacy';
import { ipcMain, type IpcMainEvent } from 'electron';
import type { z } from 'zod';
import {
  ChangedMessageSchema,
  FilledMessageSchema,
  InteractionMessageSchema,
  PAGE_CHANNELS,
  ShownMessageSchema,
  SignatureMessageSchema,
  SnapshotMessageSchema,
  SummaryMessageSchema,
  ValidationMessageSchema,
  type EXTRACT_NOTES,
  type FillResult,
  type ShowResult,
  type TargetRect,
} from '../shared/ipc';
import { resanitizeSummary } from './site-protection/resanitize';
import type { SiteView } from './site-view';

export interface PageBridgeEvents {
  changed: [{ structural: boolean; targetPresent: boolean | null }];
  interaction: [{ elementId: string; event: 'click' | 'change' | 'input' | 'submit' }];
  validationError: [];
  /** Cambió la huella de formularios o identidad (protección de sitios). */
  signature: [];
}

export interface ShownTarget {
  result: ShowResult;
  /** ID local al que se resolvió el selector. */
  elementId?: string | undefined;
  rect?: TargetRect | undefined;
  field?: boolean | undefined;
  /** Guíame puede escribir ahí lo dictado. */
  fillable?: boolean | undefined;
  /** Los atributos del sitio indican un dato sensible. */
  sensitive?: boolean | undefined;
}

export interface ExtractedPage {
  snapshot: PageSnapshot;
  notes: Array<(typeof EXTRACT_NOTES)[number]>;
}

type Pending<T> = { resolve(value: T): void; reject(error: Error): void; timer: NodeJS.Timeout };

export class PageBridge extends EventEmitter<PageBridgeEvents> {
  readonly #snapshots = new Map<string, Pending<ExtractedPage> & { navigationId: string; revision: number }>();
  readonly #shows = new Map<string, Pending<ShownTarget>>();
  readonly #fills = new Map<string, Pending<FillResult>>();
  readonly #summaries = new Map<string, Pending<PageSummary> & { navigationId: string; contentVersion: number }>();
  readonly #disposers: Array<() => void> = [];

  constructor(private readonly site: SiteView) {
    super();
    this.#on(PAGE_CHANNELS.snapshot, SnapshotMessageSchema, ({ requestId, snapshot, notes }) => {
      const pending = this.#snapshots.get(requestId);
      if (!pending) return;
      this.#snapshots.delete(requestId);
      clearTimeout(pending.timer);
      if (snapshot.navigationId !== pending.navigationId || snapshot.revision !== pending.revision) {
        pending.reject(new Error('snapshot fuera de correlación'));
        return;
      }
      pending.resolve({ snapshot: resanitize(snapshot), notes });
    });
    this.#on(PAGE_CHANNELS.shown, ShownMessageSchema, ({ requestId, result, elementId, rect, field, fillable, sensitive }) => {
      const pending = this.#shows.get(requestId);
      if (!pending) return;
      this.#shows.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve({ result, elementId, rect, field, fillable, sensitive });
    });
    this.#on(PAGE_CHANNELS.filled, FilledMessageSchema, ({ requestId, result }) => {
      const pending = this.#fills.get(requestId);
      if (!pending) return;
      this.#fills.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve(result);
    });
    this.#on(PAGE_CHANNELS.changed, ChangedMessageSchema, (message) => this.emit('changed', message));
    this.#on(PAGE_CHANNELS.interaction, InteractionMessageSchema, (message) => this.emit('interaction', message));
    this.#on(PAGE_CHANNELS.validation, ValidationMessageSchema, () => this.emit('validationError'));
    this.#on(PAGE_CHANNELS.summary, SummaryMessageSchema, ({ requestId, navigationId, contentVersion, summary }) => {
      const pending = this.#summaries.get(requestId);
      if (!pending) return;
      this.#summaries.delete(requestId);
      clearTimeout(pending.timer);
      if (navigationId !== pending.navigationId || contentVersion !== pending.contentVersion) {
        pending.reject(new Error('resumen fuera de correlación'));
        return;
      }
      try {
        pending.resolve(resanitizeSummary(summary));
      } catch {
        pending.reject(new Error('resumen inválido'));
      }
    });
    this.#on(PAGE_CHANNELS.signature, SignatureMessageSchema, () => this.emit('signature'));
  }

  /** Resumen sanitizado para /v1/site-check (independiente de la guía). */
  summarize(navigationId: string, contentVersion: number): Promise<PageSummary> {
    const requestId = shortId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#summaries.delete(requestId);
        reject(new Error('resumen sin respuesta'));
      }, 5000);
      this.#summaries.set(requestId, { resolve, reject, timer, navigationId, contentVersion });
      this.site.contents.send(PAGE_CHANNELS.summarize, { requestId, navigationId, contentVersion });
    });
  }

  /** Al navegar: los resúmenes pedidos al documento anterior ya no sirven. */
  cancelSummaries(): void {
    for (const [id, pending] of this.#summaries) {
      clearTimeout(pending.timer);
      pending.reject(new Error('cancelado'));
      this.#summaries.delete(id);
    }
  }

  extract(pageId: string, navigationId: string, revision: number): Promise<ExtractedPage> {
    const requestId = shortId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#snapshots.delete(requestId);
        reject(new Error('extracción sin respuesta'));
      }, 5000);
      this.#snapshots.set(requestId, { resolve, reject, timer, navigationId, revision });
      this.site.contents.send(PAGE_CHANNELS.extract, { requestId, pageId, navigationId, revision });
    });
  }

  show(navigationId: string, selector: string, scroll: boolean): Promise<ShownTarget> {
    const requestId = shortId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#shows.delete(requestId);
        resolve({ result: 'stale' });
      }, 3000);
      this.#shows.set(requestId, { resolve, reject: () => resolve({ result: 'stale' }), timer });
      this.site.contents.send(PAGE_CHANNELS.show, { requestId, navigationId, selector, scroll });
    });
  }

  /** Escribe lo dictado en el lugar señalado. El valor solo viaja al preload; nunca se registra. */
  fill(navigationId: string, elementId: string, value: string): Promise<FillResult> {
    const requestId = shortId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#fills.delete(requestId);
        resolve('stale');
      }, 3000);
      this.#fills.set(requestId, { resolve, reject: () => resolve('stale'), timer });
      this.site.contents.send(PAGE_CHANNELS.fill, { requestId, navigationId, elementId, value });
    });
  }

  /** Pone el cursor en el lugar para que la persona escriba (datos sensibles). */
  focus(navigationId: string, elementId: string): void {
    if (this.site.contents.isDestroyed()) return;
    this.site.contents.focus();
    this.site.contents.send(PAGE_CHANNELS.focus, { navigationId, elementId });
  }

  clear(): void {
    if (!this.site.contents.isDestroyed()) this.site.contents.send(PAGE_CHANNELS.clear);
  }

  /** Rechaza lo pendiente (p. ej. al navegar): las respuestas tardías se descartan. */
  cancelPending(): void {
    for (const [id, pending] of this.#snapshots) {
      clearTimeout(pending.timer);
      pending.reject(new Error('cancelado'));
      this.#snapshots.delete(id);
    }
    for (const [id, pending] of this.#shows) {
      clearTimeout(pending.timer);
      pending.resolve({ result: 'stale' });
      this.#shows.delete(id);
    }
    for (const [id, pending] of this.#fills) {
      clearTimeout(pending.timer);
      pending.resolve('stale');
      this.#fills.delete(id);
    }
  }

  dispose(): void {
    this.cancelPending();
    this.cancelSummaries();
    for (const dispose of this.#disposers) dispose();
  }

  #on<T extends z.ZodType>(channel: string, schema: T, handler: (message: z.infer<T>) => void): void {
    const listener = (event: IpcMainEvent, raw: unknown) => {
      if (event.sender !== this.site.contents) return;
      if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return;
      if (this.site.navigating) return;
      const parsed = schema.safeParse(raw);
      if (parsed.success) handler(parsed.data);
    };
    ipcMain.on(channel, listener);
    this.#disposers.push(() => ipcMain.removeListener(channel, listener));
  }
}

/** Defensa en profundidad: se vuelven a depurar las etiquetas en el proceso principal. */
function resanitize(snapshot: PageSnapshot): PageSnapshot {
  return { ...snapshot, elements: snapshot.elements.map((e) => ({ ...e, label: sanitizeLabel(e.label) })) };
}

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

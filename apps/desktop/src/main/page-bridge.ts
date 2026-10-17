/**
 * Puente proceso principal ↔ preload de la página. Cada mensaje entrante se
 * valida por esquema, por emisor (la vista del sitio) y por frame (el principal).
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PageSnapshot } from '@hackaton/contracts';
import { sanitizeLabel } from '@asistente/privacy';
import { ipcMain, type IpcMainEvent } from 'electron';
import type { z } from 'zod';
import {
  ChangedMessageSchema,
  InteractionMessageSchema,
  PAGE_CHANNELS,
  ShownMessageSchema,
  SnapshotMessageSchema,
  ValidationMessageSchema,
  type EXTRACT_NOTES,
  type ShowResult,
} from '../shared/ipc';
import type { SiteView } from './site-view';

export interface PageBridgeEvents {
  changed: [{ structural: boolean; targetPresent: boolean | null }];
  interaction: [{ elementId: string }];
  validationError: [];
}

export interface ExtractedPage {
  snapshot: PageSnapshot;
  notes: Array<(typeof EXTRACT_NOTES)[number]>;
}

type Pending<T> = { resolve(value: T): void; reject(error: Error): void; timer: NodeJS.Timeout };

export class PageBridge extends EventEmitter<PageBridgeEvents> {
  readonly #snapshots = new Map<string, Pending<ExtractedPage> & { navigationId: string; revision: number }>();
  readonly #shows = new Map<string, Pending<ShowResult>>();
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
    this.#on(PAGE_CHANNELS.shown, ShownMessageSchema, ({ requestId, result }) => {
      const pending = this.#shows.get(requestId);
      if (!pending) return;
      this.#shows.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve(result);
    });
    this.#on(PAGE_CHANNELS.changed, ChangedMessageSchema, (message) => this.emit('changed', message));
    this.#on(PAGE_CHANNELS.interaction, InteractionMessageSchema, (message) => this.emit('interaction', message));
    this.#on(PAGE_CHANNELS.validation, ValidationMessageSchema, () => this.emit('validationError'));
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

  show(navigationId: string, elementId: string, scroll: boolean): Promise<ShowResult> {
    const requestId = shortId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#shows.delete(requestId);
        resolve('stale');
      }, 3000);
      this.#shows.set(requestId, { resolve, reject: () => resolve('stale'), timer });
      this.site.contents.send(PAGE_CHANNELS.show, { requestId, navigationId, elementId, scroll });
    });
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
      pending.resolve('stale');
      this.#shows.delete(id);
    }
  }

  dispose(): void {
    this.cancelPending();
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

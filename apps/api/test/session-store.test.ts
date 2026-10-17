import { afterEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../src/modules/sessions/session-store.js';

let store: SessionStore;
afterEach(() => store?.close());

describe('SessionStore', () => {
  it('vence la sesión tras el TTL sin uso y lo renueva con cada uso', () => {
    let now = 0;
    store = new SessionStore(30 * 60_000, () => now);
    const id = store.create('owner');

    now = 29 * 60_000;
    store.append(id, 'owner', { type: 'options', options: [] });
    now = 58 * 60_000;
    expect(store.context(id, 'owner')?.history).toHaveLength(1);

    now = 90 * 60_000;
    expect(store.context(id, 'owner')).toBeUndefined();
  });

  it('devuelve copias: modificar el contexto no cambia la sesión', () => {
    store = new SessionStore(60_000);
    const id = store.create('owner');
    store.mergeMetadata(id, 'owner', { page: { title: 'Inicio' } });
    const context = store.context(id, 'owner')!;
    context.history.push({ type: 'options', options: [] });
    context.metadata.page!.title = 'Otro';
    expect(store.context(id, 'owner')).toEqual({ chat: [], metadata: { page: { title: 'Inicio' } }, history: [] });
  });

  it('no revive una sesión vencida al escribir', () => {
    let now = 0;
    store = new SessionStore(60_000, () => now);
    const id = store.create('owner');
    now = 61_000;
    store.append(id, 'owner', { type: 'options', options: [] });
    expect(store.context(id, 'owner')).toBeUndefined();
  });

  it('ignora escrituras de otro dueño', () => {
    store = new SessionStore(60_000);
    const id = store.create('owner');
    store.append(id, 'otro', { type: 'options', options: [] });
    store.mergeMetadata(id, 'otro', { page: { title: 'X' } });
    expect(store.context(id, 'owner')).toEqual({ chat: [], metadata: {}, history: [] });
  });
});

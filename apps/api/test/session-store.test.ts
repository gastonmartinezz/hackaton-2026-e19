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
    store.append(id, { options: [], guide: null });
    now = 58 * 60_000;
    expect(store.history(id, 'owner')).toHaveLength(1);

    now = 90 * 60_000;
    expect(store.history(id, 'owner')).toBeUndefined();
  });
});

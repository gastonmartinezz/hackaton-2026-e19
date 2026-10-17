import { describe, expect, it } from 'vitest';
import { ApiSession } from './client';

describe('ApiSession', () => {
  it('guarda la sesión devuelta por una solicitud', () => {
    const session = new ApiSession();
    const ticket = session.begin();
    expect(ticket.id).toBeUndefined();
    expect(ticket.commit('s-1')).toBe(true);
    expect(session.id).toBe('s-1');
    expect(session.begin().id).toBe('s-1');
  });

  it('una respuesta tardía no revive una sesión reiniciada', () => {
    const session = new ApiSession();
    session.begin().commit('s-1');
    const late = session.begin();
    session.reset();
    expect(late.commit('s-1')).toBe(false);
    expect(session.id).toBeUndefined();
  });

  it('de dos solicitudes simultáneas, la segunda no pisa a la primera', () => {
    const session = new ApiSession();
    const a = session.begin();
    const b = session.begin();
    expect(a.commit('s-a')).toBe(true);
    expect(b.commit('s-b')).toBe(false);
    expect(session.id).toBe('s-a');
  });

  it('SESSION_NOT_FOUND solo descarta la sesión si sigue siendo la misma', () => {
    const session = new ApiSession();
    session.begin().commit('s-1');
    const stale = session.begin();
    session.reset();
    session.begin().commit('s-2');
    stale.expire();
    expect(session.id).toBe('s-2');

    session.begin().expire();
    expect(session.id).toBeUndefined();
  });
});

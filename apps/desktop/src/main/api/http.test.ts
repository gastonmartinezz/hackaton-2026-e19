import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from './client';
import { HttpApiClient } from './http';

const base = new URL('https://api.ejemplo.test');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const signal = () => new AbortController().signal;

describe('HttpApiClient', () => {
  it('envía cabeceras de sesión y versión, sin Authorization si no hay token', async () => {
    const fetch = vi.fn(async () => json(200, { schemaVersion: '1', requestId: 'r1', status: 'goal', goal: 'renovar dni' }));
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    await expect(client.interpretIntent({ schemaVersion: '1', requestId: 'r1', intent: 'renovar dni' }, signal())).resolves.toMatchObject({ goal: 'renovar dni' });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.ejemplo.test/v1/intents/interpret');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-session-id']).toMatch(/[0-9a-f-]{36}/);
    expect(headers['x-schema-version']).toBe('1');
    expect(headers.authorization).toBeUndefined();
  });

  it('reintenta fallos transitorios y no reintenta errores del cliente', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(503, { error: { code: 'provider_unavailable', message: 'x', retryable: true } }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const client = new HttpApiClient({ baseUrl: base, token: 't', fetch });
    await expect(client.pageOptions({ schemaVersion: '1', requestId: 'r', snapshot: {} as never }, signal())).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);

    const bad = vi.fn(async () => json(400, { error: { code: 'bad_request', message: 'x', retryable: false } }));
    const client2 = new HttpApiClient({ baseUrl: base, token: null, fetch: bad });
    await expect(client2.guidanceNext({} as never, signal())).rejects.toMatchObject({ code: 'bad_request' });
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('rechaza respuestas inválidas o de otra solicitud', async () => {
    const fetch = vi.fn(async () => json(200, { schemaVersion: '1', requestId: 'otro', status: 'goal', goal: 'x' }));
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    await expect(client.interpretIntent({ schemaVersion: '1', requestId: 'r1', intent: 'x' }, signal())).rejects.toBeInstanceOf(ApiFailure);
  });

  it('descarta una recomendación que no está entre los resultados', async () => {
    const fetch = vi.fn(async () =>
      json(200, {
        schemaVersion: '1',
        requestId: 'r',
        candidates: [{ id: 'a', title: 'A', url: 'https://a.gob.ar/', description: '' }],
        recommendedId: 'inventado',
      }),
    );
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    await expect(client.searchDestinations({ schemaVersion: '1', requestId: 'r', goal: 'x' }, signal())).resolves.toMatchObject({ recommendedId: null });
  });

  it('no envía payloads que superan el límite', async () => {
    const fetch = vi.fn();
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    const huge = { schemaVersion: '1', requestId: 'r', snapshot: { x: 'a'.repeat(200_000) } } as never;
    await expect(client.pageOptions(huge, signal())).rejects.toMatchObject({ code: 'payload_too_large' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from './client';
import { HttpApiClient } from './http';

const base = new URL('https://api.ejemplo.test');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const signal = () => new AbortController().signal;
const ask = { messages: [{ role: 'user' as const, content: 'renovar dni' }] };

describe('HttpApiClient', () => {
  it('envía Authorization y X-Request-Id, y devuelve la respuesta validada', async () => {
    const fetch = vi.fn(async () => json(200, { type: 'question', message: '¿En qué país?' }));
    const client = new HttpApiClient({ baseUrl: base, token: 'tok', fetch });
    await expect(client.interpret(ask, signal())).resolves.toEqual({ type: 'question', message: '¿En qué país?' });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.ejemplo.test/v1/interpret');
    expect(JSON.parse(init.body as string)).toEqual(ask);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    expect(headers['x-request-id']).toMatch(/^[0-9a-f]{32}$/);
  });

  it('no envía Authorization si no hay token', async () => {
    const fetch = vi.fn(async () => json(200, { type: 'redirect', message: 'Vamos', url: 'https://a.gob.ar/' }));
    await new HttpApiClient({ baseUrl: base, token: null, fetch }).interpret(ask, signal());
    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('reintenta errores marcados como retryable y no los demás', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(503, { error: { code: 'AI_UNAVAILABLE', message: 'x', requestId: 'r', retryable: true } }))
      .mockResolvedValueOnce(json(200, { sessionId: 's-1', options: [], guide: null }));
    const client = new HttpApiClient({ baseUrl: base, token: 't', fetch });
    await expect(client.options({ html: '<main></main>' }, signal())).resolves.toEqual({ sessionId: 's-1', options: [], guide: null });
    expect(fetch).toHaveBeenCalledTimes(2);

    const missing = vi.fn(async () => json(404, { error: { code: 'SESSION_NOT_FOUND', message: 'x', requestId: 'r', retryable: false } }));
    const client2 = new HttpApiClient({ baseUrl: base, token: null, fetch: missing });
    await expect(client2.options({ sessionId: 'viejo', html: '<main></main>' }, signal())).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(missing).toHaveBeenCalledTimes(1);
  });

  it('rechaza respuestas que no cumplen el contrato', async () => {
    const fetch = vi.fn(async () => json(200, { type: 'redirect', message: 'x', url: 'javascript:alert(1)' }));
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    await expect(client.interpret(ask, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(client.interpret(ask, signal())).rejects.toBeInstanceOf(ApiFailure);
  });

  it('no envía cuerpos que superan el límite', async () => {
    const fetch = vi.fn();
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    await expect(client.options({ html: 'a'.repeat(600_000) }, signal())).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

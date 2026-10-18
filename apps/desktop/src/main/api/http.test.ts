import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from './client';
import { HttpApiClient } from './http';

const base = new URL('https://api.ejemplo.test');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const signal = () => new AbortController().signal;
const ask = { messages: [{ role: 'user' as const, content: 'renovar dni' }] };

describe('HttpApiClient', () => {
  it('envía Authorization y X-Request-Id, y devuelve la respuesta validada', async () => {
    const fetch = vi.fn(async () => json(200, { sessionId: 's-1', type: 'question', message: '¿En qué país?' }));
    const client = new HttpApiClient({ baseUrl: base, token: 'tok', fetch });
    await expect(client.interpret(ask, signal())).resolves.toEqual({ sessionId: 's-1', type: 'question', message: '¿En qué país?' });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.ejemplo.test/v1/interpret');
    expect(JSON.parse(init.body as string)).toEqual(ask);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    expect(headers['x-request-id']).toMatch(/^[0-9a-f]{32}$/);
  });

  it('no envía Authorization si no hay token', async () => {
    const fetch = vi.fn(async () => json(200, { sessionId: 's-1', type: 'redirect', message: 'Vamos', url: 'https://a.gob.ar/' }));
    await new HttpApiClient({ baseUrl: base, token: null, fetch }).interpret(ask, signal());
    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('reintenta errores marcados como retryable y no los demás', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(503, { error: { code: 'AI_UNAVAILABLE', message: 'x', requestId: 'r', retryable: true } }))
      .mockResolvedValueOnce(json(200, { sessionId: 's-1', options: [] }));
    const client = new HttpApiClient({ baseUrl: base, token: 't', fetch });
    await expect(client.options({ html: '<main></main>' }, signal())).resolves.toEqual({ sessionId: 's-1', options: [] });
    expect(fetch).toHaveBeenCalledTimes(2);

    const missing = vi.fn(async () => json(404, { error: { code: 'SESSION_NOT_FOUND', message: 'x', requestId: 'r', retryable: false } }));
    const client2 = new HttpApiClient({ baseUrl: base, token: null, fetch: missing });
    await expect(client2.options({ sessionId: 'viejo', html: '<main></main>' }, signal())).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(missing).toHaveBeenCalledTimes(1);
  });

  it('rechaza respuestas que no cumplen el contrato', async () => {
    const fetch = vi.fn(async () => json(200, { sessionId: 's-1', type: 'redirect', message: 'x', url: 'javascript:alert(1)' }));
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    await expect(client.interpret(ask, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(client.interpret(ask, signal())).rejects.toBeInstanceOf(ApiFailure);
  });

  it('next-step: valida la respuesta', async () => {
    const step = { element: '#el-9', instruction: 'Elegí la especialidad.', presentation: 'highlight', waitFor: 'userInteraction' } as const;
    const fetch = vi.fn(async () => json(200, { sessionId: 's-1', steps: [step], done: false }));
    const client = new HttpApiClient({ baseUrl: base, token: 't', fetch });
    const request = { sessionId: 's-1', optionId: 'turno', expectedStep: { ...step, element: null }, completedSteps: [], html: '<main></main>' };
    await expect(client.nextStep(request, signal())).resolves.toEqual({ sessionId: 's-1', steps: [step], done: false });
    const [url] = fetch.mock.calls[0] as unknown as [URL];
    expect(url.toString()).toBe('https://api.ejemplo.test/v1/next-step');

    const bad = vi.fn(async () => json(200, { sessionId: 's-1', steps: [{ ...step, element: 42 }], done: false }));
    await expect(new HttpApiClient({ baseUrl: base, token: 't', fetch: bad }).nextStep(request, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('no envía cuerpos que superan el límite', async () => {
    const fetch = vi.fn();
    const client = new HttpApiClient({ baseUrl: base, token: null, fetch });
    await expect(client.options({ html: 'a'.repeat(600_000) }, signal())).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('/v1/site-check: valida la respuesta, usa Bearer y no reintenta', async () => {
    const request = { navigationId: 'nav-1', contentVersion: 0, url: 'https://banco.com/', hostname: 'banco.com', registrableDomain: 'banco.com' };
    const response = {
      navigationId: 'nav-1',
      contentVersion: 0,
      analysisId: 'a-1',
      status: 'pending',
      identity: { status: 'unknown' },
      risk: 'unknown',
      reasons: [],
      coverage: { reputation: 'complete', identity: 'complete', content: 'pending', registration: 'unavailable', connection: 'unavailable' },
      checkedAt: '2026-10-17T22:00:00Z',
      expiresAt: '2026-10-17T22:15:00Z',
    };
    const fetch = vi.fn(async () => json(200, response));
    const client = new HttpApiClient({ baseUrl: base, token: 'tok', fetch });
    await expect(client.siteCheck(request, signal())).resolves.toEqual(response);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.ejemplo.test/v1/site-check');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');

    const unavailable = vi.fn(async () => json(503, { error: { code: 'AI_UNAVAILABLE', message: 'x', requestId: 'r', retryable: true } }));
    await expect(new HttpApiClient({ baseUrl: base, token: 't', fetch: unavailable }).siteCheck(request, signal())).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(unavailable).toHaveBeenCalledTimes(1);

    const bad = vi.fn(async () => json(200, { ...response, identity: { status: 'trusted' } }));
    await expect(new HttpApiClient({ baseUrl: base, token: 't', fetch: bad }).siteCheck(request, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

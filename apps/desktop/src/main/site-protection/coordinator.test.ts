import { SiteCheckResponse, type PageSummary, type SiteCheckReason, type SiteCheckRequest } from '@hackaton/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../api/client';
import { SiteProtection, type SiteProtectionDeps } from './coordinator';

const PAGE: PageSummary = { text: 'Hola', forms: [], links: [], scriptHosts: [], iframeHosts: [] };

const evidence = [{ source: 'test', checkedAt: '2026-10-17T22:00:00Z', observedBy: 'service' as const, detail: 'x' }];
const reason = (code: SiteCheckReason['code'], category: SiteCheckReason['category'] = 'fraud'): SiteCheckReason => ({ code, category, evidence });

type Over = Partial<SiteCheckResponse>;
const COMPLETE = { reputation: 'complete', identity: 'complete', content: 'complete', registration: 'unavailable', connection: 'unavailable' } as const;
const ADDRESS = { ...COMPLETE, content: 'pending' } as const;

function responseFor(request: SiteCheckRequest, over: Over = {}): SiteCheckResponse {
  return SiteCheckResponse.parse({
    navigationId: request.navigationId,
    contentVersion: request.contentVersion,
    analysisId: 'a-1',
    status: request.contentVersion === 0 ? 'pending' : 'complete',
    identity: { status: 'unknown' },
    risk: request.contentVersion === 0 ? 'unknown' : 'no_signals',
    reasons: [],
    coverage: request.contentVersion === 0 ? ADDRESS : COMPLETE,
    checkedAt: '2026-10-17T22:00:00Z',
    expiresAt: '2026-10-17T22:15:00Z',
    ...over,
  });
}

interface Call {
  request: SiteCheckRequest;
  signal: AbortSignal;
  resolve(over?: Over): void;
  respondWith(response: SiteCheckResponse): void;
  reject(error: unknown): void;
}

function setup(overrides: Partial<SiteProtectionDeps> = {}) {
  const calls: Call[] = [];
  const summarize = vi.fn(async () => PAGE);
  const onChange = vi.fn();
  const api = {
    siteCheck: (request: SiteCheckRequest, signal: AbortSignal) =>
      new Promise<SiteCheckResponse>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new ApiFailure('ABORTED', false)), { once: true });
        calls.push({ request, signal, resolve: (over) => resolve(responseFor(request, over)), respondWith: resolve, reject });
      }),
  };
  const protection = new SiteProtection({ api, summarize, onChange, settleMs: 100, debounceMs: 500, minIntervalMs: 3000, maxReanalyses: 2, requestTimeoutMs: 10_000, ...overrides });
  return { protection, calls, summarize, onChange };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SiteProtection', () => {
  it('fase dirección al navegar y fase contenido después de la carga', async () => {
    const { protection, calls, summarize } = setup();
    protection.navigationStarted('https://www.banco.com.ar/ingresar?dni=30123456#x');
    expect(protection.snapshot.kind).toBe('checking');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.request).toEqual({
      navigationId: protection.snapshot.navigationId,
      contentVersion: 0,
      url: 'https://www.banco.com.ar/ingresar?dni=[dato]#x',
      hostname: 'www.banco.com.ar',
      registrableDomain: 'banco.com.ar',
    });
    calls[0]!.resolve();
    await flush();
    // La fase dirección vuelve pendiente: sigue «Revisando sitio…».
    expect(protection.snapshot.kind).toBe('checking');

    protection.pageLoaded('https://www.banco.com.ar/ingresar');
    await vi.advanceTimersByTimeAsync(100);
    expect(summarize).toHaveBeenCalledWith(protection.snapshot.navigationId, 1);
    expect(calls[1]!.request).toMatchObject({ contentVersion: 1, page: PAGE });
    calls[1]!.resolve({ identity: { status: 'verified_official', basis: 'financial_regulator', organization: 'Banco' } });
    await flush();
    expect(protection.snapshot.kind).toBe('official');
    expect(protection.snapshot.announcement?.kind).toBe('official');
  });

  it('limpia el estado al navegar y descarta respuestas de la navegación anterior', async () => {
    const { protection, calls } = setup();
    protection.navigationStarted('https://a.com/');
    protection.pageLoaded('https://a.com/');
    await vi.advanceTimersByTimeAsync(100);
    calls[1]!.resolve();
    await flush();
    expect(protection.snapshot.kind).toBe('no_alerts');

    protection.navigationStarted('https://b.com/');
    // Inmediatamente: nada del sitio anterior.
    expect(protection.snapshot).toMatchObject({ kind: 'checking', response: null, warningOpen: false });
    expect(calls[0]!.signal.aborted).toBe(true);
    // Una respuesta tardía de la navegación anterior no se aplica.
    calls[0]!.respondWith(responseFor(calls[0]!.request, { risk: 'high', reasons: [reason('KNOWN_PHISHING')] }));
    await flush();
    expect(protection.snapshot.kind).toBe('checking');
  });

  it('descarta respuestas cuyo navigationId o contentVersion no coinciden', async () => {
    const { protection, calls } = setup();
    protection.navigationStarted('https://a.com/');
    calls[0]!.respondWith(responseFor({ ...calls[0]!.request, navigationId: 'nav-otro' }, { status: 'complete', risk: 'no_signals', coverage: COMPLETE }));
    await flush();
    expect(protection.snapshot.kind).toBe('checking');

    protection.retry();
    calls[1]!.respondWith(responseFor({ ...calls[1]!.request, contentVersion: 3 }, { status: 'complete', risk: 'no_signals', coverage: COMPLETE }));
    await flush();
    expect(protection.snapshot.kind).toBe('checking');
  });

  it('una versión vieja no pisa a la actual, salvo que avise un riesgo mayor', async () => {
    const { protection, calls } = setup();
    protection.navigationStarted('https://a.com/');
    protection.pageLoaded('https://a.com/');
    await vi.advanceTimersByTimeAsync(100);
    // v0 llega después de pedir v1: favorable/pendiente → se descarta.
    calls[0]!.resolve();
    await flush();
    expect(protection.snapshot.response).toBeNull();
    calls[1]!.resolve();
    await flush();
    expect(protection.snapshot.kind).toBe('no_alerts');

  });

  it('una versión vieja con riesgo mayor se aplica como aviso temprano', async () => {
    const { protection, calls } = setup();
    protection.navigationStarted('https://a.com/');
    protection.pageLoaded('https://a.com/');
    await vi.advanceTimersByTimeAsync(100);
    calls[0]!.resolve({ risk: 'high', reasons: [reason('LOOKALIKE_DOMAIN')] });
    await flush();
    expect(protection.snapshot.kind).toBe('possible_scam');
    // La versión actual no baja el riesgo dentro de la misma navegación.
    calls[1]!.resolve();
    await flush();
    expect(protection.snapshot.kind).toBe('possible_scam');
  });

  it('error y tiempo vencido muestran «No pudimos verificarlo»', async () => {
    const { protection, calls } = setup();
    protection.navigationStarted('https://a.com/');
    calls[0]!.reject(new ApiFailure('AI_UNAVAILABLE', true));
    await flush();
    expect(protection.snapshot.kind).toBe('unverified');

    protection.retry();
    expect(protection.snapshot.kind).toBe('checking');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls[1]!.signal.aborted).toBe(true);
    expect(protection.snapshot.kind).toBe('unverified');
  });

  it('un resultado parcial no se muestra como revisión completa', async () => {
    const { protection, calls } = setup();
    protection.navigationStarted('https://a.com/');
    protection.pageLoaded('https://a.com/');
    await vi.advanceTimersByTimeAsync(100);
    calls[1]!.resolve({ status: 'partial', coverage: { ...COMPLETE, reputation: 'unavailable' } });
    await flush();
    expect(protection.snapshot.kind).toBe('unverified');
  });

  it('si no se puede leer la página, queda «No pudimos verificarlo»', async () => {
    const { protection } = setup({ summarize: async () => Promise.reject(new Error('sin preload')) });
    protection.navigationStarted('https://a.com/');
    protection.pageLoaded('https://a.com/');
    await vi.advanceTimersByTimeAsync(100);
    expect(protection.snapshot.kind).toBe('unverified');
  });

  it('las direcciones locales y privadas no llaman al backend', () => {
    const { protection, calls } = setup();
    for (const url of ['http://127.0.0.1:4321/x.html', 'http://localhost:3000/', 'http://192.168.0.10/', 'http://10.1.2.3/', 'http://router/', 'http://[::1]/', 'http://app.test/']) {
      protection.navigationStarted(url);
      protection.pageLoaded(url);
      expect(protection.snapshot.kind).toBe('local');
    }
    protection.navigationStarted('about:blank');
    expect(protection.snapshot.kind).toBe('none');
    expect(calls).toHaveLength(0);
  });

  it('reanaliza con debounce, separación mínima y tope por navegación', async () => {
    const { protection, calls } = setup();
    protection.navigationStarted('https://a.com/');
    protection.pageLoaded('https://a.com/');
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toHaveLength(2);
    // Muchos cambios seguidos → una sola consulta, respetando la separación mínima.
    for (let i = 0; i < 10; i++) protection.contentChanged();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2500);
    expect(calls).toHaveLength(3);
    expect(calls[2]!.request.contentVersion).toBe(2);
    protection.contentChanged();
    await vi.advanceTimersByTimeAsync(3500);
    expect(calls).toHaveLength(4);
    // Tope alcanzado (2 reanálisis).
    protection.contentChanged();
    protection.routeChanged('https://a.com/otra');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(4);
  });

  it('un cambio de ruta muestra «Revisando sitio…» pero no borra un riesgo', async () => {
    const { protection, calls } = setup();
    protection.navigationStarted('https://a.com/');
    protection.pageLoaded('https://a.com/');
    await vi.advanceTimersByTimeAsync(100);
    calls[1]!.resolve();
    await flush();
    protection.routeChanged('https://a.com/pagos');
    expect(protection.snapshot.kind).toBe('checking');
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls[2]!.request.url).toBe('https://a.com/pagos');
    calls[2]!.resolve({ risk: 'medium', reasons: [reason('URGENCY_OR_THREAT')] });
    await flush();
    expect(protection.snapshot.kind).toBe('attention');
    protection.routeChanged('https://a.com/otra');
    expect(protection.snapshot.kind).toBe('attention');
  });

  it('el riesgo alto abre la advertencia una vez por navegación, salvo que aumente', async () => {
    const { protection, calls } = setup();
    protection.navigationStarted('https://bancodemo-acceso.com/');
    calls[0]!.resolve({ risk: 'high', reasons: [reason('LOOKALIKE_DOMAIN')] });
    await flush();
    expect(protection.snapshot).toMatchObject({ kind: 'possible_scam', warningOpen: true });
    expect(protection.highRisk).toBe(true);
    protection.continueAnyway();
    expect(protection.snapshot.warningOpen).toBe(false);

    // Misma evidencia en la fase contenido: no se repite.
    protection.pageLoaded('https://bancodemo-acceso.com/');
    await vi.advanceTimersByTimeAsync(100);
    calls[1]!.resolve({ risk: 'high', reasons: [reason('LOOKALIKE_DOMAIN')] });
    await flush();
    expect(protection.snapshot.warningOpen).toBe(false);

    // Aparece un motivo nuevo: aumentó el riesgo y se vuelve a avisar.
    protection.contentChanged();
    await vi.advanceTimersByTimeAsync(3000);
    calls[2]!.resolve({ risk: 'high', reasons: [reason('LOOKALIKE_DOMAIN'), reason('SENSITIVE_DATA_REQUEST')] });
    await flush();
    expect(protection.snapshot.warningOpen).toBe(true);

    // Una respuesta posterior más favorable no baja el riesgo en la misma navegación.
    protection.continueAnyway();
    protection.retry();
    await flush();
    calls[3]!.resolve();
    await flush();
    expect(protection.snapshot.kind).toBe('possible_scam');

    // Otra navegación empieza limpia.
    protection.navigationStarted('https://otro.com/');
    expect(protection.snapshot).toMatchObject({ kind: 'checking', warningOpen: false });
    expect(protection.highRisk).toBe(false);
  });

  it('el contenido pendiente sin nada en curso termina en «No pudimos verificarlo»', async () => {
    const { protection, calls } = setup({ stuckMs: 2000 });
    protection.navigationStarted('https://a.com/');
    protection.pageLoaded('https://a.com/');
    await vi.advanceTimersByTimeAsync(100);
    calls[1]!.resolve({ status: 'pending', risk: 'unknown', coverage: ADDRESS });
    await flush();
    expect(protection.snapshot.kind).toBe('checking');
    await vi.advanceTimersByTimeAsync(2000);
    expect(protection.snapshot.kind).toBe('unverified');
  });

  it('el panel se cierra al navegar y no anuncia dos veces el mismo estado', async () => {
    const { protection, calls } = setup();
    protection.navigationStarted('https://a.com/');
    protection.pageLoaded('https://a.com/');
    await vi.advanceTimersByTimeAsync(100);
    calls[1]!.resolve();
    await flush();
    protection.setPanelOpen(true);
    const first = protection.snapshot.announcement;
    expect(first?.kind).toBe('no_alerts');
    protection.contentChanged();
    await vi.advanceTimersByTimeAsync(3000);
    calls[2]!.resolve();
    await flush();
    expect(protection.snapshot.announcement).toBe(first);
    expect(protection.snapshot.panelOpen).toBe(true);
    protection.navigationStarted('https://b.com/');
    expect(protection.snapshot.panelOpen).toBe(false);
  });
});

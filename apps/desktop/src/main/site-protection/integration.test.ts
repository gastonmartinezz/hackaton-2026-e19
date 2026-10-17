// @vitest-environment happy-dom
/**
 * Recorrido completo sin Electron: extractor real del preload → depuración en el
 * principal → coordinador → backend simulado, con las páginas de demostración.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPageSummary } from '@asistente/page-analyzer';
import { findLeaks } from '@asistente/privacy';
import { PageSummary, SiteCheckResponse, siteIndicatorState, type SiteCheckRequest } from '@hackaton/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockApiClient } from '../api/mock';
import { mockSiteCheck } from '../api/mock-site-check';
import { SiteProtection } from './coordinator';
import { resanitizeSummary } from './resanitize';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/pages');

function load(page: string, url: string) {
  const html = readFileSync(join(FIXTURES, page), 'utf8');
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
  document.title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  document.body.innerHTML = html.replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
}

function setup() {
  const api = new MockApiClient({ fixturesOrigin: null, latencyMs: 0 });
  const sent: SiteCheckRequest[] = [];
  const protection = new SiteProtection({
    api: { siteCheck: (r, s) => (sent.push(structuredClone(r)), api.siteCheck(r, s)) },
    summarize: async () => resanitizeSummary(extractPageSummary(document).summary),
    onChange: () => {},
    settleMs: 0,
    requestTimeoutMs: 10_000,
  });
  return { protection, sent };
}

async function visit(protection: SiteProtection, page: string, url: string) {
  load(page, url);
  protection.navigationStarted(url);
  protection.pageLoaded(url);
  await vi.advanceTimersByTimeAsync(400);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('protección de sitios con el backend simulado', () => {
  it('cada página de demostración produce su estado', async () => {
    const cases: Array<[string, string, ReturnType<typeof siteIndicatorState> | 'unverified']> = [
      ['banco.html', 'http://banco-demo.example:47321/banco.html', 'official'],
      ['horarios.html', 'http://tramites.mostrame-demo.gob.ar:47321/horarios.html', 'official'],
      ['horarios.html', 'http://sin-alertas.example:47321/horarios.html', 'no_alerts'],
      ['urgente.html', 'http://atencion.example:47321/urgente.html', 'attention'],
      ['banco-falso.html', 'http://bancodemo-acceso.example:47321/banco-falso.html', 'possible_scam'],
      ['premio.html', 'http://premio-gratis.example:47321/premio.html', 'possible_scam'],
      ['horarios.html', 'http://falla.example:47321/horarios.html', 'unverified'],
      ['horarios.html', 'http://parcial.example:47321/horarios.html', 'unverified'],
      ['horarios.html', 'https://es.wikipedia.org/wiki/Mate', 'unverified'],
    ];
    for (const [page, url, expected] of cases) {
      const { protection } = setup();
      await visit(protection, page, url);
      expect(protection.snapshot.kind, url).toBe(expected);
    }
  });

  it('«Sitio oficial» trae su fuente de autoridad', async () => {
    for (const [url, basis, organization] of [
      ['http://banco-demo.example:47321/banco.html', 'financial_regulator', 'Banco de Demostración'],
      ['http://tramites.mostrame-demo.gob.ar:47321/horarios.html', 'government_domain', 'Estado argentino'],
    ] as const) {
      const { protection } = setup();
      await visit(protection, url.endsWith('banco.html') ? 'banco.html' : 'horarios.html', url);
      expect(protection.snapshot.response?.identity).toEqual({ status: 'verified_official', basis, organization });
    }
  });

  it('la imitación avisa ya en la fase dirección', async () => {
    const { protection } = setup();
    protection.navigationStarted('http://bancodemo-acceso.example:47321/banco-falso.html');
    await vi.advanceTimersByTimeAsync(400);
    expect(protection.snapshot).toMatchObject({ kind: 'possible_scam', warningOpen: true });
    expect(protection.snapshot.response?.identity.impersonatedOrganization).toBe('Banco de Demostración');
  });

  it('lenta queda revisando y sin respuesta vence el tiempo máximo', async () => {
    const { protection } = setup();
    await visit(protection, 'horarios.html', 'http://lenta.example:47321/horarios.html');
    expect(protection.snapshot.kind).toBe('checking');
    await vi.advanceTimersByTimeAsync(6000);
    expect(protection.snapshot.kind).toBe('no_alerts');

    await visit(protection, 'horarios.html', 'http://sin-respuesta.example:47321/horarios.html');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(protection.snapshot.kind).toBe('unverified');
  });

  it('las páginas locales no se envían', async () => {
    const { protection, sent } = setup();
    await visit(protection, 'proteccion.html', 'http://127.0.0.1:47321/proteccion.html');
    expect(protection.snapshot.kind).toBe('local');
    expect(sent).toHaveLength(0);
  });

  it('nada de lo escrito en la página, cookies ni tokens de la URL sale del equipo', async () => {
    const { protection, sent } = setup();
    load('banco-falso.html', 'http://bancodemo-acceso.example:47321/banco-falso.html?token=tok_9f8e7d6c5b4a3210zz&dni=30123456#ana@correo.com');
    document.cookie = 'sesion=cookie-secreta-123';
    for (const input of document.querySelectorAll('input')) (input as HTMLInputElement).value = 'Secreto123!';
    protection.navigationStarted(document.URL);
    protection.pageLoaded(document.URL);
    await vi.advanceTimersByTimeAsync(400);
    expect(sent).toHaveLength(2);
    expect(PageSummary.safeParse(sent[1]!.page).success).toBe(true);
    expect(sent[1]!.page!.forms.flatMap((f) => f.fields.map((x) => x.type))).toContain('password');
    expect(findLeaks(sent, ['Secreto123!', 'cookie-secreta', 'tok_9f8e7d6c5b4a3210zz', '30123456', 'ana@correo.com'])).toEqual([]);
  });

  it('las respuestas simuladas cumplen el contrato', () => {
    const base = { navigationId: 'nav-1', url: 'https://x.example/', registrableDomain: 'x.example' };
    for (const hostname of ['banco-demo.example', 'tramites.mostrame-demo.gob.ar', 'atencion.example', 'bancodemo-acceso.example', 'premio-gratis.example', 'parcial.example', 'otro.example']) {
      for (const contentVersion of [0, 1]) {
        const page = { text: '', forms: [], links: [], scriptHosts: [], iframeHosts: [] };
        const response = mockSiteCheck({ ...base, hostname, contentVersion, ...(contentVersion ? { page } : {}) });
        expect(SiteCheckResponse.safeParse(response).success).toBe(true);
      }
    }
  });
});

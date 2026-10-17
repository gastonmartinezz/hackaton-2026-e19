import { describe, expect, it } from 'vitest';
import { SiteCheckRequest, SiteCheckResponse, siteIndicatorState, type SiteCheckReason, type SiteCheckResponse as Response } from '../src/index.js';

const base = {
  navigationId: 'nav-1',
  contentVersion: 0,
  url: 'https://www.argentina.gob.ar/',
  hostname: 'www.argentina.gob.ar',
  registrableDomain: 'argentina.gob.ar',
};

const page = { text: 'Hola', forms: [], links: [], scriptHosts: [], iframeHosts: [] };

describe('SiteCheckRequest', () => {
  it('la fase de dirección no lleva page y la de contenido sí', () => {
    expect(SiteCheckRequest.safeParse(base).success).toBe(true);
    expect(SiteCheckRequest.safeParse({ ...base, page }).success).toBe(false);
    expect(SiteCheckRequest.safeParse({ ...base, contentVersion: 1 }).success).toBe(false);
    expect(SiteCheckRequest.safeParse({ ...base, contentVersion: 1, page }).success).toBe(true);
  });

  it('los campos de formulario no aceptan valores', () => {
    const form = { method: 'post', action: null, fields: [{ type: 'password', value: 'secreto' }] };
    expect(SiteCheckRequest.safeParse({ ...base, contentVersion: 1, page: { ...page, forms: [form] } }).success).toBe(false);
  });
});

const SOURCE = { name: 'Disposición NIC Argentina 153/2016', reviewedAt: '2026-10-17T00:00:00Z' };

const complete = { reputation: 'complete', identity: 'complete', content: 'complete', registration: 'unavailable', connection: 'unavailable' } as const;

const response = (over: Partial<Response> = {}): Response =>
  SiteCheckResponse.parse({
    navigationId: 'nav-1',
    contentVersion: 1,
    analysisId: 'a-1',
    status: 'complete',
    identity: { status: 'unknown' },
    risk: 'no_signals',
    reasons: [],
    coverage: complete,
    checkedAt: '2026-10-17T22:00:00Z',
    expiresAt: '2026-10-17T22:15:00Z',
    ...over,
  });

const phishing: SiteCheckReason = { code: 'KNOWN_PHISHING', category: 'fraud', evidence: [{ source: 'test', checkedAt: '2026-10-17T22:00:00Z', observedBy: 'service', detail: 'listado' }] };

describe('siteIndicatorState', () => {
  it('el riesgo alto tiene prioridad sobre la identidad oficial', () => {
    const r = response({ risk: 'high', identity: { status: 'verified_official', basis: 'government_domain', organization: 'X', source: SOURCE }, reasons: [phishing] });
    expect(siteIndicatorState(r)).toBe('possible_scam');
  });

  it('oficial solo con identidad verificada y cobertura completa', () => {
    expect(siteIndicatorState(response({ identity: { status: 'verified_official', basis: 'government_domain', organization: 'X', source: SOURCE } }))).toBe('official');
    expect(siteIndicatorState(response())).toBe('no_alerts');
  });

  it('un resultado parcial o con cobertura insuficiente no es favorable', () => {
    expect(siteIndicatorState(response({ status: 'partial' }))).toBe('unverified');
    expect(siteIndicatorState(response({ coverage: { ...complete, reputation: 'unavailable' } }))).toBe('unverified');
    expect(siteIndicatorState(response({ status: 'unavailable', risk: 'unknown' }))).toBe('unverified');
  });

  it('pending muestra revisando salvo que ya haya riesgo', () => {
    expect(siteIndicatorState(response({ status: 'pending', coverage: { ...complete, content: 'pending' } }))).toBe('checking');
    expect(siteIndicatorState(response({ status: 'pending', risk: 'medium' }))).toBe('attention');
  });
});

describe('SiteIdentity', () => {
  it('la oficialidad exige una fuente de autoridad', () => {
    expect(() => response({ identity: { status: 'verified_official', organization: 'X' } })).toThrow();
    expect(() => response({ identity: { status: 'unknown', basis: 'government_domain' } })).toThrow();
    expect(() => response({ identity: { status: 'verified_official', basis: 'official_catalog', organization: 'X' } })).toThrow();
  });
});

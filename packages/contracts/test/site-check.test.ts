import { describe, expect, it } from 'vitest';
import { SiteCheckRequest, SiteCheckResponse, siteIndicatorState, type SiteCheckReason, type SiteCheckResponse as Response } from '../src/index.js';

const base = {
  navigationId: 'nav-1',
  contentVersion: 0,
  url: 'https://www.gub.uy/',
  hostname: 'www.gub.uy',
  registrableDomain: 'gub.uy',
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

const SOURCE = { name: 'nic.uy: gub.uy solo vía AGESIC', url: 'https://nic.uy/', reviewedAt: '2026-10-17T00:00:00Z' };
const OFFICIAL = { status: 'verified_official', basis: 'government_domain', organization: 'Estado uruguayo', source: SOURCE } as const;

const complete = { identity: 'complete', content: 'complete', registration: 'unavailable', connection: 'unavailable' } as const;

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

const evidence = [{ source: 'test', checkedAt: '2026-10-17T22:00:00Z', observedBy: 'service', detail: 'x' }] as const;
const lookalike: SiteCheckReason = { code: 'LOOKALIKE_DOMAIN', category: 'fraud', evidence: [...evidence] };
const noHttps: SiteCheckReason = { code: 'NO_HTTPS', category: 'technical', evidence: [...evidence] };

describe('siteIndicatorState', () => {
  it('el riesgo alto tiene prioridad sobre la identidad oficial', () => {
    expect(siteIndicatorState(response({ risk: 'high', identity: OFFICIAL, reasons: [lookalike] }))).toBe('possible_scam');
  });

  it('oficial solo con identidad verificada, identidad y contenido completos y sin motivos de fraude', () => {
    expect(siteIndicatorState(response({ identity: OFFICIAL }))).toBe('official');
    expect(siteIndicatorState(response({ identity: OFFICIAL, reasons: [noHttps] }))).toBe('official');
    expect(siteIndicatorState(response({ identity: OFFICIAL, status: 'partial', coverage: { ...complete, identity: 'partial' } }))).toBe('unverified');
    expect(siteIndicatorState(response({ identity: OFFICIAL, status: 'partial', coverage: { ...complete, content: 'partial' } }))).toBe('unverified');
    expect(siteIndicatorState(response({ identity: OFFICIAL, risk: 'unknown', reasons: [lookalike] }))).toBe('unverified');
  });

  it('sin alertas exige status complete, riesgo sin señales, identidad y contenido completos y sin motivos de fraude', () => {
    expect(siteIndicatorState(response())).toBe('no_alerts');
    expect(siteIndicatorState(response({ reasons: [noHttps] }))).toBe('no_alerts');
    expect(siteIndicatorState(response({ status: 'partial' }))).toBe('unverified');
    expect(siteIndicatorState(response({ risk: 'unknown' }))).toBe('unverified');
    expect(siteIndicatorState(response({ coverage: { ...complete, identity: 'unavailable' } }))).toBe('unverified');
    expect(siteIndicatorState(response({ coverage: { ...complete, content: 'partial' } }))).toBe('unverified');
    expect(siteIndicatorState(response({ reasons: [lookalike] }))).toBe('unverified');
    expect(siteIndicatorState(response({ status: 'unavailable', risk: 'unknown' }))).toBe('unverified');
  });

  it('pending muestra revisando salvo que ya haya riesgo', () => {
    expect(siteIndicatorState(response({ status: 'pending', coverage: { ...complete, content: 'pending' } }))).toBe('checking');
    expect(siteIndicatorState(response({ status: 'pending', risk: 'medium' }))).toBe('attention');
  });
});

describe('SiteCheckCoverage', () => {
  it('no tiene reputación: el backend no consulta listas de reportes', () => {
    expect(() => response({ coverage: { ...complete, reputation: 'complete' } as unknown as Response['coverage'] })).toThrow();
  });
});

describe('SiteIdentity', () => {
  it('la oficialidad exige una fuente de autoridad', () => {
    expect(() => response({ identity: { status: 'verified_official', organization: 'X' } })).toThrow();
    expect(() => response({ identity: { status: 'unknown', basis: 'government_domain' } })).toThrow();
    expect(() => response({ identity: { status: 'verified_official', basis: 'official_catalog', organization: 'X' } })).toThrow();
  });
});

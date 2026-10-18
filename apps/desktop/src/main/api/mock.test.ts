import { siteIndicatorState } from '@hackaton/contracts';
import { describe, expect, it } from 'vitest';
import { MockApiClient } from './mock';

const request = {
  navigationId: 'nav-1',
  contentVersion: 0,
  url: 'https://banco-demo.example/',
  hostname: 'banco-demo.example',
  registrableDomain: 'banco-demo.example',
};

describe('MockApiClient: Protección de sitios', () => {
  it('en desarrollo responde los casos de demostración', async () => {
    const api = new MockApiClient({ fixturesOrigin: null, latencyMs: 0 });
    const response = await api.siteCheck(request, new AbortController().signal);
    expect(response.identity).toMatchObject({ status: 'verified_official', basis: 'financial_regulator' });
  });

  it('fuera de desarrollo nunca inventa «Sitio oficial»: no pudimos verificarlo', async () => {
    const api = new MockApiClient({ fixturesOrigin: null, latencyMs: 0, demoSiteCheck: false });
    const response = await api.siteCheck(request, new AbortController().signal);
    expect(response).toMatchObject({ navigationId: 'nav-1', contentVersion: 0, identity: { status: 'unknown' }, risk: 'unknown' });
    expect(siteIndicatorState(response)).toBe('unverified');
  });
});

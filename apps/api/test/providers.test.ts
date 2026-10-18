import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/modules/site-check/cache.js';
import { RdapClient } from '../src/modules/site-check/rdap.js';
import { ReputationChecker, SafeBrowsingProvider, WebRiskProvider } from '../src/modules/site-check/reputation.js';
import { fakeRdapFetch } from './site-check-helpers.js';

function recordingFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json(body, { status });
  }) as typeof fetch;
  return { impl, calls };
}

const limits = { timeoutMs: 1000, maxPerMinute: 100 };

describe('Google Safe Browsing (Lookup API v4)', () => {
  it('consulta threatMatches:find y traduce los tipos de amenaza', async () => {
    const fetch = recordingFetch({ matches: [{ threatType: 'SOCIAL_ENGINEERING', cacheDuration: '300s' }] });
    const checker = new ReputationChecker(new SafeBrowsingProvider('clave-de-prueba', fetch.impl), limits);
    const result = await checker.check(new URL('https://phish.example.com/login'));
    expect(result).toMatchObject({ coverage: 'complete', ttlMs: 300_000, data: { threats: ['phishing'] } });
    expect(result.findings[0]).toMatchObject({ code: 'KNOWN_PHISHING', observedBy: 'external_scanner' });
    expect(fetch.calls[0]!.url).toMatch(/^https:\/\/safebrowsing\.googleapis\.com\/v4\/threatMatches:find\?key=/);
    const body = JSON.parse(String(fetch.calls[0]!.init!.body));
    expect(body.threatInfo.threatEntries).toEqual([{ url: 'https://phish.example.com/login' }, { url: 'https://phish.example.com/' }]);
  });

  it('sin coincidencias: cobertura completa sin motivos', async () => {
    const checker = new ReputationChecker(new SafeBrowsingProvider('k', recordingFetch({}).impl), limits);
    expect(await checker.check(new URL('https://ok.example.com/'))).toMatchObject({ coverage: 'complete', findings: [] });
  });

  it('un error HTTP queda como unavailable, sin la clave en el error', async () => {
    const checker = new ReputationChecker(new SafeBrowsingProvider('clave-secreta', recordingFetch({ error: {} }, 403).impl), limits);
    const result = await checker.check(new URL('https://ok.example.com/'));
    expect(result).toMatchObject({ coverage: 'unavailable', errors: ['http_403'] });
    expect(JSON.stringify(result)).not.toContain('clave-secreta');
  });
});

describe('Google Web Risk', () => {
  it('consulta uris:search por URL', async () => {
    const fetch = recordingFetch({ threat: { threatTypes: ['MALWARE'], expireTime: new Date(Date.now() + 60_000).toISOString() } });
    const checker = new ReputationChecker(new WebRiskProvider('k', fetch.impl), limits);
    const result = await checker.check(new URL('https://malo.example.com/'));
    expect(result.findings.map((f) => f.code)).toEqual(['KNOWN_MALWARE']);
    expect(fetch.calls).toHaveLength(1); // la URL ya es la raíz
    expect(fetch.calls[0]!.url).toMatch(/^https:\/\/webrisk\.googleapis\.com\/v1\/uris:search\?/);
  });
});

describe('límites de uso', () => {
  it('con el tope por minuto alcanzado la reputación queda unavailable', async () => {
    const fetch = recordingFetch({});
    const checker = new ReputationChecker(new SafeBrowsingProvider('k', fetch.impl), { timeoutMs: 1000, maxPerMinute: 1 });
    await checker.check(new URL('https://a.example.com/'));
    const second = await checker.check(new URL('https://b.example.com/'));
    expect(second).toMatchObject({ coverage: 'unavailable', errors: ['rate_limited'] });
    expect(fetch.calls).toHaveLength(1);
  });
});

describe('RDAP', () => {
  it('usa el bootstrap de IANA y consulta solo el dominio registrable', async () => {
    const fetch = fakeRdapFetch({ registeredAt: '2010-01-02T00:00:00Z' });
    const rdap = new RdapClient({ ...limits, enabled: true, fetchImpl: fetch.impl });
    const result = await rdap.lookup('ejemplo.net');
    expect(result).toMatchObject({ coverage: 'complete', data: { registeredAt: '2010-01-02T00:00:00Z', registrar: 'Registrador de prueba' }, findings: [] });
    expect(fetch.calls).toEqual(['https://data.iana.org/rdap/dns.json', 'https://rdap.prueba/domain/ejemplo.net']);
    // Segunda consulta: bootstrap y dominio en caché.
    await rdap.lookup('ejemplo.net');
    expect(fetch.calls).toHaveLength(2);
  });

  it('un TLD sin servicio RDAP queda unavailable con la limitación explicada', async () => {
    const rdap = new RdapClient({ ...limits, enabled: true, fetchImpl: fakeRdapFetch().impl });
    const result = await rdap.lookup('ejemplo.uy');
    expect(result).toMatchObject({ coverage: 'unavailable', errors: ['no_rdap_service'] });
    expect(result.limitations[0]).toMatch(/\.uy/);
  });

  it('el tiempo máximo produce unavailable', async () => {
    const rdap = new RdapClient({ timeoutMs: 20, maxPerMinute: 10, enabled: true, fetchImpl: fakeRdapFetch({ hang: true }).impl });
    expect(await rdap.lookup('ejemplo.com')).toMatchObject({ coverage: 'unavailable', errors: ['timeout'] });
  });
});

describe('caché con vencimiento', () => {
  it('vence según el TTL de cada resultado y no guarda fallas', async () => {
    let now = 0;
    const cache = new TtlCache<number>(10, () => now);
    let loads = 0;
    const load = async () => ++loads;
    await cache.getOrLoad('a', load, () => 1000);
    await cache.getOrLoad('a', load, () => 1000);
    expect(loads).toBe(1);
    now = 1001;
    await cache.getOrLoad('a', load, () => 1000);
    expect(loads).toBe(2);
    await cache.getOrLoad('b', load, () => 0);
    await cache.getOrLoad('b', load, () => 0);
    expect(loads).toBe(4);
  });
});

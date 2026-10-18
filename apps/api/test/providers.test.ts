import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/modules/site-check/cache.js';
import { RdapClient } from '../src/modules/site-check/rdap.js';
import { fakeRdapFetch } from './site-check-helpers.js';

const limits = { timeoutMs: 1000, maxPerMinute: 100 };

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

  it('con el tope por minuto alcanzado queda unavailable sin consultar', async () => {
    const fetch = fakeRdapFetch();
    const rdap = new RdapClient({ timeoutMs: 1000, maxPerMinute: 1, enabled: true, fetchImpl: fetch.impl });
    await rdap.lookup('a.com');
    const calls = fetch.calls.length;
    expect(await rdap.lookup('b.com')).toMatchObject({ coverage: 'unavailable', errors: ['rate_limited'] });
    expect(fetch.calls).toHaveLength(calls);
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

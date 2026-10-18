import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeRisk } from '../src/modules/site-check/aggregate.js';
import { AuthorityView, loadPopularDomains } from '../src/modules/site-check/authority.js';
import { BcraRegistry, parseWebsite } from '../src/modules/site-check/bcra-registry.js';
import { describeHost, editDistance, hostMatches } from '../src/modules/site-check/domain.js';
import { lookalikeSignals } from '../src/modules/site-check/lookalike.js';
import { loadOfficialSources } from '../src/modules/site-check/official-sources.js';
import { redactText, sanitizeUrl } from '../src/modules/site-check/sanitize.js';
import { fakeRdapFetch, TEST_CATALOGS } from './site-check-helpers.js';

const HOUR = 60 * 60_000;
const registry = (fetchImpl = fakeRdapFetch().impl, now?: () => number) =>
  new BcraRegistry({ enabled: true, fetchImpl, requestTimeoutMs: 1000, refreshAfterMs: 24 * HOUR, validForMs: 48 * HOUR, usableForMs: 168 * HOUR, retryAfterMs: 0, now });

let view: AuthorityView;
beforeAll(async () => {
  view = new AuthorityView(loadOfficialSources({ catalogFiles: TEST_CATALOGS }), await registry().state(1000), []);
});

const signals = (hostname: string) =>
  lookalikeSignals(describeHost(hostname), view.references(), view.zoneReferences()).map((s) => [s.code, s.organization]);

describe('fuentes de autoridad', () => {
  it('zona de gobierno por límites de dominio, nunca por sufijo de texto', () => {
    expect(view.official('www.anses.gob.ar')).toMatchObject({ basis: 'government_domain', organization: 'Estado argentino', matched: 'gob.ar' });
    expect(view.official('www.anses.gob.ar')?.source).toMatchObject({
      url: 'https://www.argentina.gob.ar/normativa/nacional/norma-270431/texto',
      reviewedAt: '2026-10-17T00:00:00.000Z',
    });
    expect(view.official('www.irs.gov')).toMatchObject({ basis: 'government_domain', organization: 'Gobierno de Estados Unidos' });
    expect(view.official('anses.gob.ar.evil.com')).toBeNull();
    expect(view.official('anses-gob-ar.com')).toBeNull();
    expect(view.official('evilanses.gobar.com')).toBeNull();
    expect(view.official('foo.gob.bo')).toBeNull(); // no se generaliza a cualquier gob.xx
    expect(view.official('gob.ar')).toBeNull();
  });

  it('padrón del BCRA: dominio registrable del sitio publicado por el regulador', () => {
    const match = view.official('online.bna.com.ar');
    expect(match).toMatchObject({ basis: 'financial_regulator', organization: 'BANCO DE LA NACION ARGENTINA', matched: 'bna.com.ar' });
    expect(match?.source.name).toBe('Padrón de entidades financieras del BCRA');
    expect(match?.source.url).toContain('category=00011');
    expect(view.official('www.bancociudad.com.ar')?.basis).toBe('financial_regulator'); // publicado con path
    expect(view.official('bna.com.ar.evil.com')).toBeNull();
    expect(view.official('xbna.com.ar')).toBeNull();
  });

  it('descarta sitios web del padrón que no se pueden usar', () => {
    expect(parseWebsite('www.mobilize fs.com.ar')).toEqual({ reason: 'sitio web con espacios' });
    expect(parseWebsite('')).toEqual({ reason: 'sin sitio web' });
    expect(parseWebsite('www.jpmorgan.com/country/ar/es/jpmorgan')).toMatchObject({ domain: 'jpmorgan.com' });
    expect(view.registry.snapshot?.skipped.map((s) => s.code).sort()).toEqual(['00269', '00339']);
  });

  it('catálogo curado con fuente y fecha por entrada; alcance exact', () => {
    expect(view.official('www.antel.com.uy')).toMatchObject({ basis: 'official_catalog', organization: 'Antel' });
    expect(view.official('www.antel.com.uy')?.source).toEqual({ name: 'https://www.antel.com.uy/', url: 'https://www.antel.com.uy/', reviewedAt: '2026-10-16T00:00:00.000Z' });
    expect(view.official('ebanking.brou.uy')?.basis).toBe('official_catalog');
    expect(view.official('www.ebanking.brou.uy')).toBeNull();
    expect(view.official('tramites.gub.uy')).toMatchObject({ basis: 'government_domain', organization: 'Estado uruguayo' });
    expect(hostMatches('a.x.com.ar', 'x.com.ar', 'subdomains')).toBe(true);
  });

  it('rechaza un catálogo inválido o con dominios repetidos', () => {
    const bad = join(tmpdir(), `official-sites.bad-${process.pid}.json`);
    writeFileSync(bad, JSON.stringify({ version: '1', country: 'UY', reviewedAt: '2026-10-17', entries: [{ id: 'x', organization: 'X' }] }));
    expect(() => loadOfficialSources({ catalogFiles: [bad] })).toThrow(/Fuente oficial inválida/);
    const dup = join(tmpdir(), `official-sites.dup-${process.pid}.json`);
    const entry = (id: string) => ({ id, organization: id, category: 'x', domains: [{ domain: 'x.com.uy', scope: 'exact' }], source: 's', sourceType: 't', reviewedAt: '2026-10-17' });
    writeFileSync(dup, JSON.stringify({ version: '1', country: 'UY', reviewedAt: '2026-10-17', entries: [entry('a'), entry('b')] }));
    expect(() => loadOfficialSources({ catalogFiles: [dup] })).toThrow(/x\.com\.uy/);
  });

  it('organizaciones declaradas: Estado, padrón y catálogo', () => {
    expect(view.claims('ANSES - Mi cuenta').map((c) => [c.via, c.keys])).toEqual([['government_domain', ['gov:AR']]]);
    expect(view.claims('Banco Nación').map((c) => c.organization)).toEqual(['BANCO DE LA NACION ARGENTINA']);
    expect(view.claims('Banco Galicia').map((c) => c.organization)).toEqual(['BANCO DE GALICIA Y BUENOS AIRES S.A']);
    expect(view.claims('Galicia', { kind: 'financial_entity', country: 'AR' }).map((c) => c.organization)).toEqual(['BANCO DE GALICIA Y BUENOS AIRES S.A']);
    expect(view.claims('LA NACION')).toEqual([]); // un diario, no el banco
    expect(view.claims('Galicia')).toEqual([]);
    expect(view.claims('Banco Provincia')[0]?.keys).toContain('bcra:00014');
    expect(view.claims('Antel')[0]).toMatchObject({ via: 'official_catalog', keys: ['catalog:antel'] });
    expect(view.claims('BROU')[0]?.keys).toEqual(['catalog:brou']);
    expect(view.claims('Diario La Nación')).toEqual([]); // sin palabra financiera, "nacion" sola no alcanza
    expect(view.claims('Argentina')).toEqual([]);
    expect(view.claims('Organismo X', { kind: 'government', country: 'AR' })[0]?.keys).toEqual(['gov:AR']);
  });
});

describe('padrón del BCRA', () => {
  it('caído y sin copia: no disponible', async () => {
    const state = await registry(fakeRdapFetch({ bcraDown: true }).impl).state(1000);
    expect(state).toMatchObject({ status: 'unavailable', snapshot: null });
  });

  it('usa la última copia: vigente hasta 48 h, vieja (no aprueba) hasta 7 días', async () => {
    let now = Date.parse('2026-10-17T00:00:00Z');
    let down = false;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => fakeRdapFetch({ bcraDown: down }).impl(input, init)) as typeof fetch;
    const reg = registry(fetchImpl, () => now);
    expect((await reg.state(1000)).status).toBe('fresh');
    down = true;
    now += 30 * HOUR; // el refresco falla, la copia sigue vigente
    expect((await reg.state(1000)).status).toBe('fresh');
    now += 30 * HOUR;
    const stale = await reg.state(1000);
    expect(stale.status).toBe('stale');
    expect(new AuthorityView(loadOfficialSources({ catalogFiles: [] }), stale, []).official('www.bna.com.ar')).toBeNull();
    now += 7 * 24 * HOUR;
    expect((await reg.state(1000)).status).toBe('unavailable');
  });
});

describe('dominios parecidos (sin lista manual)', () => {
  it.each([
    ['anses-gob-ar.com', 'LOOKALIKE_DOMAIN', 'Estado argentino'],
    ['anses-gob.ar.com', 'LOOKALIKE_DOMAIN', 'Estado argentino'],
    ['anses.gob.ar.evil.com', 'MISLEADING_SUBDOMAIN', 'Estado argentino'],
    ['tramites-gub-uy.com', 'LOOKALIKE_DOMAIN', 'Estado uruguayo'],
    ['gub-uy.com', 'LOOKALIKE_DOMAIN', 'Estado uruguayo'],
    ['bna-seguro.com', 'LOOKALIKE_DOMAIN', 'BANCO DE LA NACION ARGENTINA'], // marca + palabra clave
    ['bna-ar.com', 'LOOKALIKE_DOMAIN', 'BANCO DE LA NACION ARGENTINA'], // cambio de terminación
    ['bna.com.ar.verificacion.net', 'MISLEADING_SUBDOMAIN', 'BANCO DE LA NACION ARGENTINA'],
    ['bna.secure-login.com', 'MISLEADING_SUBDOMAIN', 'BANCO DE LA NACION ARGENTINA'],
    ['bancoprovincla.com.ar', 'LOOKALIKE_DOMAIN', 'BANCO DE LA PROVINCIA DE BUENOS AIR'], // una letra
    ['santander-login.com', 'LOOKALIKE_DOMAIN', 'BANCO SANTANDER ARGENTINA S.A.'],
    ['antel-uy.com', 'LOOKALIKE_DOMAIN', 'Antel'],
    ['brou.com.uy.verificacion.net', 'MISLEADING_SUBDOMAIN', 'Banco República (BROU)'],
    ['xn--mcro-53d.com.ar', 'CONFUSABLE_CHARACTERS', 'BANCO MACRO S.A.'], // "mаcro" con a cirílica
    ['anses.xn--gb-jbc.ar', 'CONFUSABLE_CHARACTERS', 'Estado argentino'], // "gοb.ar" con ómicron griega
  ])('%s → %s', (hostname, code, organization) => {
    expect(signals(hostname)).toContainEqual([code, organization]);
  });

  it('cambio de terminación: solo con lista de populares, para no marcar sitios globales', () => {
    expect(signals('bancociudad.com')).toEqual([]);
    expect(signals('www.santander.com')).toEqual([]);
    const tldSwap = (hostname: string) => lookalikeSignals(describeHost(hostname), view.references(), [], { tldSwap: true }).map((s) => s.code);
    expect(tldSwap('bancociudad.com')).toEqual(['LOOKALIKE_DOMAIN']);
  });

  it('no marca sitios sin relación ni marcas dentro de otras palabras', () => {
    expect(signals('www.aerolineas.com.ar')).toEqual([]);
    expect(signals('www.mercadolibre.com.ar')).toEqual([]);
    expect(signals('www.bancogalicia.com')).toEqual([]); // "banco" no es palabra clave
    expect(signals('www.blog-ar.com')).toEqual([]);
    expect(signals('www.macrosoft.com')).toEqual([]);
    expect(signals('www.antelope.com')).toEqual([]);
  });

  it('una lista opcional de dominios populares suma referencias (nunca oficialidad)', () => {
    const file = join(tmpdir(), `crux-${process.pid}.csv`);
    writeFileSync(file, 'origin,rank\nhttps://www.mercadolibre.com.ar,1000\nhttps://www.mercadopago.com.ar,1000\n');
    const popular = loadPopularDomains(file, 10);
    expect(popular.map((p) => p.domain)).toEqual(['mercadolibre.com.ar', 'mercadopago.com.ar']);
    expect(lookalikeSignals(describeHost('mercadolibre-pagos.com'), popular, []).map((s) => s.code)).toContain('LOOKALIKE_DOMAIN');
    expect(lookalikeSignals(describeHost('www.mercadolibre.com.ar'), popular, [])).toEqual([]);
  });

  it('compara sin guiones las referencias que los tienen (banco-ejemplo.com.uy)', () => {
    const file = join(tmpdir(), `crux-guiones-${process.pid}.csv`);
    writeFileSync(file, 'origin,rank\nhttps://www.banco-ejemplo.com.uy,1000\n');
    const refs = loadPopularDomains(file, 10);
    const codes = (hostname: string) => lookalikeSignals(describeHost(hostname), refs, []).map((s) => s.code);
    // Una letra de diferencia y marca + palabra clave, escritas sin el guion.
    expect(codes('bancoejenplo.com.uy')).toContain('LOOKALIKE_DOMAIN');
    expect(codes('bancoejemplologin.com')).toContain('LOOKALIKE_DOMAIN');
    expect(codes('www.banco-ejemplo.com.uy')).toEqual([]);
  });

  it('mezcla de alfabetos y distancia de edición', () => {
    expect(signals('xn--pypal-4ve.com').map(([code]) => code)).toContain('CONFUSABLE_CHARACTERS');
    expect(editDistance('anses', 'asnes')).toBe(1);
  });
});

describe('hosts internos', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '10.1.2.3', '192.168.0.10', '169.254.169.254', '[::1]', 'intranet', 'servidor.local', 'algo.internal', 'nas.corp'])(
    '%s es interno',
    (hostname) => expect(describeHost(hostname).internal).toBe(true),
  );

  it.each(['www.argentina.gob.ar', 'example.com', 'usuario.github.io', '8.8.8.8'])('%s es público', (hostname) => {
    expect(describeHost(hostname).internal).toBe(false);
  });
});

describe('sanitización en el backend', () => {
  it('quita credenciales, query, fragmento y segmentos secretos del path', () => {
    const url = sanitizeUrl('https://user:pass@sitio.com.ar/reset/a1b2c3d4e5f6g7h8i9j0/ana@mail.com/12345678?token=abc#frag');
    expect(url?.toString()).toBe('https://sitio.com.ar/reset/redactado/redactado/redactado');
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('redacta correos, números largos y tokens del texto; las URLs quedan como hostname', () => {
    const text = redactText('Escribí a ana@mail.com, tu CBU 0110599520000001234567 y token abc123def456. Ver https://banco.com/x?dni=1', 200);
    expect(text).not.toMatch(/ana@mail|0110599520000001234567|abc123def456|dni=/);
    expect(text).toContain('banco.com');
  });
});

describe('riesgo determinístico', () => {
  it('una señal fuerte alcanza para riesgo alto', () => {
    expect(computeRisk(new Set(['KNOWN_PHISHING']), true)).toBe('high');
    expect(computeRisk(new Set(['LOOKALIKE_DOMAIN']), false)).toBe('high');
  });

  it('las debilidades técnicas nunca dan riesgo alto por sí solas', () => {
    expect(computeRisk(new Set(['NO_HTTPS', 'CERTIFICATE_PROBLEM', 'CROSS_DOMAIN_REDIRECT']), true)).toBe('no_signals');
    expect(computeRisk(new Set(['INSECURE_FORM_ACTION', 'NO_HTTPS']), true)).toBe('medium');
  });

  it('el registro reciente es solo apoyo: medio solo, alto combinado', () => {
    expect(computeRisk(new Set(['RECENTLY_REGISTERED']), true)).toBe('medium');
    expect(computeRisk(new Set(['RECENTLY_REGISTERED', 'BRAND_IMPERSONATION']), true)).toBe('high');
  });

  it('sin motivos y con cobertura incompleta el riesgo es desconocido', () => {
    expect(computeRisk(new Set(), false)).toBe('unknown');
    expect(computeRisk(new Set(), true)).toBe('no_signals');
  });
});

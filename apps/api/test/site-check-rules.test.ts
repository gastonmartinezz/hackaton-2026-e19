import { X509Certificate } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeRisk } from '../src/modules/site-check/aggregate.js';
import { AuthorityService, AuthorityView } from '../src/modules/site-check/authority.js';
import { bcuFetch, BcuRegistry, parseWebsite, parseWebsites, type BcuRegistryOptions } from '../src/modules/site-check/bcu-registry.js';
import { describeHost, editDistance, hostMatches } from '../src/modules/site-check/domain.js';
import { lookalikeSignals, type Reference } from '../src/modules/site-check/lookalike.js';
import { DATA_DIR, loadOfficialSources } from '../src/modules/site-check/official-sources.js';
import { redactText, sanitizeUrl } from '../src/modules/site-check/sanitize.js';
import { fakeRdapFetch, TEST_CATALOGS } from './site-check-helpers.js';

const HOUR = 60 * 60_000;
const registry = (fetchImpl = fakeRdapFetch().impl, now?: () => number, extra: Partial<BcuRegistryOptions> = {}) =>
  new BcuRegistry({ enabled: true, fetchImpl, requestTimeoutMs: 1000, refreshAfterMs: 24 * HOUR, validForMs: 48 * HOUR, usableForMs: 168 * HOUR, retryAfterMs: 0, now, ...extra });

let view: AuthorityView;
/** Con el catálogo real de data/ (Udelar, Claro, Universal…), para las palabras comunes. */
let realView: AuthorityView;
beforeAll(async () => {
  const state = await registry().state(1000);
  view = new AuthorityView(loadOfficialSources({ catalogFiles: TEST_CATALOGS }), state);
  realView = new AuthorityView(loadOfficialSources(), state);
});

const signals = (hostname: string, authority = view) =>
  lookalikeSignals(describeHost(hostname), authority.references(), authority.zoneReferences()).map((s) => [s.code, s.organization]);

describe('fuentes de autoridad', () => {
  it('zona de gobierno por límites de dominio, nunca por sufijo de texto', () => {
    expect(view.official('www.bps.gub.uy')).toMatchObject({ basis: 'government_domain', organization: 'Estado uruguayo', matched: 'gub.uy' });
    expect(view.official('www.bps.gub.uy')?.source).toMatchObject({ url: 'https://www.gub.uy/', reviewedAt: '2026-10-17T00:00:00.000Z' });
    // La app es para Uruguay: las zonas de Estados Unidos (.gov, .mil) no se reconocen.
    expect(realView.official('www.irs.gov')).toBeNull();
    expect(realView.official('www.army.mil')).toBeNull();
    expect(realView.official('www.ejercito.mil.uy')).toMatchObject({ basis: 'government_domain', matched: 'mil.uy' });
    expect(view.official('bps.gub.uy.evil.com')).toBeNull();
    expect(view.official('bps-gub-uy.com')).toBeNull();
    expect(view.official('evilbps.gubuy.com')).toBeNull();
    expect(view.official('foo.gob.bo')).toBeNull(); // no se generaliza a cualquier gob.xx
    expect(view.official('gub.uy')).toBeNull();
    // El sufijo de la zona no es oficial, pero tampoco un subdominio engañoso de sí mismo.
    expect(signals('gub.uy')).toEqual([]);
  });

  it('registro del BCU: banco con su ficha como fuente y el nombre corto del catálogo', () => {
    const match = view.official('www.bancorepublica.com.uy');
    expect(match).toMatchObject({ basis: 'financial_regulator', organization: 'Banco República (BROU)', matched: 'bancorepublica.com.uy' });
    expect(match?.source).toEqual({
      name: 'Registro de instituciones del BCU',
      url: 'https://www.bcu.gub.uy/Servicios-Financieros-SSF/Paginas/InformacionInstitucion.aspx?nroinst=1001',
      reviewedAt: view.registry.snapshot!.fetchedAt,
    });
    // brou.com.uy no lo publica el BCU: sale del catálogo, con su propia fuente.
    expect(view.official('www.brou.com.uy')).toMatchObject({ basis: 'official_catalog', organization: 'Banco República (BROU)' });
    // Sin entrada en el catálogo, la razón social que publica el BCU.
    expect(view.official('www.itau.com.uy')).toMatchObject({ basis: 'financial_regulator', organization: 'BANCO ITAU URUGUAY S.A.' });
    expect(view.official('www.itau.com.uy')?.source.url).toContain('nroinst=1113');
    expect(view.official('bancorepublica.com.uy.evil.com')).toBeNull();
    expect(view.official('xitau.com.uy')).toBeNull();
  });

  it('registro del BCU: billeteras y medios de pago del Sistema de Pagos', () => {
    expect(view.official('www.prexcard.com')).toMatchObject({
      basis: 'financial_regulator',
      organization: 'Prex',
      source: { name: 'Registro de instituciones del BCU', url: 'https://www.bcu.gub.uy/Sistema-de-Pagos/Paginas/prex.aspx' },
    });
    expect(view.official('www.midinero.com.uy')).toMatchObject({ basis: 'financial_regulator', organization: 'Midinero' });
    // Columnas en otro orden (Oca Blue) y sitio como texto, sin enlace (Pedidos Ya).
    expect(view.official('ocablue.uy')).toMatchObject({ basis: 'financial_regulator', organization: 'Oca Blue' });
    expect(view.official('www.pedidosya.com.uy')).toMatchObject({ basis: 'financial_regulator', organization: 'Pedidos Ya' });
    // Varias instituciones con el mismo dominio: se nombra la que lo publica como sitio principal.
    expect(view.official('www.scanntech.com')?.organization).toBe('Scanntech');
  });

  it('sitios publicados por el BCU que se corrigen o se descartan', () => {
    expect(parseWebsite('http://https://avenida.com.uy')).toMatchObject({ domain: 'avenida.com.uy' }); // esquema repetido en el href
    expect(parseWebsite('www.ejemplo financiera.com.uy')).toEqual({ reason: 'sitio web con espacios' });
    expect(parseWebsite('')).toEqual({ reason: 'sin sitio web' });
    expect(parseWebsite('https://www.facebook.com/financiera')).toEqual({ reason: 'sitio web en una plataforma compartida' });
    expect(parseWebsite('https://www.itau.com.uy/inst/')).toMatchObject({ domain: 'itau.com.uy' });
    // Un subdominio que no es www autoriza solo ese host, no el dominio registrable de otra organización.
    expect(parseWebsite('balumacambio.enjoypuntadeleste.com.uy/')).toMatchObject({ domain: 'balumacambio.enjoypuntadeleste.com.uy' });
    expect(parseWebsites('www.floder.uy,  www.paigo.com.uy ,https://www.paigo.com.uy')).toEqual({ domains: ['floder.uy', 'paigo.com.uy'] });
    // Floder S.A. (nombre de fantasía «Paigo») publica ocho sitios en la ficha.
    expect(view.official('www.paigo.com.uy')).toMatchObject({ basis: 'financial_regulator', organization: 'Paigo' });
    expect(view.official('www.credisol.com.uy')).toMatchObject({ basis: 'financial_regulator', organization: 'Paigo' });
    expect(view.registry.snapshot?.skipped).toContainEqual({ id: 'ssf-7835', name: 'CREDIYI S.A.', reason: 'sin sitio web' });
    expect(view.registry.snapshot?.institutions).toHaveLength(161);
  });

  it('registro del BCU: AFAP, aseguradoras, casas de cambio y cooperativas de crédito', () => {
    expect(view.official('www.rafap.com.uy')).toMatchObject({ basis: 'financial_regulator', organization: 'República AFAP' });
    expect(view.official('www.rafap.com.uy')?.source.url).toContain('nroinst=3302');
    expect(view.official('www.bse.com.uy')).toMatchObject({ basis: 'financial_regulator', organization: 'BSE' });
    expect(view.official('www.cambiofagalde.com.uy')).toMatchObject({ basis: 'financial_regulator', organization: 'CAMBIO FAGALDE' });
    expect(view.official('www.acac.com.uy')).toMatchObject({ basis: 'financial_regulator', organization: 'COOPERATIVA ACAC' });
  });

  it('lo que el catálogo revisó y descartó no lo aprueba el BCU', () => {
    const file = join(tmpdir(), `official-sites.descartes-${process.pid}.json`);
    const discarded = [
      { organization: 'CASH S.A.', domain: 'cash.com.uy', reason: 'BCU lo publica pero no respondió.' },
      { organization: 'Paigo', domain: 'uinuin.com.uy, www.floder.uy, credisol.com.uy', reason: 'Sin verificar.' },
      // Un subdominio descartado no descarta el dominio registrable.
      { organization: 'Itaú', domain: 'viejo.itau.com.uy', reason: 'No resolvió.' },
      // Una nota sobre un dominio que sí es una entrada no lo descarta.
      { organization: 'Antel', domain: 'antel.com.uy', reason: 'No es un descarte.' },
      { organization: 'Sin dominio', domain: '-', reason: 'Nota.' },
    ];
    const catalog = JSON.parse(readFileSync(TEST_CATALOGS[0]!, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...catalog, discarded }));
    const sources = loadOfficialSources({ catalogFiles: [file] });
    expect([...sources.discarded.keys()]).toEqual(['cash.com.uy', 'uinuin.com.uy', 'credisol.com.uy']);
    const reviewed = new AuthorityView(sources, view.registry);
    expect(view.official('www.cash.com.uy')?.basis).toBe('financial_regulator');
    expect(reviewed.official('www.cash.com.uy')).toBeNull();
    expect(reviewed.official('www.credisol.com.uy')).toBeNull();
    expect(reviewed.official('www.paigo.com.uy')).toMatchObject({ basis: 'financial_regulator', organization: 'Paigo' });
    expect(reviewed.official('www.itau.com.uy')?.basis).toBe('financial_regulator');
    expect(reviewed.official('www.antel.com.uy')?.basis).toBe('official_catalog');
    // Sigue siendo referencia de dominios parecidos.
    expect(lookalikeSignals(describeHost('credisol-login.com.uy'), reviewed.references(), []).map((s) => s.code)).toContain('LOOKALIKE_DOMAIN');
  });

  it('catálogo curado con fuente y fecha por entrada; alcance exact', () => {
    expect(view.official('www.antel.com.uy')).toMatchObject({ basis: 'official_catalog', organization: 'Antel' });
    expect(view.official('www.antel.com.uy')?.source).toEqual({ name: 'https://www.antel.com.uy/', url: 'https://www.antel.com.uy/', reviewedAt: '2026-10-16T00:00:00.000Z' });
    expect(view.official('ebanking.brou.uy')?.basis).toBe('official_catalog');
    expect(view.official('www.ebanking.brou.uy')).toBeNull();
    expect(view.official('tramites.gub.uy')).toMatchObject({ basis: 'government_domain', organization: 'Estado uruguayo' });
    expect(hostMatches('a.x.com.uy', 'x.com.uy', 'subdomains')).toBe(true);
  });

  it('rechaza un catálogo inválido o con dominios repetidos', () => {
    const bad = join(tmpdir(), `official-sites.bad-${process.pid}.json`);
    writeFileSync(bad, JSON.stringify({ version: '1', country: 'UY', reviewedAt: '2026-10-17', entries: [{ id: 'x', organization: 'X' }] }));
    expect(() => loadOfficialSources({ catalogFiles: [bad] })).toThrow(/Fuente oficial inválida/);
    const dup = join(tmpdir(), `official-sites.dup-${process.pid}.json`);
    const entry = (id: string) => ({ id, organization: id, category: 'x', domains: [{ domain: 'x.com.uy', scope: 'exact' }], source: 's', sourceType: 't', reviewedAt: '2026-10-17' });
    writeFileSync(dup, JSON.stringify({ version: '1', country: 'UY', reviewedAt: '2026-10-17', entries: [entry('a'), entry('b')] }));
    expect(() => loadOfficialSources({ catalogFiles: [dup] })).toThrow(/x\.com\.uy/);
    // Las palabras comunes se escriben como etiqueta de dominio: sin mayúsculas, tildes ni espacios.
    const words = join(tmpdir(), `common-words.bad-${process.pid}.json`);
    writeFileSync(words, JSON.stringify({ version: '1', words: ['Correo Uruguayo'] }));
    expect(() => loadOfficialSources({ catalogFiles: TEST_CATALOGS, commonWordsFile: words })).toThrow(/common-words\.bad/);
  });

  it('organismos del Estado uruguayo: nombres y siglas, sin chocar con palabras comunes', () => {
    const gov = (text: string, hint?: Parameters<AuthorityView['claims']>[1]) => view.claims(text, hint).filter((c) => c.via === 'government_domain').map((c) => c.organization);
    expect(view.claims('BPS - Mi cuenta').map((c) => [c.via, c.keys])).toEqual([['government_domain', ['gov:UY']]]);
    expect(gov('BPS')).toEqual(['BPS']);
    expect(gov('DGI')).toEqual(['DGI']);
    expect(gov('Servicios en línea - DGI')).toEqual(['DGI']);
    expect(gov('Mi cuenta | BPS')).toEqual(['BPS']);
    expect(gov('BCU')).toEqual(['BCU']);
    expect(gov('Dirección General Impositiva')).toEqual(['Dirección General Impositiva']);
    expect(gov('Banco de Previsión Social')).toEqual(['Banco de Previsión Social']);
    expect(gov('Intendencia de Montevideo')).toEqual(['Intendencia de Montevideo']);
    expect(gov('Intendencia de Paysandú')).toEqual(['Intendencia de Paysandú']);
    expect(gov('Agenda de cédula - DNIC')).toEqual(['DNIC']);
    expect(gov('Identificación Civil')).toEqual(['Identificación Civil']);
    expect(gov('Ingresá con tu usuario gub.uy')).toEqual(['Usuario gub.uy']);
    expect(gov('ID Uruguay')).toEqual(['ID Uruguay']);
    expect(gov('SUCIVE - Pagá tu patente')).toEqual(['SUCIVE']);
    expect(gov('Agesic')).toEqual(['Agesic']);
    expect(gov('Banco Central del Uruguay')).toEqual(['Banco Central del Uruguay']);
    // Siglas cortas y nombres que otros países usan igual: solo con el país en el texto o la pista de la IA.
    expect(gov('MSP')).toEqual([]);
    expect(gov('MSP Uruguay')).toEqual(['MSP']);
    expect(gov('MSP', { kind: 'government', country: 'UY' })).toEqual(['MSP']);
    expect(gov('MSP', { kind: 'government', country: null })).toEqual(['MSP']);
    expect(gov('MSP', { kind: 'government', country: 'EC' })).toEqual([]);
    expect(gov('Ministerio de Salud Pública')).toEqual([]); // Ecuador, Paraguay
    expect(gov('Ministerio de Salud Pública del Uruguay')).toEqual(['Ministerio de Salud Pública']);
    expect(gov('Ministerio del Interior')).toEqual([]); // también en otros países
    expect(gov('Ministerio del Interior', { kind: 'government', country: 'PY' })).toEqual([]);
    expect(gov('Ministerio del Interior', { kind: 'government', country: 'UY' })).toEqual(['Ministerio del Interior']);
    expect(gov('Registro Civil')).toEqual([]);
    expect(gov('Registro Civil - Montevideo')).toEqual(['Registro Civil']);
    expect(gov('MTSS')).toEqual([]); // Costa Rica
    expect(gov('MEF')).toEqual([]); // Perú, Panamá
    expect(gov('MEF', { kind: 'government', country: 'UY' })).toEqual(['MEF']);
    expect(gov('Policía Nacional')).toEqual([]);
    expect(gov('Policía Nacional del Uruguay')).toEqual(['Policía Nacional']);
    // La pista de la IA con un país sin zona del Estado no acusa a nadie.
    expect(view.claims('Receita Federal', { kind: 'government', country: 'BR' })).toEqual([]);
    // Palabras sueltas o nombres de lugares no alcanzan.
    expect(view.claims('Uruguay')).toEqual([]);
    expect(view.claims('Montevideo')).toEqual([]);
    expect(view.claims('Pago de impuestos')).toEqual([]);
    expect(view.claims('Organismo X', { kind: 'government', country: 'UY' })[0]?.keys).toEqual(['gov:UY']);
  });

  it('BPS, DGI y BCU dentro del nombre de una empresa piden contexto; solos siguen alcanzando', () => {
    const gov = (text: string, hint?: Parameters<AuthorityView['claims']>[1]) => view.claims(text, hint).filter((c) => c.via === 'government_domain').map((c) => c.organization);
    expect(view.claims('BPS Logistics')).toEqual([]);
    expect(view.claims('DGI Consultores')).toEqual([]);
    expect(view.claims('BCU Consultores')).toEqual([]);
    expect(gov('Servicios en línea DGI')).toEqual([]);
    // La IA dice que es una empresa: tampoco.
    expect(gov('BPS Logistics', { kind: 'company', country: 'UY' })).toEqual([]);
    // Con el país, el nombre completo o la pista de la IA, sí.
    expect(gov('BPS Uruguay')).toEqual(['BPS']);
    expect(gov('BPS - Banco de Previsión Social')).toEqual(['Banco de Previsión Social']);
    expect(gov('Servicios en línea DGI', { kind: 'government', country: 'UY' })).toEqual(['DGI']);
    // Solas o separadas del resto por un guion, una barra o dos puntos.
    expect(gov('BPS')).toEqual(['BPS']);
    expect(gov('Banco de Previsión Social')).toEqual(['Banco de Previsión Social']);
    expect(gov('DGI: Servicios en línea')).toEqual(['DGI']);
  });

  it('alias del catálogo que son palabras comunes: solo con una palabra financiera o la pista de la IA', () => {
    const names = (text: string, hint?: Parameters<AuthorityView['claims']>[1]) => realView.claims(text, hint).map((c) => c.organization);
    // Textos de enlaces y marcas con palabras de uso corriente no nombran a ASI, Correo Uruguayo, Pronto+…
    for (const text of ['Así funciona', 'Mi correo', 'Hacelo pronto', 'Anda a la página', 'Universal Music', 'Provincia de Buenos Aires', 'Verde', 'Nativa', 'Cabal', 'Handy']) {
      expect(names(text), text).toEqual([]);
    }
    expect(names('Tarjeta Verde')).toContain('Verde');
    expect(names('Cabal', { kind: 'financial_entity', country: 'UY' })).toContain('Cabal');
    // Los alias que no son palabras comunes alcanzan solos.
    expect(names('Correo Uruguayo')).toEqual(['Correo Uruguayo']);
    expect(names('Antel')).toEqual(['Antel']);
  });

  it('organizaciones declaradas: registro del BCU y catálogo', () => {
    expect(view.claims('Banco Itaú').map((c) => c.organization)).toEqual(['Banco Itaú']);
    expect(view.claims('Banco Itaú')[0]?.keys).toEqual(expect.arrayContaining(['bcu:sp-itau', 'bcu:ssf-1113']));
    expect(view.claims('Itaú')).toEqual([]); // sin palabra financiera no alcanza
    expect(view.claims('Itaú', { kind: 'financial_entity', country: 'UY' }).map((c) => c.organization)).toEqual(['Banco Itaú']);
    // El catálogo y el BCU reconocen al mismo banco: las dos claves lo autorizan.
    expect(view.claims('Banco República').map((c) => [c.via, c.organization])).toEqual([
      ['official_catalog', 'Banco República (BROU)'],
      ['financial_regulator', 'Banco República (BROU)'],
    ]);
    expect(view.claims('Billetera Prex')[0]?.keys).toEqual(['bcu:sp-prex']);
    // Dos cooperativas con «Artigas» en el nombre: las dos claves, y se nombra la que coincide mejor.
    expect(view.claims('Cooperativa Artigas')).toEqual([
      { organization: 'Cooperativa Artigas', keys: ['bcu:ssf-4291', 'bcu:ssf-4316'], via: 'financial_regulator' },
    ]);
    expect(view.claims('Verde')).toEqual([]); // nombre de fantasía que es una palabra común
    expect(view.claims('Antel')[0]).toMatchObject({ via: 'official_catalog', keys: ['catalog:antel'] });
    expect(view.claims('BROU')[0]?.keys).toEqual(['catalog:brou']);
  });

  it('catálogo y BCU se enlazan por dominio: el BROU en brou.com.uy es la misma institución', () => {
    expect(view.keys('www.brou.com.uy')).toEqual(expect.arrayContaining(['catalog:brou', 'bcu:ssf-1001']));
    expect(view.keys('www.bancorepublica.com.uy')).toEqual(expect.arrayContaining(['catalog:brou', 'bcu:ssf-1001']));
    expect(view.sameOrganization('www.brou.com.uy', 'www.bancorepublica.com.uy')).toBe(true);
  });
});

describe('registro del BCU', () => {
  it('la vista de las fuentes se reutiliza mientras el registro no cambie y se rearma cuando cambia', async () => {
    let now = Date.parse('2026-10-18T00:00:00Z');
    let down = false;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => fakeRdapFetch({ bcuDown: down }).impl(input, init)) as typeof fetch;
    const authority = new AuthorityService(loadOfficialSources({ catalogFiles: TEST_CATALOGS }), registry(fetchImpl, () => now), 1000);
    const fresh = await authority.view();
    expect(await authority.view()).toBe(fresh);
    expect(fresh.references()).toBe(fresh.references());
    expect(fresh.official('www.itau.com.uy')?.basis).toBe('financial_regulator');
    down = true;
    now += 60 * HOUR; // la copia deja de estar vigente y el refresco falla
    const stale = await authority.view();
    expect(stale).not.toBe(fresh);
    expect(stale.registry.status).toBe('stale');
    expect(stale.official('www.itau.com.uy')).toBeNull();
  });

  it('un sitio publicado en un subdominio ajeno no hace oficial al dominio entero ni es referencia de parecido', () => {
    // El BCU publica la casa de cambio Balumacambio en balumacambio.enjoypuntadeleste.com.uy (fixture real).
    expect(view.official('balumacambio.enjoypuntadeleste.com.uy')).toMatchObject({ basis: 'financial_regulator', matched: 'balumacambio.enjoypuntadeleste.com.uy' });
    expect(view.official('www.enjoypuntadeleste.com.uy')).toBeNull();
    expect(view.official('otra-cosa.enjoypuntadeleste.com.uy')).toBeNull();
    expect(view.references().some((ref) => ref.domain === 'enjoypuntadeleste.com.uy')).toBe(false);
  });

  it('desactivado no descarga nada, tampoco al calentar', async () => {
    const calls: string[] = [];
    const base = fakeRdapFetch().impl;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => (calls.push(String(input)), base(input, init))) as typeof fetch;
    const reg = registry(fetchImpl, undefined, { enabled: false });
    reg.warmUp();
    expect(await reg.state(1000)).toMatchObject({ status: 'unavailable', error: 'disabled' });
    expect(calls).toEqual([]);
  });

  it('caído y sin copia: no disponible', async () => {
    const state = await registry(fakeRdapFetch({ bcuDown: true }).impl).state(1000);
    expect(state).toMatchObject({ status: 'unavailable', snapshot: null, error: 'http_503' });
  });

  it('usa la última copia: vigente hasta 48 h, vieja (detecta pero no aprueba) hasta 7 días', async () => {
    let now = Date.parse('2026-10-18T00:00:00Z');
    let down = false;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => fakeRdapFetch({ bcuDown: down }).impl(input, init)) as typeof fetch;
    const reg = registry(fetchImpl, () => now);
    expect((await reg.state(1000)).status).toBe('fresh');
    down = true;
    now += 30 * HOUR; // el refresco falla, la copia sigue vigente
    expect((await reg.state(1000)).status).toBe('fresh');
    now += 30 * HOUR;
    const stale = await reg.state(1000);
    expect(stale.status).toBe('stale');
    const old = new AuthorityView(loadOfficialSources({ catalogFiles: [] }), stale);
    expect(old.official('www.bancorepublica.com.uy')).toBeNull();
    expect(old.coverage('www.bancorepublica.com.uy')).toBe('partial');
    expect(lookalikeSignals(describeHost('bancorepublica-seguro.com'), old.references(), []).map((s) => s.code)).toContain('LOOKALIKE_DOMAIN');
    now += 7 * 24 * HOUR;
    expect((await reg.state(1000)).status).toBe('unavailable');
  });

  it('un cambio de formato en una lista hace fallar la descarga, nunca aprueba', async () => {
    const base = fakeRdapFetch().impl;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) =>
      String(input).endsWith('bancos_Instituciones_Lst.aspx') ? Promise.resolve(new Response('<html>En mantenimiento</html>')) : base(input, init)) as typeof fetch;
    expect(await registry(fetchImpl).state(1000)).toMatchObject({ status: 'unavailable', snapshot: null });
  });

  it('una ficha caída conserva la copia anterior de esa institución', async () => {
    let now = Date.parse('2026-10-18T00:00:00Z');
    let broken = false;
    const base = fakeRdapFetch().impl;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) =>
      broken && String(input).endsWith('nroinst=1113') ? Promise.resolve(new Response('error', { status: 500 })) : base(input, init)) as typeof fetch;
    const reg = registry(fetchImpl, () => now);
    await reg.state(1000);
    broken = true;
    now += 49 * HOUR; // copia vencida: espera el refresco
    const state = await reg.state(1000);
    expect(state.snapshot?.fetchedAt).toBe('2026-10-20T01:00:00.000Z');
    expect(state.snapshot?.institutions.map((i) => i.id)).toContain('ssf-1113');
  });

  it('no castiga al BCU: tope de pedidos y vista de cada entidad reutilizada', async () => {
    expect(await registry(fakeRdapFetch().impl, undefined, { maxRequests: 20 }).state(1000)).toMatchObject({ status: 'unavailable', error: 'rate_limited' });
    let now = Date.parse('2026-10-18T00:00:00Z');
    const rdap = fakeRdapFetch();
    const reg = registry(rdap.impl, () => now);
    await reg.state(1000);
    const pages = () => rdap.calls.filter((url) => url.includes('/Sistema-de-Pagos/Paginas/')).length;
    const first = pages();
    expect(first).toBe(49);
    now += 49 * HOUR;
    expect((await reg.state(1000)).snapshot?.fetchedAt).toBe('2026-10-20T01:00:00.000Z');
    expect(pages()).toBe(first); // el refresco usa la vista conocida, sin volver a bajar las páginas
  });

  it('con el BCU caído no insiste: la espera entre intentos se duplica', async () => {
    let now = Date.parse('2026-10-18T00:00:00Z');
    const rdap = fakeRdapFetch({ bcuDown: true });
    const reg = registry(rdap.impl, () => now, { retryAfterMs: 60_000 });
    const attempts = async (advanceMs: number) => {
      now += advanceMs;
      await reg.state(1000);
      return rdap.calls.length; // cada intento falla en el primer pedido
    };
    expect(await attempts(0)).toBe(1);
    expect(await attempts(59_000)).toBe(1);
    expect(await attempts(1_000)).toBe(2); // 1 min después de la primera falla
    expect(await attempts(60_000)).toBe(2);
    expect(await attempts(60_000)).toBe(3); // 2 min después de la segunda
    expect(await attempts(3 * 60_000)).toBe(3);
    expect(await attempts(60_000)).toBe(4); // 4 min después de la tercera
  });

  it('solo se conecta a www.bcu.gub.uy', async () => {
    await expect(bcuFetch('https://evil.example/')).rejects.toThrow(/no permitido/);
    await expect(bcuFetch('http://www.bcu.gub.uy/')).rejects.toThrow(/no permitido/);
  });

  it('los intermedios guardados completan la cadena hasta una raíz de Node', () => {
    const pem = readFileSync(join(DATA_DIR, 'bcu-intermediates.pem'), 'utf8');
    const [abitab, certum] = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)!.map((c) => new X509Certificate(c));
    expect(abitab!.subject).toContain('CN=Abitab SSL Organization Validated');
    expect(abitab!.checkIssued(certum!)).toBe(true);
    expect(rootCertificates.some((root) => certum!.checkIssued(new X509Certificate(root)))).toBe(true);
  });
});

describe('dominios parecidos (sin lista manual)', () => {
  it.each([
    ['bps-gub-uy.com', 'LOOKALIKE_DOMAIN', 'Estado uruguayo'],
    ['bps-gub.uy.com', 'LOOKALIKE_DOMAIN', 'Estado uruguayo'],
    ['bps.gub.uy.evil.com', 'MISLEADING_SUBDOMAIN', 'Estado uruguayo'],
    ['tramites-gub-uy.com', 'LOOKALIKE_DOMAIN', 'Estado uruguayo'],
    ['gub-uy.com', 'LOOKALIKE_DOMAIN', 'Estado uruguayo'],
    ['bancorepublica-seguro.com', 'LOOKALIKE_DOMAIN', 'Banco República (BROU)'], // marca + palabra clave
    ['brou-seguro.com', 'LOOKALIKE_DOMAIN', 'Banco República (BROU)'],
    ['br0u.com.uy', 'LOOKALIKE_DOMAIN', 'Banco República (BROU)'], // mismo esqueleto visual
    ['itau-login.com', 'LOOKALIKE_DOMAIN', 'Banco Itaú'],
    ['prexcard-verificacion.com', 'LOOKALIKE_DOMAIN', 'Prex'],
    ['bancorepublica.com.uy.verificacion.net', 'MISLEADING_SUBDOMAIN', 'Banco República (BROU)'],
    ['itau.secure-login.com', 'MISLEADING_SUBDOMAIN', 'Banco Itaú'],
    ['scotiabamk.com.uy', 'LOOKALIKE_DOMAIN', 'Scotiabank'], // una letra
    ['prexcrad.com', 'LOOKALIKE_DOMAIN', 'Prex'], // letras cambiadas de lugar
    ['prexcard-login.com', 'LOOKALIKE_DOMAIN', 'Prex'],
    ['antel-uy.com', 'LOOKALIKE_DOMAIN', 'Antel'],
    ['brou.com.uy.verificacion.net', 'MISLEADING_SUBDOMAIN', 'Banco República (BROU)'],
    ['xn--bancorepublic-81k.com.uy', 'CONFUSABLE_CHARACTERS', 'Banco República (BROU)'], // "bancorepublicа" con a cirílica
    ['bps.xn--gb-1bc.uy', 'CONFUSABLE_CHARACTERS', 'Estado uruguayo'], // "gυb.uy" con ípsilon griega
  ])('%s → %s', (hostname, code, organization) => {
    expect(signals(hostname)).toContainEqual([code, organization]);
  });

  it.each([
    'correo.miempresa.com.uy', // el webmail de una empresa
    'delta.algo.com',
    'consorcios.com.uy',
    'avenidas.com.uy',
    'visa-uruguay.com',
    'disco-online.com',
    'pronto.algunblog.com',
    'verde.ejemplo.com',
    'provincia.blog.com',
    'anda-online.com',
    'asi-uruguay.com',
    'handy-app.com',
    'cabal-online.com',
    'lafavorita.tiendanube.com',
  ])('%s: una palabra común en el nombre no es una imitación', (hostname) => {
    expect(signals(hostname)).toEqual([]);
  });

  it.each([
    ['correo-uy.com', 'LOOKALIKE_DOMAIN'],
    ['correouy.com', 'LOOKALIKE_DOMAIN'],
    ['correo-uruguayo.net', 'LOOKALIKE_DOMAIN'],
    ['correouruguayo-pagos.com', 'LOOKALIKE_DOMAIN'],
    ['correo-envios.com', 'LOOKALIKE_DOMAIN'],
    ['paquete-correo.com', 'LOOKALIKE_DOMAIN'],
    ['correo-aduana-tasas.xyz', 'LOOKALIKE_DOMAIN'],
    ['correo.envios-uy.com', 'MISLEADING_SUBDOMAIN'],
    ['correo-envios.algo.com', 'MISLEADING_SUBDOMAIN'],
  ])('Correo Uruguayo: %s → %s (palabra de sus estafas)', (hostname, code) => {
    expect(signals(hostname).map(([c]) => c)).toContain(code);
  });

  it.each(['correo.miempresa.com.uy', 'correo-electronico.com', 'micorreo.com.uy', 'correo.universidad.edu.uy'])(
    'Correo Uruguayo: %s sin palabras de estafa no es imitación',
    (hostname) => expect(signals(hostname)).toEqual([]),
  );

  it('una referencia que es una palabra común se detecta por el dominio completo o el aspecto', () => {
    const codes = (hostname: string) => signals(hostname).map(([code]) => code);
    expect(codes('correo.com.uy.evil.com')).toEqual(['MISLEADING_SUBDOMAIN']);
    expect(codes('correo-com-uy.net')).toEqual(['LOOKALIKE_DOMAIN']);
    expect(codes('c0rreo.com.uy')).toEqual(['LOOKALIKE_DOMAIN']);
    expect(codes('xn--rreo-45dr.com.uy')).toEqual(['CONFUSABLE_CHARACTERS']); // «соrreo» con c y o cirílicas
    expect(codes('verde.com')).toEqual([]);
    expect(codes('delta.com')).toEqual([]);
  });

  it('la lista de palabras comunes marca nombres de uso corriente, nunca las marcas', () => {
    const common = new Set(realView.references().filter((r) => r.commonWord).map((r) => r.label));
    expect([...common]).toEqual(
      expect.arrayContaining(['correo', 'delta', 'consorcio', 'avenida', 'visa', 'disco', 'verde', 'pronto', 'provincia', 'anda', 'asi', 'handy', 'cabal', 'universidad']),
    );
    for (const brand of ['brou', 'bancorepublica', 'itau', 'antel', 'prexcard', 'oca', 'ute', 'ose', 'bse', 'santander', 'claro', 'abitab', 'redpagos', 'midinero', 'mercadopago']) {
      expect(common.has(brand), brand).toBe(false);
    }
    // Con el catálogo real: Udelar publica universidad.edu.uy.
    expect(signals('universidad-online.com', realView)).toEqual([]);
    expect(signals('universidad.edu.uy.inscripciones.com', realView)).toEqual([['MISLEADING_SUBDOMAIN', 'Udelar']]);
    expect(signals('antel-uy.com', realView)).toEqual([['LOOKALIKE_DOMAIN', 'Antel']]);
  });

  it('la misma marca con otra terminación no es imitación por sí sola (sitios globales legítimos)', () => {
    expect(signals('bancorepublica.com')).toEqual([]);
    expect(signals('www.santander.com')).toEqual([]);
  });

  it('no marca sitios sin relación ni marcas dentro de otras palabras', () => {
    expect(signals('www.tiendainglesa.com.uy')).toEqual([]);
    expect(signals('www.mercadolibre.com.uy')).toEqual([]);
    expect(signals('www.bancodelsur.com')).toEqual([]); // "banco" no es palabra clave
    expect(signals('www.blog-uy.com')).toEqual([]);
    expect(signals('www.ocaso.com')).toEqual([]);
    expect(signals('www.antelope.com')).toEqual([]);
  });

  it('compara sin guiones las referencias que los tienen (banco-ejemplo.com.uy)', () => {
    const refs: Reference[] = [{ domain: 'banco-ejemplo.com.uy', label: 'banco-ejemplo', organization: 'Banco Ejemplo', kind: 'official_catalog' }];
    const codes = (hostname: string) => lookalikeSignals(describeHost(hostname), refs, []).map((s) => s.code);
    // Una letra de diferencia y marca + palabra clave, escritas sin el guion.
    expect(codes('bancoejenplo.com.uy')).toContain('LOOKALIKE_DOMAIN');
    expect(codes('bancoejemplologin.com')).toContain('LOOKALIKE_DOMAIN');
    expect(codes('www.banco-ejemplo.com.uy')).toEqual([]);
  });

  it('mezcla de alfabetos y distancia de edición', () => {
    expect(signals('xn--pypal-4ve.com').map(([code]) => code)).toContain('CONFUSABLE_CHARACTERS');
    expect(editDistance('prexcard', 'prexcrad')).toBe(1);
  });
});

describe('hosts internos', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '10.1.2.3', '192.168.0.10', '169.254.169.254', '[::1]', 'intranet', 'servidor.local', 'algo.internal', 'nas.corp'])(
    '%s es interno',
    (hostname) => expect(describeHost(hostname).internal).toBe(true),
  );

  it.each(['www.gub.uy', 'example.com', 'usuario.github.io', '8.8.8.8'])('%s es público', (hostname) => {
    expect(describeHost(hostname).internal).toBe(false);
  });
});

describe('sanitización en el backend', () => {
  it('quita credenciales, query, fragmento y segmentos secretos del path', () => {
    const url = sanitizeUrl('https://user:pass@sitio.com.uy/reset/a1b2c3d4e5f6g7h8i9j0/ana@mail.com/12345678?token=abc#frag');
    expect(url?.toString()).toBe('https://sitio.com.uy/reset/redactado/redactado/redactado');
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('redacta correos, números largos y tokens del texto; las URLs quedan como hostname', () => {
    const text = redactText('Escribí a ana@mail.com, tu cuenta 0110599520000001234567 y token abc123def456. Ver https://banco.com/x?ci=1', 200);
    expect(text).not.toMatch(/ana@mail|0110599520000001234567|abc123def456|ci=/);
    expect(text).toContain('banco.com');
  });

  it('oculta el valor que sigue a una palabra de credencial, aunque sean solo letras', () => {
    const text = redactText('Usuario: marta\nContraseña: gatito\nMi clave es perro azul\ntoken=xyz', 200);
    expect(text).not.toMatch(/gatito|perro|xyz/);
    expect(text).toContain('marta');
    // Un pedido no es un secreto.
    expect(redactText('Olvidé mi contraseña del banco', 200)).toContain('del banco');
  });
});

describe('riesgo determinístico', () => {
  it('una señal fuerte alcanza para riesgo alto', () => {
    expect(computeRisk(new Set(['LOOKALIKE_DOMAIN']), false)).toBe('high');
    expect(computeRisk(new Set(['MISLEADING_SUBDOMAIN']), true)).toBe('high');
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

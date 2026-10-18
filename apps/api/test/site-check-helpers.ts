import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BCRA_ENDPOINT } from '../src/modules/site-check/bcra-registry.js';
import type { HopRequester, HopResult } from '../src/modules/site-check/connection.js';
import type { SiteCheckOverrides } from '../src/modules/site-check/factory.js';
import type { HostResolver } from '../src/modules/site-check/net-guard.js';
import { MockReputationProvider, type Threat } from '../src/modules/site-check/reputation.js';

/** IP pública de ejemplo. Nunca se contacta: el requester de las pruebas es falso. */
export const PUBLIC_IP = '93.184.216.34';

export const publicResolver: HostResolver = async () => [{ address: PUBLIC_IP, family: 4 }];

export const okHop: HopResult = {
  status: 200,
  location: null,
  tls: { authorized: true, error: null, validTo: '2027-01-01T00:00:00.000Z', issuer: 'CA de prueba', protocol: 'TLSv1.3' },
};

/** Requester falso que registra los destinos pedidos. */
export function recordingRequester(responses: Record<string, HopResult> = {}) {
  const calls: string[] = [];
  const requester: HopRequester = async (url) => {
    calls.push(url.toString());
    return responses[url.toString()] ?? okHop;
  };
  return { requester, calls };
}

export const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const readFixture = (name: string) => JSON.parse(readFileSync(fixture(name), 'utf8'));

/** Catálogo curado de prueba (Uruguay): no depende del archivo real de `data/`. */
export const TEST_CATALOGS = [fixture('official-sites.uy.json')];

export interface FakeFetchOptions {
  registeredAt?: string;
  fail?: boolean;
  /** Nunca responde (para probar el tiempo máximo). */
  hang?: boolean;
  /** El padrón del BCRA responde 502 (como su CDN cuando falla). */
  bcraDown?: boolean;
}

/** Respuestas grabadas del padrón del BCRA (test/fixtures/bcra), o 502 si está caído. */
function bcraResponse(url: string, down: boolean): Response | null {
  if (!url.startsWith(BCRA_ENDPOINT)) return null;
  if (down) return new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } });
  const params = new URL(url).searchParams;
  if (params.get('action') === 'list') return Response.json(readFixture('bcra/list.json'));
  try {
    return Response.json(readFixture(`bcra/detail-${params.get('category')}.json`));
  } catch {
    return new Response('not found', { status: 404 });
  }
}

/** fetch falso para RDAP (bootstrap de IANA y un servidor de prueba) y el padrón del BCRA. */
export function fakeRdapFetch({ registeredAt = '2001-05-10T00:00:00Z', fail = false, hang = false, bcraDown = false }: FakeFetchOptions = {}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const bcra = bcraResponse(url, bcraDown);
    if (bcra) return bcra;
    if (hang) {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    }
    if (fail) return new Response('error', { status: 503 });
    if (url === 'https://data.iana.org/rdap/dns.json') {
      return Response.json({ services: [[['ar', 'com', 'app'], ['https://rdap.prueba/']]] });
    }
    if (url.startsWith('https://rdap.prueba/domain/')) {
      return Response.json({
        events: [{ eventAction: 'registration', eventDate: registeredAt }],
        entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Registrador de prueba']]] }],
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

/** Proveedores falsos y sin red. Se pueden reemplazar uno por uno. */
export function fakeProviders(over: Partial<SiteCheckOverrides> & { flagged?: Record<string, Threat[]> } = {}): SiteCheckOverrides {
  const { flagged, ...rest } = over;
  return {
    reputationProvider: new MockReputationProvider(flagged),
    fetchImpl: fakeRdapFetch().impl,
    catalogFiles: TEST_CATALOGS,
    resolver: publicResolver,
    requester: recordingRequester().requester,
    ...rest,
  };
}

export const emptyPage = { text: 'Bienvenido al sitio.', forms: [], links: [], scriptHosts: [], iframeHosts: [] };

export const addressRequest = (url: string, over: Record<string, unknown> = {}) => {
  const parsed = new URL(url);
  return { navigationId: 'nav-1', contentVersion: 0, url, hostname: parsed.hostname, registrableDomain: parsed.hostname.replace(/^www\./, ''), ...over };
};

export const contentRequest = (url: string, page: object = emptyPage, over: Record<string, unknown> = {}) =>
  addressRequest(url, { contentVersion: 1, page, ...over });

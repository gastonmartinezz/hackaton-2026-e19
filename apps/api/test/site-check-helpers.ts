import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BCU_HOST, BCU_LISTS_HANDLER } from '../src/modules/site-check/bcu-registry.js';
import type { HopRequester, HopResult } from '../src/modules/site-check/connection.js';
import type { SiteCheckOverrides } from '../src/modules/site-check/factory.js';
import type { HostResolver } from '../src/modules/site-check/net-guard.js';

/** IP pública de ejemplo. Nunca se contacta: el requester de las pruebas es falso. */
export const PUBLIC_IP = '93.184.216.34';

export const publicResolver: HostResolver = async () => [{ address: PUBLIC_IP, family: 4 }];

export const okHop: HopResult = {
  status: 200,
  location: null,
  tls: { authorized: true, error: null },
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

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const readFixture = (name: string) => JSON.parse(readFileSync(fixture(name), 'utf8'));

/** Catálogo curado de prueba (Uruguay): no depende del archivo real de `data/`. */
export const TEST_CATALOGS = [fixture('official-sites.uy.json')];

export interface FakeFetchOptions {
  registeredAt?: string;
  /** Nunca responde (para probar el tiempo máximo). */
  hang?: boolean;
  /** El sitio del BCU responde 503. */
  bcuDown?: boolean;
}

/**
 * Respuestas reales del BCU grabadas el 18/10/2026 (test/fixtures/bcu), recortadas a lo que lee el
 * parser: la tabla de cada lista de la SSF, los campos de cada ficha, el listado del Sistema de
 * Pagos, la vista de cada entidad y el fragmento de su página que la nombra.
 */
const BCU = { ssf: readFixture('bcu/ssf.json'), pagos: readFixture('bcu/pagos.json') } as {
  ssf: { lists: Record<string, string>; fichas: Record<string, string> };
  pagos: { listado: unknown; paginas: Record<string, string>; vistas: Record<string, unknown> };
};

/** Registro del BCU desde las fixtures, o 503 si está caído. */
function bcuResponse(url: string, init: RequestInit | undefined, down: boolean): Response | null {
  if (new URL(url).hostname !== BCU_HOST) return null;
  if (down) return new Response('<html>Servicio no disponible</html>', { status: 503, headers: { 'content-type': 'text/html' } });
  const notFound = new Response('not found', { status: 404 });
  if (url === BCU_LISTS_HANDLER) {
    const view = new URLSearchParams(String(init?.body ?? '')).get('viewName') ?? '';
    const data = view === 'Publicar' ? BCU.pagos.listado : BCU.pagos.vistas[view];
    return data ? Response.json(data) : notFound;
  }
  const nroinst = new URL(url).searchParams.get('nroinst');
  const html = nroinst ? BCU.ssf.fichas[nroinst] : (BCU.ssf.lists[url.split('/').pop()!] ?? BCU.pagos.paginas[url]);
  return html === undefined ? notFound : new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** fetch falso para RDAP (bootstrap de IANA y un servidor de prueba) y el registro del BCU. */
export function fakeRdapFetch({ registeredAt = '2001-05-10T00:00:00Z', hang = false, bcuDown = false }: FakeFetchOptions = {}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const bcu = bcuResponse(url, init, bcuDown);
    if (bcu) return bcu;
    if (hang) {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    }
    if (url === 'https://data.iana.org/rdap/dns.json') {
      return Response.json({ services: [[['com', 'net', 'app'], ['https://rdap.prueba/']]] });
    }
    if (url.startsWith('https://rdap.prueba/domain/')) {
      return Response.json({
        events: [{ eventAction: 'registration', eventDate: registeredAt }],
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

/** Proveedores falsos y sin red. Se pueden reemplazar uno por uno. */
export function fakeProviders(over: Partial<SiteCheckOverrides> = {}): SiteCheckOverrides {
  return {
    fetchImpl: fakeRdapFetch().impl,
    catalogFiles: TEST_CATALOGS,
    resolver: publicResolver,
    requester: recordingRequester().requester,
    ...over,
  };
}

export const emptyPage = { text: 'Bienvenido al sitio.', forms: [], links: [] };

export const addressRequest = (url: string, over: Record<string, unknown> = {}) => {
  const parsed = new URL(url);
  return { navigationId: 'nav-1', contentVersion: 0, url, hostname: parsed.hostname, registrableDomain: parsed.hostname.replace(/^www\./, ''), ...over };
};

export const contentRequest = (url: string, page: object = emptyPage, over: Record<string, unknown> = {}) =>
  addressRequest(url, { contentVersion: 1, page, ...over });

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { buildMcpApp } from '../src/modules/mcp/mcp.server.js';
import { TOKEN, testApp } from './helpers.js';
import { emptyPage, fakeProviders, fakeRdapFetch, recordingRequester } from './site-check-helpers.js';

const MCP_TOKEN = 'token-mcp-de-prueba-con-longitud-suficiente';

let api: FastifyInstance;
let mcp: FastifyInstance;
afterEach(async () => {
  await mcp?.close();
  await api?.close();
});

async function setup(overrides = fakeProviders()) {
  const env = { MCP_ACCESS_TOKENS: MCP_TOKEN };
  api = await testApp({ siteCheck: overrides }, env);
  mcp = await buildMcpApp(loadConfig({ NODE_ENV: 'test', API_ACCESS_TOKENS: TOKEN, ...env }), api.siteCheck);
}

let nextId = 1;
const rpc = (method: string, params: object = {}, token: string | null = MCP_TOKEN) =>
  mcp.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    payload: { jsonrpc: '2.0', id: nextId++, method, params },
  });

async function callTool(name: string, args: object) {
  const res = await rpc('tools/call', { name, arguments: args });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.error).toBeUndefined();
  return body.result as { structuredContent: any; isError?: boolean; content: Array<{ type: string; text: string }> };
}

describe('servidor MCP privado', () => {
  it('rechaza solicitudes sin token o con el token de la API', async () => {
    await setup();
    expect((await rpc('tools/list', {}, null)).statusCode).toBe(401);
    expect((await rpc('tools/list', {}, TOKEN)).statusCode).toBe(401);
  });

  it('inicializa y lista las 6 tools', async () => {
    await setup();
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } });
    expect(init.statusCode).toBe(200);
    expect(init.json().result.serverInfo.name).toBe('mostrame-site-check');
    const list = await rpc('tools/list');
    const names = list.json().result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      'analyze_page_structure',
      'check_url_reputation',
      'compare_brand_identity',
      'get_domain_registration',
      'inspect_connection',
      'lookup_official_identity',
    ]);
  });

  it.each([
    ['check_url_reputation', { url: 'https://phishing-demo.example.com/login?x=1' }, 'KNOWN_PHISHING'],
    ['lookup_official_identity', { hostname: 'anses-gob-ar.com' }, 'LOOKALIKE_DOMAIN'],
    ['get_domain_registration', { domain: 'www.ejemplo.com.ar' }, null],
    ['inspect_connection', { url: 'https://www.ejemplo.com.ar/' }, null],
    ['analyze_page_structure', { url: 'https://www.ejemplo.com.ar/', page: { ...emptyPage, forms: [{ method: 'post', action: null, fields: [{ type: 'text', label: 'CBU' }] }] } }, 'SENSITIVE_DATA_REQUEST'],
    ['compare_brand_identity', { hostname: 'www.ejemplo.com.ar', declaredBrand: 'ANSES' }, 'BRAND_IMPERSONATION'],
  ])('%s devuelve fuente, fecha, cobertura y limitaciones', async (name, args, code) => {
    await setup();
    const result = await callTool(name, args);
    const data = result.structuredContent;
    expect(data).toMatchObject({ tool: name, coverage: 'complete', errors: [] });
    expect(data.source).toBeTruthy();
    expect(Date.parse(data.checkedAt)).not.toBeNaN();
    expect(data.limitations.length).toBeGreaterThan(0);
    expect(JSON.parse(result.content[0]!.text)).toEqual(data);
    if (code) expect(data.findings.map((f: { code: string }) => f.code)).toContain(code);
  });

  it.each([
    ['servicios.afip.gob.ar', 'government_domain', 'gob.ar', 'Estado argentino'],
    ['www.bna.com.ar', 'financial_regulator', 'bna.com.ar', 'BANCO DE LA NACION ARGENTINA'],
    ['www.antel.com.uy', 'official_catalog', 'antel.com.uy', 'Antel'],
  ])('lookup_official_identity: %s → %s con fuente y fecha', async (hostname, basis, matched, organization) => {
    await setup();
    const { structuredContent } = await callTool('lookup_official_identity', { hostname });
    expect(structuredContent.data.official).toMatchObject({ basis, matched, organization });
    expect(Date.parse(structuredContent.data.official.source.reviewedAt)).not.toBeNaN();
    expect(structuredContent.data.official.source.url).toMatch(/^https:\/\//);
    expect(structuredContent.data.sources.registryStatus).toBe('fresh');
  });

  it('lookup_official_identity con el padrón caído: sin aprobación y con el error informado', async () => {
    await setup(fakeProviders({ fetchImpl: fakeRdapFetch({ bcraDown: true }).impl }));
    const { structuredContent } = await callTool('lookup_official_identity', { hostname: 'www.bna.com.ar' });
    expect(structuredContent).toMatchObject({ coverage: 'unavailable', errors: ['registry_unavailable'], data: { official: null } });
  });

  it('no consulta afuera hosts internos y lo informa como error', async () => {
    const requester = recordingRequester();
    await setup(fakeProviders({ requester: requester.requester }));
    const result = await callTool('inspect_connection', { url: 'http://192.168.0.1/' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ coverage: 'not_applicable', errors: ['internal_host'] });
    expect(requester.calls).toEqual([]);
  });

  it('valida los argumentos (sin valores de formulario)', async () => {
    await setup();
    const page = { ...emptyPage, forms: [{ method: 'post', action: null, fields: [{ type: 'password', value: 'secreto' }] }] };
    const res = await rpc('tools/call', { name: 'analyze_page_structure', arguments: { url: 'https://www.ejemplo.com.ar/', page } });
    const body = res.json();
    expect(body.result?.isError ?? Boolean(body.error)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('"secreto"');
  });

  it('solo acepta POST /mcp', async () => {
    await setup();
    const res = await mcp.inject({ method: 'GET', url: '/mcp', headers: { authorization: `Bearer ${MCP_TOKEN}` } });
    expect(res.statusCode).toBe(404);
  });
});

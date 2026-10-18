import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { SiteCheckRequest, SiteCheckResponse } from '../src/index.js';

// Los JSON Schema publicados tienen que aceptar y rechazar lo mismo que el contrato Zod,
// incluidas las reglas entre campos (scripts/cross-field-rules.ts).
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'v1');
const ajv = new Ajv2020({ strict: false, validateFormats: false });
const jsonValidator = (name: string) => ajv.compile(JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')));

function agree(name: string, zod: z.ZodType, cases: Array<[string, unknown, boolean]>) {
  const validate = jsonValidator(name);
  it.each(cases)('%s', (_, value, valid) => {
    expect(zod.safeParse(value).success).toBe(valid);
    expect(validate(value)).toBe(valid);
  });
}

const address = { navigationId: 'nav-1', contentVersion: 0, url: 'https://www.gub.uy/', hostname: 'www.gub.uy', registrableDomain: 'gub.uy' };
const page = { text: 'Hola', forms: [], links: [], scriptHosts: [], iframeHosts: [] };

describe('SiteCheckRequest.json', () => {
  agree('SiteCheckRequest', SiteCheckRequest, [
    ['fase de dirección sin page', address, true],
    ['fase de dirección con page', { ...address, page }, false],
    ['fase de contenido con page', { ...address, contentVersion: 1, page }, true],
    ['fase de contenido sin page', { ...address, contentVersion: 1 }, false],
    ['URL con javascript:', { ...address, url: 'javascript:alert(1)' }, false],
    ['enlace con file:', { ...address, contentVersion: 1, page: { ...page, links: [{ text: 'Abrir', href: 'file:///etc/passwd' }] } }, false],
  ]);
});

const coverage = { identity: 'complete', content: 'complete', registration: 'unavailable', connection: 'unavailable' };
const response = (identity: unknown) => ({
  navigationId: 'nav-1',
  contentVersion: 1,
  analysisId: 'a-1',
  status: 'complete',
  identity,
  risk: 'no_signals',
  reasons: [],
  coverage,
  checkedAt: '2026-10-17T22:00:00Z',
  expiresAt: '2026-10-17T22:15:00Z',
});
const source = { name: 'nic.uy: gub.uy solo vía AGESIC', url: 'https://nic.uy/', reviewedAt: '2026-10-17T00:00:00Z' };

describe('SiteCheckResponse.json', () => {
  agree('SiteCheckResponse', SiteCheckResponse, [
    ['oficial con basis y source', response({ status: 'verified_official', basis: 'government_domain', organization: 'Estado uruguayo', source }), true],
    ['oficial sin basis', response({ status: 'verified_official', organization: 'Estado uruguayo', source }), false],
    ['oficial sin source', response({ status: 'verified_official', basis: 'official_catalog', organization: 'Antel' }), false],
    ['desconocida sin basis ni source', response({ status: 'unknown' }), true],
    ['desconocida con basis', response({ status: 'unknown', basis: 'government_domain' }), false],
    ['desconocida con source', response({ status: 'unknown', source }), false],
  ]);
});

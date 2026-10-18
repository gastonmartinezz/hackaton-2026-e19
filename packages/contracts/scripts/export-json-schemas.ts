// Genera schemas/v1/*.json a partir de los esquemas Zod para quien no use TypeScript.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as contracts from '../src/index.js';
import { withCrossFieldRules } from './cross-field-rules.js';

const exported = {
  InterpretRequest: contracts.InterpretRequest,
  InterpretResponse: contracts.InterpretResponse,
  OptionsRequest: contracts.OptionsRequest,
  OptionsResponse: contracts.OptionsResponse,
  NextStepRequest: contracts.NextStepRequest,
  NextStepResponse: contracts.NextStepResponse,
  SiteCheckRequest: contracts.SiteCheckRequest,
  SiteCheckResponse: contracts.SiteCheckResponse,
  TranscribeResponse: contracts.TranscribeResponse,
  ApiError: contracts.ApiError,
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'v1');
await mkdir(outDir, { recursive: true });

for (const [name, schema] of Object.entries(exported)) {
  const json = withCrossFieldRules(
    name,
    z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io: 'input',
      // `format: uri` acepta cualquier esquema (javascript:, file:); WebUrl solo admite http(s).
      override: (ctx) => {
        if (ctx.zodSchema === contracts.WebUrl) ctx.jsonSchema.pattern = '^https?://';
      },
    }) as Record<string, unknown>,
  );
  await writeFile(join(outDir, `${name}.json`), `${JSON.stringify({ title: name, ...json }, null, 2)}\n`);
}

console.log(`${Object.keys(exported).length} esquemas escritos en ${outDir}`);

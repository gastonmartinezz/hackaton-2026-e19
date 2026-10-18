/**
 * Reglas entre campos que `z.toJSONSchema` no puede traducir desde los `.refine()` de Zod.
 * Se agregan al exportar para que quien valide solo con el JSON Schema aplique las mismas
 * reglas que el backend. El test `json-schemas.test.ts` compara Zod y JSON Schema con los
 * mismos casos, así que si cambia un refine sin cambiar esto, falla.
 */
type JsonSchema = Record<string, unknown> & { properties?: Record<string, JsonSchema> };

const rules: Record<string, (schema: JsonSchema) => void> = {
  // SiteCheckRequest: `page` es obligatorio si contentVersion > 0 y no se envía con contentVersion 0.
  SiteCheckRequest: (schema) => {
    schema.allOf = [
      {
        if: { properties: { contentVersion: { const: 0 } }, required: ['contentVersion'] },
        then: { not: { required: ['page'] } },
        else: { required: ['page'] },
      },
    ];
  },
  // SiteCheckResponse: `basis` y `source` son obligatorios con verified_official y no se envían en otro caso.
  SiteCheckResponse: (schema) => {
    const identity = schema.properties?.identity;
    if (!identity) throw new Error('SiteCheckResponse sin identity: revisar cross-field-rules.ts');
    identity.allOf = [
      {
        if: { properties: { status: { const: 'verified_official' } }, required: ['status'] },
        then: { required: ['basis', 'source'] },
        else: { not: { anyOf: [{ required: ['basis'] }, { required: ['source'] }] } },
      },
    ];
  },
};

export function withCrossFieldRules<T extends JsonSchema>(name: string, schema: T): T {
  rules[name]?.(schema);
  return schema;
}

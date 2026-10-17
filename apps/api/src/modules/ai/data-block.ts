/**
 * Envuelve los datos no confiables en el bloque <datos> que esperan los prompts.
 * JSON.stringify no escapa <, > ni &: un HTML con "</datos>" cerraría el bloque antes de tiempo.
 * Los escapes <, > y & siguen siendo JSON válido y el modelo los lee igual.
 */
export function buildDataBlock(input: unknown): string {
  const json = (JSON.stringify(input) ?? 'null')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
  return `<datos>\n${json}\n</datos>`;
}

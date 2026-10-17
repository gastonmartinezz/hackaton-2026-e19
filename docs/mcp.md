# Servidor MCP privado — Protección de sitios

Interfaz privada de herramientas para el componente de IA (y para depurar a mano). No es para el navegador: el navegador solo habla con `POST /v1/site-check`. Código: `apps/api/src/modules/mcp/mcp.server.ts`.

## Decisión de transporte

- **Streamable HTTP sin estado** (SDK oficial `@modelcontextprotocol/sdk`), en `POST /mcp`, con respuestas JSON (`enableJsonResponse`). Cada solicitud crea su servidor y su transporte; no hay sesiones (`GET` y `DELETE /mcp` responden 404).
- **Proceso compartido, puerto aparte:** se levanta junto con la API (`pnpm dev` / `pnpm start`) en otro listener, para reutilizar las mismas instancias de servicios, cachés y topes por proveedor que `/v1/site-check`.
- **No expuesto por defecto:** solo arranca si `MCP_ACCESS_TOKENS` tiene al menos un token, y escucha en `MCP_HOST=127.0.0.1` (loopback). Para exponerlo a otro host hay que cambiar `MCP_HOST` a conciencia y ponerlo detrás de una red privada.
- Se descartó stdio porque obligaría a duplicar servicios y cachés en otro proceso, y porque la IA corre del lado del servidor.

## Autenticación y límites

- `Authorization: Bearer <token>` con un token de `MCP_ACCESS_TOKENS` (separados por coma, mínimo 24 caracteres). **Deben ser distintos** de `API_ACCESS_TOKENS`: la configuración lo valida, y un token de la API recibe `401`.
- Límite de uso: `SITE_CHECK_RATE_LIMIT_MAX` solicitudes por `RATE_LIMIT_WINDOW_MS` y token.
- Los errores HTTP (401, 429) usan el mismo formato `ApiError` que la API.

## Tools

Todas son de solo lectura. Ninguna ejecuta código ni hace peticiones HTTP arbitrarias: solo consultan el catálogo, el proveedor de reputación configurado, RDAP (servidores del bootstrap de IANA) o el inspector de conexión con protección contra SSRF. Los argumentos se validan con los esquemas Zod del contrato y las URLs se depuran (sin query, fragmento ni secretos) antes de usarse. Las direcciones locales, privadas o internas devuelven `coverage: "not_applicable"`, `errors: ["internal_host"]` e `isError: true`, sin consultar afuera.

| Tool | Argumentos | Qué hace |
|---|---|---|
| `check_url_reputation` | `url` | Consulta reportes **existentes** de phishing y malware. Nunca envía la URL a escanear ni la publica |
| `lookup_official_identity` | `hostname` | Organización, dominio autorizado, alcance (`exact`/`subdomains`), fuente y fecha de revisión del catálogo; además, señales de dominio parecido, caracteres confusos y subdominio engañoso |
| `get_domain_registration` | `domain` | Fecha de alta y registrador por RDAP del dominio registrable |
| `inspect_connection` | `url` | HTTPS, certificado y redirecciones (máx. 5) con fetch controlado: solo puertos 80/443, DNS validado en cada salto, sin cookies ni credenciales, sin descargar el cuerpo |
| `analyze_page_structure` | `url`, `page` (`PageSummary` del contrato) | Reglas sobre formularios (sin valores), enlaces, scripts e iframes |
| `compare_brand_identity` | `hostname`, `declaredBrand` | Contrasta la marca declarada con el catálogo; la marca nunca prueba identidad |

### Formato de respuesta

`structuredContent` (y el mismo JSON en `content[0].text`):

```json
{
  "tool": "lookup_official_identity",
  "source": "Registro de sitios oficiales v2026-10-17.1",
  "checkedAt": "2026-10-17T22:00:00.000Z",
  "coverage": "complete",
  "expiresAt": "2026-10-17T22:10:00.000Z",
  "limitations": ["Solo reconoce las organizaciones incluidas en el registro. …", "Revisión del registro: 2026-10-17."],
  "errors": [],
  "data": { "hostname": "anses-turnos.com", "registrableDomain": "anses-turnos.com", "official": null, "catalogVersion": "2026-10-17.1" },
  "findings": [
    { "code": "LOOKALIKE_DOMAIN", "category": "fraud", "observedBy": "service", "detail": "El dominio anses-turnos.com se parece a anses.gob.ar", "impersonatedOrganization": "ANSES (Administración Nacional de la Seguridad Social)" }
  ]
}
```

- `coverage`: `complete`, `partial`, `unavailable` o `not_applicable`. Una fuente caída **no** es error de la tool: vuelve `coverage: "unavailable"` y el motivo en `errors` (`timeout`, `rate_limited`, `http_503`, `not_configured`, `no_rdap_service`, `blocked_destination`…).
- `expiresAt`: vigencia del dato según la fuente (`null` si no se guarda en caché).

## Cómo correrlo

```bash
# apps/api/.env
MCP_ACCESS_TOKENS=<openssl rand -base64 32>
MCP_HOST=127.0.0.1
MCP_PORT=3100

pnpm dev

MCP=<token>
curl -s localhost:3100/mcp -H "Authorization: Bearer $MCP" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s localhost:3100/mcp -H "Authorization: Bearer $MCP" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"lookup_official_identity","arguments":{"hostname":"argentina.gob.ar.evil.com"}}}'
```

Con un cliente MCP (por ejemplo MCP Inspector), usar el transporte «Streamable HTTP», URL `http://127.0.0.1:3100/mcp` y el header `Authorization`.

## Relación con la IA de /v1/site-check

Hoy `/v1/site-check` ejecuta **siempre** las seis verificaciones desde el servicio y entrega la evidencia a la IA, que solo produce una explicación (y como mucho un motivo de riesgo medio). La IA no puede omitir verificaciones ni declarar oficialidad. Que la IA invoque estas tools para ampliar la investigación (bucle de tool use) queda como mejora: el servidor y los servicios ya están listos para eso.

## Limitaciones

- El contenido de `analyze_page_structure` es el que envía quien llama: no se descarga la página.
- Las cachés y los topes son en memoria del proceso de la API.
- Sin sesiones ni notificaciones del servidor (no hace falta para tools de consulta).

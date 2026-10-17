# API v1 — guía para el front

Responsable: Agustin. Los contratos (Zod) están en `packages/contracts/src` y en JSON Schema en `packages/contracts/schemas/v1/`. Cualquier cambio se acuerda entre front y backend.

## Conexión

| Entorno | URL base |
|---|---|
| Local | `http://localhost:3000` |
| Deploy | Tenki, por definir |

- **Autenticación:** header `Authorization: Bearer <token>` en todo salvo `/health`. Agustin entrega el token.
- **Documentación interactiva** (fuera de producción): `GET /docs`.
- **`X-Request-Id`** (opcional): si se envía (`[A-Za-z0-9_-]{1,64}`), el servidor lo devuelve; si no, genera uno. Sirve para reportar errores.
- **Límites:** cuerpo de hasta 512 KB, HTML de hasta 200.000 caracteres y 60 solicitudes por minuto por token (`/v1/site-check` tiene su propio límite: 120 por minuto por token).

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Saber si el servidor está vivo. Sin token |
| POST | `/v1/interpret` | Chat de la home: interpreta lo que pide la persona |
| POST | `/v1/options` | Opciones de la página actual, cada una con su guía |
| POST | `/v1/next-step` | Pasos reales cuando la guía llega a un paso teórico |
| POST | `/v1/site-check` | Protección de sitios: revisa la dirección y el contenido de la página actual |

## La sesión: un solo recorrido de punta a punta

La sesión **empieza en `/v1/interpret`** y acompaña todo el recorrido hasta el último `/v1/next-step`. El backend devuelve el `sessionId` en **todas** las respuestas y el front lo manda en cada llamada siguiente.

En la sesión, el backend acumula:

- **De `interpret`:** el chat y la decisión de Claude (objetivo entendido y motivo). La decisión **no vuelve al front**.
- **De `options`:** el metadato de la página y las opciones devueltas.
- **De `next-step`:** los pasos que completó la persona y los pasos nuevos.

En cada llamada, Claude recibe **todo** ese recorrido como contexto. El HTML no se guarda.

```
interpret (sin sessionId) → crea s-abc
interpret (s-abc)         → mismo chat, hasta redirect u options
options   (s-abc)         → opciones con sus pasos
next-step (s-abc)         → pasos reales y done
```

### POST /v1/interpret

El objetivo es siempre **llegar a una URL**:

- Si Claude llega a una sola URL, responde `redirect`.
- Si hay más de una posible, responde `options`.
- Si todavía no puede llegar a una URL, responde `question`. El front muestra la pregunta, agrega la respuesta de la persona al historial y vuelve a llamar. Esto se repite hasta obtener un `redirect` u `options`.

El front envía **todo el historial** del chat en cada llamada, para que Claude no pierda el contexto. El último mensaje tiene que ser de la persona (`user`). En el primer mensaje no hay `sessionId`; en los siguientes, se manda el que devolvió el backend.

```json
{
  "sessionId": "s-abc",
  "messages": [
    { "role": "user", "content": "Quiero renovar mi documento" },
    { "role": "assistant", "content": "¿En qué país querés hacer el trámite?" },
    { "role": "user", "content": "Argentina" }
  ]
}
```

La respuesta tiene siempre `sessionId`, `type` y `message`:

```json
// Claude resolvió el sitio: el front lleva directo a la URL
{ "sessionId": "s-abc", "type": "redirect", "message": "Te llevo al sitio de turnos.", "url": "https://..." }

// Falta información: el front muestra la pregunta en el chat
{ "sessionId": "s-abc", "type": "question", "message": "¿En qué país querés hacer el trámite?" }

// Varios sitios posibles (2 a 5): el front muestra las opciones para elegir
{ "sessionId": "s-abc", "type": "options", "message": "Encontré estas opciones:",
  "options": [ { "title": "...", "url": "https://...", "reason": "..." } ] }
```

- Las URLs siempre son `http` o `https`. Si Claude devuelve otra cosa, el servidor responde con el error `AI_INVALID_RESPONSE`.
- Las URLs las propone Claude: el backend no comprueba que el sitio exista ni que sea el correcto.

### POST /v1/options

El front envía el `sessionId` de `interpret`, los fragmentos de HTML que considera importantes y, opcionalmente, el **metadato** de la página. Claude devuelve las opciones disponibles, **cada una con su guía completa** (`steps`), teniendo en cuenta todo el recorrido.

Cada paso tiene un `element`:

- **`"#el-3"`**: el id de un elemento del HTML enviado. El front lo ubica y dibuja la indicación (cuadrado, flecha, etc.).
- **`null`**: **paso teórico**. El elemento todavía no existe porque aparece después de una acción de la persona. Los pasos siguientes a uno teórico también lo son.

Si todos los pasos de una opción son reales (por ejemplo, botones que no cargan HTML nuevo), el front guía de punta a punta sin volver a llamar.

```json
{
  "sessionId": "s-abc",
  "html": "<a id=\"el-3\">Turnos</a> <a id=\"el-4\">Contacto</a>",
  "metadata": { "page": { "title": "Hospital X - Inicio", "language": "es" } }
}
```

Respuesta:

```json
{
  "sessionId": "s-abc",
  "options": [
    {
      "id": "turno",
      "title": "Sacar un turno",
      "steps": [
        { "element": "#el-3", "instruction": "Hacé clic en Turnos.", "presentation": "highlight", "waitFor": "userInteraction" },
        { "element": null, "instruction": "Elegí la especialidad.", "presentation": "highlight", "waitFor": "userInteraction" }
      ]
    }
  ]
}
```

- **Sin `sessionId`** (página abierta sin pasar por el chat), el backend crea una sesión nueva.
- **`metadata`** se acumula en la sesión: los campos nuevos pisan a los anteriores y los que no se mandan se conservan. Hoy acepta `page.title` y `page.language`.
- Se puede volver a llamar con el mismo `sessionId`, por ejemplo en una página nueva de la misma tarea.

### POST /v1/next-step

Se llama cuando la guía llega a un **paso teórico** (`element: null`), después de que la persona realizó la acción anterior y la página mostró el HTML nuevo.

```json
{
  "sessionId": "s-abc",
  "optionId": "turno",
  "expectedStep": { "element": null, "instruction": "Elegí la especialidad.", "presentation": "highlight", "waitFor": "userInteraction" },
  "completedSteps": [
    { "element": "#el-3", "instruction": "Hacé clic en Turnos.", "presentation": "highlight", "waitFor": "userInteraction" }
  ],
  "html": "<select id=\"el-9\" aria-label=\"Especialidad\">...</select>",
  "metadata": { "page": { "title": "Hospital X - Especialidades" } }
}
```

Respuesta:

```json
{
  "sessionId": "s-abc",
  "steps": [
    { "element": "#el-9", "instruction": "Elegí la especialidad.", "presentation": "highlight", "waitFor": "userInteraction" }
  ],
  "done": false
}
```

- **`completedSteps`** (obligatorio, puede ser `[]`): los pasos que completó la persona desde la última llamada. Quedan guardados en la sesión.
- **`metadata`** es opcional y se acumula igual que en `/v1/options`.
- **`steps`** son los pasos que siguen, con el mismo formato. Si vuelve a aparecer un paso teórico, se llama otra vez a `/v1/next-step`.
- **`done: true`** significa que la tarea terminó; en ese caso `steps` viene vacío.
- **`optionId`** tiene que ser el id de una opción que `/v1/options` devolvió en esa sesión. Si no, responde `400 BAD_REQUEST`.

### Valores y vencimiento de la sesión

| Campo | Valores |
|---|---|
| `presentation` | `highlight`, `scrollAndHighlight` |
| `waitFor` | `userInteraction`, `navigation`, `userConfirmation` |

- Las sesiones viven en memoria del servidor y vencen a los **30 minutos sin uso**; cada llamada renueva el plazo. Un reinicio del servidor las borra.
- Un `sessionId` inexistente, vencido o creado con otro token devuelve `404 SESSION_NOT_FOUND`. En ese caso el recorrido anterior se perdió: el front empieza una sesión nueva llamando sin `sessionId`.

## Protección de sitios: POST /v1/site-check

Contrato: `packages/contracts/src/site-check.ts` (`SiteCheckRequest`, `SiteCheckResponse`, `siteIndicatorState`). Diseño completo en `proteccion-sitios-agentes.md`.

Un mismo endpoint cubre las dos fases de cada navegación principal:

| Fase | `contentVersion` | `page` | Cuándo |
|---|---|---|---|
| Dirección | `0` | no se envía | Al empezar a navegar |
| Contenido | `1`, `2`, … | obligatorio | Después de la carga y en cada cambio relevante (ruta, formularios, identidad) |

Cada respuesta devuelve **exactamente** el `navigationId` y el `contentVersion` recibidos. El front descarta las respuestas que no correspondan a la navegación y versión actuales. El backend nunca reutiliza una respuesta de otra navegación: en caché solo quedan los resultados de cada fuente (por URL o dominio), y la respuesta se arma de nuevo para cada solicitud.

### Solicitud

```json
{
  "navigationId": "nav-123",
  "contentVersion": 1,
  "url": "https://www.anses.gob.ar/jubilaciones",
  "hostname": "www.anses.gob.ar",
  "registrableDomain": "anses.gob.ar",
  "page": {
    "title": "Jubilaciones",
    "text": "Texto visible acotado y redactado…",
    "declaredBrand": "ANSES",
    "forms": [{ "method": "post", "action": null, "fields": [{ "type": "password", "label": "Clave de la Seguridad Social" }] }],
    "links": [{ "text": "Mi ANSES", "href": "https://servicioswww.anses.gob.ar/" }],
    "scriptHosts": ["www.googletagmanager.com"],
    "iframeHosts": []
  }
}
```

- **Nunca** se envían valores de formularios, cookies, tokens, almacenamiento local ni historial. Un campo con `value` (o cualquier propiedad desconocida) se rechaza con `400 BAD_REQUEST`, sin que el valor llegue a logs ni a proveedores.
- El backend **vuelve a sanitizar**: quita usuario/contraseña, query y fragmento de las URLs, reemplaza por `redactado` los segmentos de path que parecen secretos (tokens, correos, números de 5 o más dígitos), y redacta correos, números largos y tokens del texto. Recalcula `hostname` y `registrableDomain` desde `url` con la Public Suffix List (incluida la sección privada: `github.io`, `web.app`…).
- Direcciones locales, privadas o internas (`localhost`, `127.0.0.1`, `10.x`, `192.168.x`, `.local`, `.internal`, IPv6 privadas…) **no se analizan**: responde `status: "unavailable"`, `risk: "unknown"` y todas las coberturas en `not_applicable`, sin llamar a ningún proveedor.

### Respuesta

```json
{
  "navigationId": "nav-123",
  "contentVersion": 1,
  "analysisId": "sc-…",
  "status": "complete",
  "identity": { "status": "verified_official", "organization": "ANSES (Administración Nacional de la Seguridad Social)" },
  "risk": "no_signals",
  "reasons": [],
  "coverage": { "reputation": "complete", "identity": "complete", "content": "complete", "registration": "unavailable", "connection": "complete" },
  "explanation": "No encontramos señales de estafa en las comprobaciones realizadas.",
  "checkedAt": "2026-10-17T22:00:00.000Z",
  "expiresAt": "2026-10-17T22:10:00.000Z"
}
```

Posible estafa (dominio parecido):

```json
{
  "navigationId": "nav-124",
  "contentVersion": 0,
  "status": "pending",
  "identity": { "status": "unknown", "impersonatedOrganization": "ANSES (Administración Nacional de la Seguridad Social)" },
  "risk": "high",
  "reasons": [
    { "code": "LOOKALIKE_DOMAIN", "category": "fraud",
      "evidence": [{ "source": "Registro de sitios oficiales", "checkedAt": "…", "observedBy": "service", "detail": "El dominio anses-turnos.com se parece a anses.gob.ar" }] }
  ],
  "coverage": { "reputation": "complete", "identity": "complete", "content": "pending", "registration": "complete", "connection": "complete" },
  "checkedAt": "…",
  "expiresAt": "…"
}
```

- **`identity.status: "verified_official"`** sale **solo** del catálogo `apps/api/src/modules/site-check/data/official-sites.json` (organización, dominios, alcance `exact` o `subdomains`, fuente y fecha de revisión). La coincidencia es por límites de dominio: `argentina.gob.ar` cubre `www.argentina.gob.ar`, pero no `argentina.gob.ar.evil.com` ni `evilargentina.gob.ar`. Ni la IA, ni HTTPS, ni la apariencia del sitio pueden otorgarla.
- **`identity.impersonatedOrganization`** aparece cuando hay un motivo de imitación (dominio parecido, subdominio engañoso, caracteres confusos, marca declarada o enlace) que nombra a una organización del catálogo.
- **`evidence[].observedBy`**: `user_browser` (lo vio el navegador de la persona), `external_scanner` (proveedor de reputación) o `service` (catálogo, RDAP, inspección de conexión del backend). Lo que ve el backend puede diferir de lo que ve la persona (sesión, ubicación).
- **`explanation`** es complementaria y la genera la IA. No controla etiquetas ni acciones; el front usa sus propios textos revisados.

### Cómo se calcula

| Campo | Regla |
|---|---|
| `risk: "high"` | Amenaza conocida (`KNOWN_*`) o imitación del dominio (`LOOKALIKE_DOMAIN`, `CONFUSABLE_CHARACTERS`, `MISLEADING_SUBDOMAIN`); o dos señales moderadas distintas |
| `risk: "medium"` | Una señal moderada (`BRAND_IMPERSONATION`, `SENSITIVE_DATA_REQUEST`, `FORM_SENDS_TO_OTHER_DOMAIN`, `LINK_TEXT_MISMATCH`, `URGENCY_OR_THREAT`, `RECENTLY_REGISTERED`), un formulario con datos sensibles por `http`, o un motivo concreto agregado por la IA |
| `risk: "no_signals"` | Sin motivos de fraude y con reputación, identidad (y contenido, en la fase de contenido) completas |
| `risk: "unknown"` | Sin motivos, pero alguna verificación obligatoria no se pudo hacer |
| `status: "pending"` | Fase de dirección (`coverage.content: "pending"`) |
| `status: "complete"` | Fase de contenido con reputación, identidad y contenido `complete` o `not_applicable` |
| `status: "partial"` | Fase de contenido con alguna verificación obligatoria `unavailable` o `partial` |
| `status: "unavailable"` | Dirección local, privada o interna |

- Una amenaza tiene prioridad sobre la identidad oficial: un dominio del catálogo con un reporte de phishing devuelve `identity: verified_official` **y** `risk: high` → el indicador muestra «Posible estafa».
- Los motivos `technical` (`NO_HTTPS`, `CERTIFICATE_PROBLEM`, `CROSS_DOMAIN_REDIRECT`) nunca suben el riesgo por sí solos. `INSECURE_FORM_ACTION` solo aparece con datos sensibles y da, como mucho, riesgo medio.
- Antigüedad, HTTPS y ausencia de reportes **nunca** generan un resultado favorable por sí solos: lo favorable solo surge de no encontrar motivos con las verificaciones obligatorias completas.
- Una contraseña sola no es un pedido sensible (cualquier sitio con usuarios la pide). Cuenta como `SENSITIVE_DATA_REQUEST` cuando el sitio, fuera del catálogo, ya muestra otra señal de fraude. Tarjeta, CBU/CVU, clave fiscal y códigos de verificación cuentan siempre fuera del catálogo.
- La IA puede **subir** de `no_signals`/`unknown` a `medium` con un motivo concreto (fuente «Análisis con IA»). Nunca baja el riesgo ni cambia `identity`. Si la IA falla o tarda más de `SITE_CHECK_AI_TIMEOUT_MS`, la respuesta sale igual sin `explanation`.

### Cobertura mínima acordada con el front

La regla está en `siteIndicatorState()` del contrato y la usan front y tests del backend:

| Estado del indicador | Condición |
|---|---|
| Posible estafa | `risk: high` (siempre primero, aunque sea oficial o parcial) |
| Atención | `risk: medium` |
| Revisando sitio… | `status: pending` |
| No pudimos verificarlo | `status` distinto de `complete`, `risk` distinto de `no_signals`, o reputación, identidad o contenido sin `complete`/`not_applicable` |
| Sitio oficial | Lo anterior completo, `identity.status: verified_official`, `coverage.identity: complete` y ningún motivo `fraud` |
| Sin alertas detectadas | Lo anterior completo sin identidad oficial |

`registration` (RDAP) y `connection` (TLS/redirecciones) **no son obligatorias**: su ausencia nunca aprueba ni reprueba; se informan para transparencia y vencen pronto (`expiresAt`) para reintentar.

### Códigos de motivo

| Código | Categoría | Fuente | Qué significa |
|---|---|---|---|
| `KNOWN_PHISHING` | fraud | Reputación | Reportado como phishing o ingeniería social |
| `KNOWN_MALWARE` | fraud | Reputación | Reportado como malware o software no deseado |
| `LOOKALIKE_DOMAIN` | fraud | Catálogo | Dominio parecido a uno oficial: misma etiqueta con otra terminación, etiqueta vigilada contenida, distancia de edición o letras sustituidas |
| `CONFUSABLE_CHARACTERS` | fraud | Catálogo | Caracteres de otro alfabeto (punycode/IDN) que imitan un dominio oficial, o mezcla de alfabetos |
| `MISLEADING_SUBDOMAIN` | fraud | Catálogo | Un dominio oficial o nombre vigilado aparece en los subdominios de otro dominio (`argentina.gob.ar.evil.com`) |
| `BRAND_IMPERSONATION` | fraud | Contenido | El sitio se declara como una organización del catálogo sin estar autorizado |
| `SENSITIVE_DATA_REQUEST` | fraud | Contenido / IA | Pide tarjeta, CBU/CVU, clave fiscal o códigos fuera del catálogo (o contraseña junto a otra señal) |
| `FORM_SENDS_TO_OTHER_DOMAIN` | fraud | Contenido | Un formulario con datos sensibles envía a otro dominio |
| `LINK_TEXT_MISMATCH` | fraud | Contenido | El texto del enlace muestra un dominio u organización distinta del destino real |
| `URGENCY_OR_THREAT` | fraud | Contenido | Combinación de amenazas o urgencia con un pedido de datos |
| `RECENTLY_REGISTERED` | fraud (apoyo) | RDAP | Dominio registrado hace menos de 30 días. Nunca da riesgo alto por sí solo |
| `NO_HTTPS` | technical | Dirección | La página no usa https |
| `CERTIFICATE_PROBLEM` | technical | Conexión | Certificado vencido, autofirmado o de otro nombre |
| `CROSS_DOMAIN_REDIRECT` | technical | Conexión | La dirección redirige a otro dominio registrable |
| `INSECURE_FORM_ACTION` | technical | Contenido | Un formulario con datos sensibles envía por http |

### Caché, vencimientos y límites

| Fuente | Clave | Vigencia |
|---|---|---|
| Reputación sin reportes | hash de proveedor + URL depurada | 10 min |
| Reputación con reporte | ídem | la que indique el proveedor (máx. 30 min) |
| RDAP | hash del dominio registrable | 24 h (bootstrap de IANA: 24 h) |
| Conexión | hash de la URL depurada | 1 h |
| Catálogo y contenido | sin caché (se evalúan en cada solicitud) | 10 min |

- `expiresAt` = la vigencia más corta de las fuentes usadas. Con alguna cobertura `unavailable`/`partial`, y en la fase de dirección, es de **60 segundos**.
- Las fallas no se guardan en caché: «Intentar de nuevo» vuelve a consultar.
- Consultas simultáneas a la misma URL comparten una sola llamada al proveedor.
- Tiempos máximos: `SITE_CHECK_PROVIDER_TIMEOUT_MS` (reputación y RDAP, 4 s), `SITE_CHECK_CONNECTION_TIMEOUT_MS` (todas las redirecciones, 5 s) y `SITE_CHECK_AI_TIMEOUT_MS` (8 s). Las fuentes corren en paralelo.
- Tope por proveedor: `SITE_CHECK_PROVIDER_MAX_PER_MINUTE` (120). Al superarlo, esa cobertura queda `unavailable`.
- Logs: solo fase, estado, riesgo, códigos, coberturas y latencia. Nunca URLs, dominios, contenido de página ni claves.

### Proveedores y configuración

| Variable | Valores | Uso |
|---|---|---|
| `REPUTATION_PROVIDER` | `none` (defecto), `mock`, `safe_browsing`, `web_risk` | Fuente de reputación. `mock` no se permite en producción |
| `GOOGLE_SAFE_BROWSING_API_KEY` | clave | Requerida con `safe_browsing` |
| `GOOGLE_WEB_RISK_API_KEY` | clave | Requerida con `web_risk` |
| `SITE_CHECK_RDAP` | `true`/`false` | Consulta RDAP |
| `SITE_CHECK_CONNECTION` | `true`/`false` | Inspección de TLS y redirecciones |
| `SITE_CHECK_AI` | `true`/`false` | Explicación de la IA (usa `AI_PROVIDER`) |
| `SITE_CHECK_RATE_LIMIT_MAX` | número | Solicitudes por ventana y token en `/v1/site-check` |
| `SITE_CHECK_PROVIDER_TIMEOUT_MS`, `SITE_CHECK_CONNECTION_TIMEOUT_MS`, `SITE_CHECK_AI_TIMEOUT_MS`, `SITE_CHECK_PROVIDER_MAX_PER_MINUTE` | número | Tiempos máximos y topes |

Las claves viven solo en el servidor. Sin proveedor de reputación (`none`), la cobertura de reputación es `unavailable` y el indicador **nunca** muestra un estado favorable.

**Consultar reportes vs. enviar a escanear.** Todas las implementaciones solo **consultan** listas de reportes existentes. Ninguna envía una URL a un escaneo nuevo (como `urlscan.io` o el envío de URLs de VirusTotal), que la haría pública o la compartiría con terceros y, con ella, datos del recorrido de la persona. No se publica nada automáticamente.

| Opción | Licencia y costo | Privacidad | Cobertura |
|---|---|---|---|
| Google Safe Browsing Lookup API v4 (`safe_browsing`) | Gratuita, **solo uso no comercial** según los términos de Google | La URL depurada viaja en claro a Google (sin query, fragmento ni secretos) | Phishing, malware, software no deseado; listas de Google |
| Google Cloud Web Risk `uris.search` (`web_risk`) | **Comercial**, facturada por consulta en Google Cloud (ver la tarifa vigente) | Igual que Lookup: la URL depurada viaja a Google. La Update API (hashes locales) daría más privacidad y queda como mejora | Mismas listas que Safe Browsing, con SLA |
| `mock` | Solo desarrollo | Sin red | Marca hosts con la etiqueta `phishing-demo` o `malware-demo` (por ejemplo `https://phishing-demo.example.com/`) |
| RDAP vía bootstrap IANA | Público y gratuito; cada registro fija sus límites | Solo se envía el dominio registrable | Depende del TLD. `.ar` usa `rdap.nic.ar`, que en las pruebas del 17/10/2026 respondió con demoras de más de 10 s y errores 500: para dominios argentinos `registration` suele quedar `unavailable` |
| Inspección de conexión propia | Sin costo | El backend se conecta al sitio (sin cookies ni credenciales, solo encabezados, sin query) | TLS del primer salto y hasta 5 redirecciones |

### Limitaciones

- No promete detectar todas las amenazas: un sitio de phishing nuevo puede no estar reportado todavía, y el catálogo solo reconoce las organizaciones cargadas.
- El catálogo inicial es una **semilla de ejemplo** (argentina.gob.ar, ARCA/AFIP, ANSES, PAMI, BCRA, Banco Nación, Banco Provincia, Banco Ciudad). Antes de producción cada entrada debe revisarse contra su fuente. Un dominio legítimo de una organización que falte en el catálogo puede marcarse como parecido.
- La detección de dominios parecidos usa etiquetas vigiladas por entrada (`watchLabels`), distancia de edición y un subconjunto de confusables Unicode. Puede haber falsos positivos (dominios legítimos con nombres similares) y falsos negativos.
- Las reglas de contenido trabajan sobre el resumen que extrae el navegador: no ven el código de la página ni cambios posteriores, ni contenido dentro de iframes de otro origen.
- La inspección de conexión ve lo que ve el servidor, que puede diferir de lo que ve la persona (sesión, geolocalización, cloaking).
- Las cachés y los topes son en memoria, por proceso: se pierden al reiniciar y no se comparten entre réplicas.

## Qué queda del lado del front

1. **Sesión:** guardar el `sessionId` que devuelve la primera llamada a `/v1/interpret` y mandarlo en **todas** las llamadas siguientes (`interpret`, `options` y `next-step`). Si llega `SESSION_NOT_FOUND`, empezar una sesión nueva.
2. **Chat:** guardar el historial y enviarlo completo en cada `/v1/interpret`. Según `type`: redirigir, mostrar la pregunta o mostrar las opciones de sitios.
3. **Fragmentos de HTML:** armar el HTML que se envía, con un id por elemento y sin datos sensibles.
4. **Metadato:** enviar en `metadata.page` los datos de la página que tenga (título, idioma) al cargarla.
5. **Guía:** recorrer los `steps` de la opción elegida. Ante un paso con `element: null`, esperar la acción de la persona y llamar a `/v1/next-step` con el HTML nuevo y los `completedSteps`.
6. **Elementos:** ubicar `element` en la página (si hace falta, subiendo al elemento padre) y manejar el caso en que no se encuentra. El backend no verifica que el id exista en el HTML.
7. **Representación visual:** dibujar la indicación según `presentation`, mostrar `instruction` y esperar según `waitFor`.
8. **Errores:** mostrar un mensaje según `code` y reintentar solo si `retryable` es `true`. El backend puede tardar hasta ~90 segundos en el peor caso (30 s por intento con hasta 2 reintentos).

## Errores

Formato único para todos los endpoints:

```json
{ "error": { "code": "AI_UNAVAILABLE", "message": "Claude no está disponible", "requestId": "req-...", "retryable": true } }
```

| Código | HTTP | Reintentar |
|---|---|---|
| `BAD_REQUEST` (con `details[]`) | 400 | no |
| `UNAUTHORIZED` | 401 | no |
| `NOT_FOUND` | 404 | no |
| `SESSION_NOT_FOUND` | 404 | no: empezar una sesión nueva |
| `PAYLOAD_TOO_LARGE` | 413 | no: enviar menos HTML |
| `AI_REFUSED` | 422 | no |
| `RATE_LIMITED` | 429 | sí |
| `INTERNAL` | 500 | no |
| `AI_INVALID_RESPONSE` | 502 | no |
| `AI_UNAVAILABLE` | 503 | sí |
| `TIMEOUT` | 504 | sí |

`message` es técnico; el front decide qué texto mostrar a la persona.

## Modo mock

Con `AI_PROVIDER=mock` (el valor por defecto en desarrollo), el servidor responde sin llamar a Claude:

- `/v1/interpret`: con un solo mensaje devuelve `question`; con más de uno devuelve `redirect` a `https://www.example.com/`.
- `/v1/options`: devuelve una opción `start` con dos pasos: el primero sobre el primer `id="..."` del HTML y el segundo teórico (`element: null`). Si el HTML no tiene ids, devuelve `options: []`.
- `/v1/next-step`: si el HTML tiene un `id="..."`, devuelve un paso sobre ese elemento con `done: false`. Si no tiene ninguno, devuelve `steps: []` y `done: true`.
- `/v1/site-check`: la explicación es un texto fijo según el riesgo y la IA nunca agrega motivos. Con `REPUTATION_PROVIDER=mock` (el valor de `.env.example`), los hosts con la etiqueta `phishing-demo` o `malware-demo` figuran como amenaza conocida. RDAP y la inspección de conexión son reales salvo que se deshabiliten con `SITE_CHECK_RDAP=false` y `SITE_CHECK_CONNECTION=false`.

### Probar /v1/site-check a mano

```bash
pnpm dev   # con apps/api/.env copiado de .env.example
TOKEN=dev-token-solo-para-desarrollo-local
# Fase de dirección en un sitio oficial → status pending, identity verified_official
curl -s localhost:3000/v1/site-check -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"navigationId":"nav-1","contentVersion":0,"url":"https://www.argentina.gob.ar/","hostname":"www.argentina.gob.ar","registrableDomain":"argentina.gob.ar"}'
# Fase de contenido en un dominio parecido → risk high, LOOKALIKE_DOMAIN
curl -s localhost:3000/v1/site-check -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"navigationId":"nav-2","contentVersion":1,"url":"https://anses-turnos.com/","hostname":"anses-turnos.com","registrableDomain":"anses-turnos.com","page":{"text":"Su beneficio será suspendido. Ingrese su CBU.","forms":[{"method":"post","action":null,"fields":[{"type":"text","label":"CBU"}]}],"links":[],"scriptHosts":[],"iframeHosts":[]}}'
# Amenaza simulada → KNOWN_PHISHING
curl -s localhost:3000/v1/site-check -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"navigationId":"nav-3","contentVersion":0,"url":"https://phishing-demo.example.com/","hostname":"phishing-demo.example.com","registrableDomain":"example.com"}'
```

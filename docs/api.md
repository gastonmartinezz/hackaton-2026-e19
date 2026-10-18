# API v1 — guía para el front

Responsable: Agustin. Los contratos (Zod) están en `packages/contracts/src` y en JSON Schema en `packages/contracts/schemas/v1/`. Cualquier cambio se acuerda entre front y backend.

## Conexión

| Entorno | URL base |
|---|---|
| Local | `http://localhost:3000` |
| Deploy | Tenki, por definir. Railway: ver [railway.md](railway.md) |

- **Autenticación:** header `Authorization: Bearer <token>` en todo salvo `/health`. Agustin entrega el token.
- **Documentación interactiva** (fuera de producción): `GET /docs`.
- **`X-Request-Id`** (opcional): si se envía (`[A-Za-z0-9_-]{1,64}`), el servidor lo devuelve; si no, genera uno. Sirve para reportar errores.
- **Límites:** cuerpo de hasta 512 KB, HTML de hasta 200.000 caracteres y 60 solicitudes por minuto por token. `/v1/site-check` (120 por minuto por token) y `/v1/transcribe` tienen los suyos (ver abajo).

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Saber si el servidor está vivo y el estado del modelo de voz. Sin token |
| POST | `/v1/interpret` | Chat de la home: interpreta lo que pide la persona |
| POST | `/v1/options` | Opciones de la página actual, cada una con su guía |
| POST | `/v1/next-step` | Pasos reales cuando la guía llega a un paso teórico |
| POST | `/v1/site-check` | Protección de sitios: revisa la dirección y el contenido de la página actual |
| POST | `/v1/transcribe` | Voz a texto: el texto se usa después en `/v1/interpret` |

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

Opcionalmente, el front manda en `user` datos de la persona para que Claude priorice sitios de **su localidad** (por ejemplo, el municipio o la provincia donde vive). Todos los campos son opcionales y se envían en cada llamada:

```json
{
  "messages": [{ "role": "user", "content": "Quiero pagar la tasa municipal" }],
  "user": {
    "location": { "country": "AR", "region": "Córdoba", "city": "Villa María" },
    "ageRange": "65-74",
    "language": "es-AR",
    "timeZone": "America/Argentina/Cordoba"
  }
}
```

- `location.country`: código ISO 3166-1 alfa-2. `region` (provincia o estado) y `city` (ciudad o localidad, nunca la dirección): hasta 80 caracteres.
- `ageRange`: `under-50`, `50-64`, `65-74` o `75-plus`. Nunca la edad exacta.
- `language` (BCP 47) y `timeZone` (IANA) salen del sistema; sin `location`, Claude los usa como pista del país.
- `user` no se guarda en la sesión ni aparece en los logs.

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
- **`goal`** (opcional, hasta 1.000 caracteres): lo que la persona quiere hacer en esta página, por ejemplo lo que escribió en «¿No está lo que buscás?». Claude pone primero la opción que lo resuelve, si la página lo permite. Se guarda en el historial de la sesión.
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

### POST /v1/transcribe

Convierte lo que la persona dice en texto, con **Whisper corriendo en nuestro propio servidor** (sin proveedores externos). El front manda el texto después a `/v1/interpret` como un mensaje más, igual que si lo hubiera escrito. `/v1/interpret` no cambia.

Contrato en `packages/contracts/src/transcribe.ts` (`TRANSCRIBE_*` y `TranscribeResponse`).

**Solicitud:** cuerpo **binario** (no JSON) con `Content-Type: audio/wav` y el Bearer de siempre.

- WAV RIFF con PCM entero de **16 bits little-endian, mono, 16 000 Hz** (`TRANSCRIBE_SAMPLE_RATE`).
- Entre **0,3 s y 30 s** (`TRANSCRIBE_MAX_SECONDS`), o sea hasta `TRANSCRIBE_MAX_BYTES` = 960 044 bytes. El servidor acepta además `TRANSCRIBE_HEADER_HEADROOM_BYTES` = 4096 bytes de margen para WAV con chunks extra (LIST, fact…) antes de `data`; la duración se controla igual al leer el audio.
- El servidor no convierte formatos: el front graba o remuestrea a 16 kHz mono antes de enviar. Se aceptan chunks extra (`LIST`, etc.) antes de `data`.

```bash
curl -X POST "$API/v1/transcribe" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: audio/wav" \
  --data-binary @voz.wav
```

**Respuesta 200:**

```json
{ "text": "Quiero renovar mi documento" }
```

- `text` viene recortado y con hasta 1000 caracteres.
- **`""` no es un error**: significa que no se entendió nada (silencio, ruido o frases que Whisper inventa con silencio, como «Subtítulos realizados por la comunidad de Amara.org»). El front le pide a la persona que repita o que escriba.

**Errores** (solo códigos que ya existían):

| Caso | Código | HTTP | `retryable` |
|---|---|---|---|
| No es WAV, otro formato (estéreo, 44,1 kHz, 8 bits, float), truncado o menos de 0,3 s | `BAD_REQUEST` | 400 | no |
| Más de 30 s o más de `TRANSCRIBE_MAX_BYTES` + `TRANSCRIBE_HEADER_HEADROOM_BYTES` | `PAYLOAD_TOO_LARGE` | 413 | no |
| Voz a texto apagada en este servidor (`STT_PROVIDER=off`) | `AI_UNAVAILABLE` | 503 | **no**: ocultar el micrófono |
| El modelo se está cargando (primeros segundos tras un arranque), se reinició o la cola está llena | `AI_UNAVAILABLE` | 503 | sí, salvo `/v1/transcribe` apagado (`retryable: false`) |
| La transcripción tardó más que `STT_TIMEOUT_MS` (30 s por defecto) | `TIMEOUT` | 504 | sí |
| Más de 20 solicitudes por minuto por token | `RATE_LIMITED` | 429 | sí |

- **Privacidad:** el audio y el texto solo viven en memoria durante la solicitud. No se guardan ni se registran, tampoco en errores: los logs tienen solo la duración del audio, la latencia y el resultado.
- **Estado del modelo:** `GET /health` responde siempre 200 y agrega `stt`: `off`, `loading`, `ready` o `failed`. Sirve para decidir si mostrar el micrófono, no para reintentar en bucle.

```json
{ "status": "ok", "stt": "ready" }
```

**Latencia de referencia** (whisper-small q8 en CPU): ~1 a 2 s para una frase corta y ~4 s para 23 s de audio con 2 vCPU. En el primer arranque el modelo tarda unos segundos en estar listo.

**Whisper en local:** con `STT_PROVIDER=local` en `apps/api/.env`, el primer arranque descarga el modelo (~250 MB) a `apps/api/.models` y después lo reutiliza. Para bajarlo antes: `pnpm --filter @hackaton/api build && pnpm --filter @hackaton/api stt:prefetch`. Para integrar el front alcanza con `STT_PROVIDER=mock`.

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
  "identity": {
    "status": "verified_official",
    "basis": "government_domain",
    "organization": "Estado argentino",
    "source": { "name": "NIC Argentina, Disposición 153/2016 (zonas especiales)", "url": "https://www.argentina.gob.ar/normativa/nacional/norma-270431/texto", "reviewedAt": "2026-10-17T00:00:00.000Z" }
  },
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
  "identity": { "status": "unknown", "impersonatedOrganization": "BANCO DE LA NACION ARGENTINA" },
  "risk": "high",
  "reasons": [
    { "code": "LOOKALIKE_DOMAIN", "category": "fraud",
      "evidence": [{ "source": "Fuentes de autoridad", "checkedAt": "…", "observedBy": "service", "detail": "bna-seguro.com combina bna con una palabra de acceso o seguridad" }] }
  ],
  "coverage": { "reputation": "complete", "identity": "complete", "content": "pending", "registration": "complete", "connection": "complete" },
  "checkedAt": "…",
  "expiresAt": "…"
}
```

- **`identity.status: "verified_official"`** sale **solo** de una fuente de autoridad (ver «Fuentes de oficialidad»), siempre con `basis` y `source`. La coincidencia es por límites de dominio: `gob.ar` cubre `www.anses.gob.ar`, pero no `anses.gob.ar.evil.com` ni `anses-gob-ar.com`. Ni la IA, ni HTTPS, ni la apariencia del sitio pueden otorgarla.
- **`identity.impersonatedOrganization`** aparece cuando hay un motivo de imitación (dominio parecido, subdominio engañoso, caracteres confusos, marca declarada o enlace) que nombra a una organización de las fuentes de autoridad (el Estado, una entidad del padrón del BCRA o una entrada de un catálogo curado).
- **`evidence[].observedBy`**: `user_browser` (lo vio el navegador de la persona), `external_scanner` (proveedor de reputación) o `service` (fuentes de autoridad, RDAP, inspección de conexión del backend, IA). Lo que ve el backend puede diferir de lo que ve la persona (sesión, ubicación).
- **`explanation`** es complementaria y la genera la IA. No controla etiquetas ni acciones; el front usa sus propios textos revisados.

### Fuentes de oficialidad

«Sitio oficial» (`identity.status: "verified_official"`) solo sale de **una autoridad que pueda probarlo**. Cada respuesta oficial trae `identity.basis` y `identity.source` (`name`, `url`, `reviewedAt`), que el front muestra en «Ver por qué».

| `basis` | Fuente | Cómo se obtiene | `source` |
|---|---|---|---|
| `government_domain` | Zonas de dominio reservadas al Estado: `gob.ar`, `mil.ar`, `gov.ar` → «Estado argentino»; `.gov`, `.mil` → «Gobierno de Estados Unidos»; y las zonas de los catálogos curados (por ejemplo `gub.uy`, si se confirma que está reservada) | Regla de zona sobre los datos de `apps/api/src/modules/site-check/data/government-zones.json` (y `zones` de cada catálogo), por límites de dominio. No se generaliza a cualquier `gob.xx` | Norma o política de la zona: [Disposición NIC Argentina 153/2016](https://www.argentina.gob.ar/normativa/nacional/norma-270431/texto), [get.gov/domains/eligibility](https://get.gov/domains/eligibility), [IANA .mil](https://www.iana.org/domains/root/db/mil.html), con la fecha de revisión del archivo |
| `financial_regulator` | Padrón de entidades financieras del BCRA | Descarga automática del regulador (ver abajo). Autoriza el dominio registrable del sitio web publicado para cada entidad y sus subdominios | «Padrón de entidades financieras del BCRA», URL del detalle descargado y fecha de descarga de la copia usada |
| `official_catalog` | Catálogos curados `data/official-sites.<país>.json` (por ejemplo Uruguay), con fuente y fecha de revisión **por entrada** | Archivo versionado validado con Zod al arrancar: si es inválido o repite un dominio, el servidor no arranca. Alcance `exact` o `subdomains` | `source` y `reviewedAt` de la entrada |

Orden de evaluación: catálogo curado, zona de gobierno, padrón del BCRA.

**Por qué no hay un catálogo argentino escrito a mano.** Una lista de ejemplo no es verificable ni se mantiene sola, y lo que falta en ella termina marcado como «parecido». Las zonas de gobierno y el padrón del BCRA tienen una autoridad detrás y se actualizan solos. Los catálogos curados se aceptan solo con fuente y fecha por entrada.

**Por qué la IA no aprueba.** En el informe de Netcraft (2025), el 34 % de los dominios de inicio de sesión que un LLM dio para marcas conocidas no pertenecían a la marca. La IA solo **identifica** qué organización dice ser la página (`declaredOrganization`, tipo y país) y si pide credenciales, pagos o códigos. Esa organización se busca en las fuentes de autoridad: si la página dice ser ANSES, ARCA, PAMI u otro organismo del Estado argentino (o una entidad del padrón o del catálogo) y el dominio no le pertenece, el motivo es `BRAND_IMPERSONATION` con `impersonatedOrganization`, y el riesgo es alto si además pide datos sensibles. La IA nunca emite `verified_official` ni baja el riesgo. Con `AI_PROVIDER=mock` o `SITE_CHECK_AI=false`, las mismas reglas corren sobre `declaredBrand` del front.

**Señales que no alcanzan para «oficial»** (no se implementan como oficialidad): Wikidata P856 (sitio web oficial), rankings de popularidad, certificados OV/EV, BIMI y antigüedad del dominio. Como mucho podrían sumar contexto.

**Riesgos de la regla de zona.** El aviso del Boletín Oficial del 07/05/2025 ([313726](https://www.boletinoficial.gob.ar/pdf/aviso/primera/313726/20250507)) anuncia la desregulación de zonas especiales de NIC Argentina: si cambia quién puede registrar en `gob.ar`, hay que revisar `government-zones.json`. Además, un sitio de gobierno comprometido sigue siendo «oficial»: por eso **el riesgo gana siempre** (una amenaza en `.gob.ar` muestra «Posible estafa»).

#### Padrón del BCRA

- El [catálogo de APIs del BCRA](https://www.bcra.gob.ar/apis-banco-central/) (Central de Deudores, Cheques, Estadísticas, Régimen de Transparencia) **no** publica el sitio web de las entidades.
- La página [Entidades Financieras](https://www.bcra.gob.ar/entidades-financieras/) lo arma con un endpoint JSON propio, sin documentar:
  - `https://www.bcra.gob.ar/api/endpoints/entidades-financieras.php?action=list&lang=es`: `{ success, disponible, fecha_actualizacion, entidades: [{ codigo, nombre }] }`.
  - `…?action=detail&category=<código>&lang=es`: `{ success, entidad: { codigo, nombre, sitio_web, … } }`.
- Prueba real del 17/10/2026: 73 entidades; 70 con sitio web utilizable. Se descartaron 3: una sin sitio, una sin dato y `www.mobilize fs.com.ar`, que tiene un espacio. Los nombres llegan en mayúsculas y cortados a 35 caracteres. El CDN a veces responde 502 a una variante de la URL (con o sin `lang`), así que se prueban las dos.
- Refresco: se descarga al arrancar y se intenta refrescar cada 24 h, con 6 pedidos en paralelo y `SITE_CHECK_REGISTRY_TIMEOUT_MS` por pedido. Si fallan más del 10 % de los detalles, la descarga se descarta; si fallan menos, se conservan las entidades de la copia anterior.
- Si el refresco falla:
  - Hasta 48 h desde la última descarga buena, la copia sigue **vigente**.
  - Hasta 7 días, la copia queda **vieja**: se usa para detectar imitaciones, pero **nunca aprueba**, y `coverage.identity` es `partial`.
  - Después, el padrón queda `unavailable`.
- Sin padrón, los sitios que no están en una zona de gobierno ni en un catálogo quedan con identidad `unavailable`, y el indicador nunca es favorable.
- Al ser un endpoint sin documentar, un cambio de formato hace fallar la validación con Zod: el resultado es identidad `unavailable`, nunca una aprobación.

#### Dominios parecidos (sin lista manual)

Las referencias salen, en este orden de peso, de:

1. Dominios del padrón del BCRA (también de una copia vieja).
2. Dominios de los catálogos curados.
3. Zonas de gobierno.
4. Opcionalmente, una lista de dominios populares (`SITE_CHECK_POPULAR_DOMAINS_FILE`).

Las heurísticas siguen el estilo de las advertencias de dominios parecidos de Chrome:

- Mismo esqueleto visual (UTS #39: letras de otro alfabeto, `0`/`o`, `rn`/`m`) → `CONFUSABLE_CHARACTERS` si hay caracteres no ASCII; si no, `LOOKALIKE_DOMAIN`.
- Una edición de distancia, solo con nombres de 7 o más letras.
- El dominio de referencia embebido en otro: `bna.com.ar.verificacion.net` → `MISLEADING_SUBDOMAIN`.
- Marca + palabra clave: `bna-seguro.com`, `antel-uy.com`, `macro-login.com`.
- Cambio de terminación (`bancociudad.com` frente a `bancociudad.com.ar`): **solo si hay lista de dominios populares** configurada, para excluir sitios globales legítimos. En la prueba real, sin esa lista, la regla marcaba `santander.com`, `bbva.com` e `icbc.com` como estafa, así que queda apagada por defecto.
- Zonas de gobierno imitadas: `anses-gob-ar.com`, `anses-gob.ar.com`, `anses.gob.ar.evil.com`, `gub-uy.com`, o `.gob.ar` falso con homoglifos.

«banco» no cuenta como palabra clave: `bancogalicia.com` no se marca.

**Lista de dominios populares.** No se incluye ninguna en el repositorio:

- [CrUX](https://developer.chrome.com/docs/crux) por país está bajo licencia CC BY-SA 4.0. Si se usa, hay que atribuirla y compartir las obras derivadas con la misma licencia.
- Tranco incluye datos de Cloudflare Radar bajo CC BY-NC (no comercial). Se omitió por esa licencia.

El archivo acepta un dominio u origen por línea, o un CSV con el origen en la primera columna (formato CrUX). Solo agrega referencias de parecido: nunca otorga oficialidad.

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

- Una amenaza tiene prioridad sobre la identidad oficial: un dominio `.gob.ar` o del padrón con un reporte de phishing devuelve `identity: verified_official` **y** `risk: high` → el indicador muestra «Posible estafa».
- Los motivos `technical` (`NO_HTTPS`, `CERTIFICATE_PROBLEM`, `CROSS_DOMAIN_REDIRECT`) nunca suben el riesgo por sí solos. `INSECURE_FORM_ACTION` solo aparece con datos sensibles y da, como mucho, riesgo medio.
- Antigüedad, HTTPS y ausencia de reportes **nunca** generan un resultado favorable por sí solos: lo favorable solo surge de no encontrar motivos con las verificaciones obligatorias completas.
- Una contraseña sola no es un pedido sensible (cualquier sitio con usuarios la pide). Cuenta como `SENSITIVE_DATA_REQUEST` cuando el sitio, sin identidad oficial, ya muestra otra señal de fraude (por ejemplo, dice ser ANSES). Tarjeta, CBU/CVU, clave fiscal y códigos de verificación cuentan siempre en sitios sin identidad oficial.
- La IA solo identifica la organización declarada y los pedidos (credenciales, pagos, códigos), con salida validada por Zod. Lo que identifica se contrasta con las fuentes de autoridad y puede sumar `BRAND_IMPERSONATION` o `SENSITIVE_DATA_REQUEST` (fuente «Análisis con IA»). Nunca baja el riesgo ni cambia `identity`. Si la IA falla o tarda más de `SITE_CHECK_AI_TIMEOUT_MS`, `coverage.content` queda `partial` (nunca favorable) y la respuesta sale sin `explanation`.

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
| `LOOKALIKE_DOMAIN` | fraud | Fuentes de autoridad | Dominio parecido a uno del padrón, de un catálogo o a una zona de gobierno: letras sustituidas, una edición, marca + palabra clave, otra terminación |
| `CONFUSABLE_CHARACTERS` | fraud | Fuentes de autoridad | Caracteres de otro alfabeto (punycode/IDN) que imitan un dominio de referencia o una zona de gobierno, o mezcla de alfabetos |
| `MISLEADING_SUBDOMAIN` | fraud | Fuentes de autoridad | Una zona de gobierno, un dominio de referencia o una marca aparece en los subdominios de otro dominio (`anses.gob.ar.evil.com`) |
| `BRAND_IMPERSONATION` | fraud | Contenido / IA | El sitio dice ser un organismo del Estado, una entidad del padrón o una organización de un catálogo y el dominio no le pertenece |
| `SENSITIVE_DATA_REQUEST` | fraud | Contenido / IA | Pide tarjeta, CBU/CVU, clave fiscal, pagos o códigos en un sitio sin identidad oficial (o contraseña junto a otra señal) |
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
| Padrón del BCRA | en memoria, una copia | refresco cada 24 h; vigente 48 h; vieja (no aprueba) hasta 7 días |
| Zonas, catálogos y contenido | sin caché (se evalúan en cada solicitud) | 10 min |

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
| `SITE_CHECK_BCRA_REGISTRY` | `true`/`false` | Padrón del BCRA. Con `false`, los bancos no pueden ser «Sitio oficial» y lo que no está en zonas ni catálogos queda sin verificar |
| `SITE_CHECK_REGISTRY_TIMEOUT_MS` | número | Tiempo máximo por pedido al BCRA (8 s) |
| `SITE_CHECK_POPULAR_DOMAINS_FILE`, `SITE_CHECK_POPULAR_DOMAINS_LIMIT` | ruta, número | Lista opcional de dominios populares (solo referencias de parecido) |
| `SITE_CHECK_CONNECTION` | `true`/`false` | Inspección de TLS y redirecciones |
| `SITE_CHECK_AI` | `true`/`false` | Identificación de la organización declarada y explicación (usa `AI_PROVIDER`) |
| `SITE_CHECK_RATE_LIMIT_MAX` | número | Solicitudes por ventana y token en `/v1/site-check` |
| `SITE_CHECK_PROVIDER_TIMEOUT_MS`, `SITE_CHECK_CONNECTION_TIMEOUT_MS`, `SITE_CHECK_AI_TIMEOUT_MS`, `SITE_CHECK_PROVIDER_MAX_PER_MINUTE` | número | Tiempos máximos y topes |

Las claves viven solo en el servidor. Sin proveedor de reputación (`none`), la cobertura de reputación es `unavailable` y el indicador **nunca** muestra un estado favorable.

**Consultar reportes vs. enviar a escanear.** Todas las implementaciones solo **consultan** listas de reportes existentes. Se evitan a propósito:

- La Web Risk **Evaluate API**, porque envía la URL a evaluar.
- Los escaneos de `urlscan.io`, porque publican o comparten la URL.
- El envío de URLs a VirusTotal.

Todas exponen la URL, y con ella datos del recorrido de la persona. No se publica nada automáticamente.

**Licencias:**

- Web Risk está pensada para uso comercial.
- Safe Browsing Lookup v4 es gratuita, pero solo para uso no comercial.
- La API pública de VirusTotal tampoco permite uso comercial.
- Para un servicio comercial corresponde Web Risk.

| Opción | Licencia y costo | Privacidad | Cobertura |
|---|---|---|---|
| Google Safe Browsing Lookup API v4 (`safe_browsing`) | Gratuita, **solo uso no comercial** según los términos de Google | La URL depurada viaja en claro a Google (sin query, fragmento ni secretos) | Phishing, malware, software no deseado; listas de Google |
| Google Cloud Web Risk `uris.search` (`web_risk`) | **Comercial**, facturada por consulta en Google Cloud (ver la tarifa vigente) | Igual que Lookup: la URL depurada viaja a Google. La Update API (hashes locales) daría más privacidad y queda como mejora | Mismas listas que Safe Browsing, con SLA |
| `mock` | Solo desarrollo | Sin red | Marca hosts con la etiqueta `phishing-demo` o `malware-demo` (por ejemplo `https://phishing-demo.example.com/`) |
| RDAP vía bootstrap IANA | Público y gratuito; cada registro fija sus límites | Solo se envía el dominio registrable | Depende del TLD. `.ar` usa `rdap.nic.ar`, que en las pruebas del 17/10/2026 respondió con demoras de más de 10 s y errores 500: para dominios argentinos `registration` suele quedar `unavailable` |
| Inspección de conexión propia | Sin costo | El backend se conecta al sitio (sin cookies ni credenciales, solo encabezados, sin query) | TLS del primer salto y hasta 5 redirecciones |

### Limitaciones

- No promete detectar todas las amenazas: un sitio de phishing nuevo puede no estar reportado todavía.
- «Oficial» cubre solo lo que una autoridad respalda: organismos en zonas de gobierno, entidades del padrón del BCRA y entradas de catálogos curados. Empresas legítimas fuera de esas fuentes (telefónicas argentinas, comercios, billeteras que no son bancos) se muestran como «Sin alertas detectadas», nunca como oficiales.
- El padrón depende de un endpoint sin documentar del BCRA. Si deja de responder o cambia de formato, los bancos dejan de verse como oficiales (nunca se aprueba en falso). Un banco que use otros dominios además del publicado (por ejemplo `bancogalicia.com` frente a `galicia.ar`) no es oficial en esos otros dominios.
- La coincidencia entre una marca declarada y el padrón exige una palabra financiera («Banco Galicia») o la pista de la IA: «Galicia» o «La Nación» solas no se asocian al banco, para no acusar a un diario.
- La detección de dominios parecidos puede dar falsos positivos (un dominio legítimo con un nombre parecido a una entidad) y falsos negativos (marcas cortas de 3 letras solo se detectan con una palabra clave).
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
8. **Voz:** grabar en WAV PCM 16 bits mono a 16 kHz, mandar a `/v1/transcribe` y usar el `text` como el mensaje de la persona en `/v1/interpret`. Con `text: ""`, pedir que repita. Con `AI_UNAVAILABLE` no reintentable, ocultar el micrófono.
9. **Errores:** mostrar un mensaje según `code` y reintentar solo si `retryable` es `true`. El backend puede tardar hasta ~90 segundos en el peor caso (30 s por intento con hasta 2 reintentos).

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
| `PAYLOAD_TOO_LARGE` | 413 | no: enviar menos HTML (o menos de 30 s de audio) |
| `AI_REFUSED` | 422 | no |
| `RATE_LIMITED` | 429 | sí |
| `INTERNAL` | 500 | no |
| `AI_INVALID_RESPONSE` | 502 | no |
| `AI_UNAVAILABLE` | 503 | sí |
| `TIMEOUT` | 504 | sí |

`message` es técnico; el front decide qué texto mostrar a la persona. Seguir siempre el `retryable` de la respuesta y no la tabla: en algún caso puntual difiere del valor habitual del código.

## Modo mock

Con `AI_PROVIDER=mock` (el valor por defecto en desarrollo), el servidor responde sin llamar a Claude:

- `/v1/interpret`: con un solo mensaje devuelve `question`; con más de uno devuelve `redirect` a `https://www.example.com/`.
- `/v1/options`: devuelve una opción `start` con dos pasos: el primero sobre el primer `id="..."` del HTML y el segundo teórico (`element: null`). Si el HTML no tiene ids, devuelve `options: []`.
- `/v1/next-step`: si el HTML tiene un `id="..."`, devuelve un paso sobre ese elemento con `done: false`. Si no tiene ninguno, devuelve `steps: []` y `done: true`.
- `/v1/site-check`: la explicación es un texto fijo según el riesgo y la IA nunca agrega motivos. Con `REPUTATION_PROVIDER=mock` (el valor de `.env.example`), los hosts con la etiqueta `phishing-demo` o `malware-demo` figuran como amenaza conocida. RDAP y la inspección de conexión son reales salvo que se deshabiliten con `SITE_CHECK_RDAP=false` y `SITE_CHECK_CONNECTION=false`.
- `/v1/transcribe` con `STT_PROVIDER=mock`: devuelve siempre `{ "text": "Quiero renovar mi documento" }` para cualquier WAV válido (con silencio devuelve `""`). Las validaciones del WAV y los errores son los reales.

### Probar /v1/site-check a mano

```bash
pnpm dev   # con apps/api/.env copiado de .env.example
TOKEN=dev-token-solo-para-desarrollo-local
# Fase de dirección en un sitio oficial → status pending, identity verified_official
curl -s localhost:3000/v1/site-check -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"navigationId":"nav-1","contentVersion":0,"url":"https://www.argentina.gob.ar/","hostname":"www.argentina.gob.ar","registrableDomain":"argentina.gob.ar"}'
# Fase de contenido en un dominio parecido → risk high, LOOKALIKE_DOMAIN
curl -s localhost:3000/v1/site-check -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"navigationId":"nav-2","contentVersion":1,"url":"https://anses-gob-ar.com/","hostname":"anses-gob-ar.com","registrableDomain":"anses-gob-ar.com","page":{"text":"Su beneficio será suspendido. Ingrese su CBU.","forms":[{"method":"post","action":null,"fields":[{"type":"text","label":"CBU"}]}],"links":[],"scriptHosts":[],"iframeHosts":[]}}'
# Amenaza simulada → KNOWN_PHISHING
curl -s localhost:3000/v1/site-check -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"navigationId":"nav-3","contentVersion":0,"url":"https://phishing-demo.example.com/","hostname":"phishing-demo.example.com","registrableDomain":"example.com"}'
```

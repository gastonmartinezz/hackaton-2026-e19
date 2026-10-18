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
- **Límites:** cuerpo de hasta 512 KB, HTML de hasta 200.000 caracteres y 60 solicitudes por minuto por token. `/v1/site-check` (120 por minuto por token), `/v1/transcribe` y `/v1/speak` tienen los suyos (ver abajo).

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Saber si el servidor está vivo y si la voz está activa. Sin token |
| POST | `/v1/interpret` | Chat de la home: interpreta lo que pide la persona |
| POST | `/v1/options` | Opciones de la página actual, cada una con su guía |
| POST | `/v1/next-step` | Informa el avance de la guía y devuelve los pasos que siguen, hasta terminar la opción |
| POST | `/v1/site-check` | Protección de sitios: revisa la dirección y el contenido de la página actual |
| POST | `/v1/transcribe` | Voz a texto: el texto se usa después en `/v1/interpret` |
| POST | `/v1/speak` | Texto a voz: MP3 en streaming para leer en voz alta |

## La sesión: un solo recorrido de punta a punta

La sesión **empieza en `/v1/interpret`** y acompaña todo el recorrido hasta el último `/v1/next-step`. El backend devuelve el `sessionId` en **todas** las respuestas y el front lo manda en cada llamada siguiente.

En la sesión, el backend acumula:

- **De `interpret`:** el chat y la decisión de Claude (objetivo entendido y motivo). La decisión **no vuelve al front**.
- **De `options`:** el metadato de la página y las opciones devueltas.
- **De `next-step`:** el paso a paso investigado de cada opción elegida, los pasos que completó la persona y los pasos nuevos.

En cada llamada, Claude recibe **todo** ese recorrido como contexto. El HTML no se guarda.

```
interpret (sin sessionId) → crea s-abc
interpret (s-abc)         → mismo chat, hasta redirect u options
options   (s-abc)         → opciones con sus pasos
next-step (s-abc)         → investiga el paso a paso (1.ª vez por opción), pasos reales
next-step (s-abc)         → … hasta done (con evidence si la página lo confirma)
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
    { "role": "user", "content": "Quiero renovar la cédula" },
    { "role": "assistant", "content": "¿Es la primera vez que la sacás o la tenés que renovar?" },
    { "role": "user", "content": "Renovarla, se me vence el mes que viene" }
  ]
}
```

Opcionalmente, el front manda en `user` datos de la persona para que Claude priorice sitios de **su localidad** (por ejemplo, el departamento o la ciudad donde vive). Todos los campos son opcionales y se envían en cada llamada:

```json
{
  "messages": [{ "role": "user", "content": "Quiero pagar la contribución inmobiliaria" }],
  "user": {
    "location": { "country": "UY", "region": "Canelones", "city": "Las Piedras" },
    "ageRange": "65-74",
    "language": "es-UY",
    "timeZone": "America/Montevideo"
  }
}
```

- `location.country`: código ISO 3166-1 alfa-2. `region` (departamento, provincia o estado) y `city` (ciudad o localidad, nunca la dirección): hasta 80 caracteres.
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

- **Toda URL está verificada:** el backend comprueba que exista antes de devolverla (ver abajo). Siempre es `https`.
- El backend comprueba que la página exista, no que sea la correcta: eso sigue siendo decisión de Claude.

#### Verificación de URLs

Claude puede recordar mal una dirección (por ejemplo, devolver `https://www.bps.gub.uy/agendarse`, que da 404, o `https://agenda.bps.gub.uy`, un dominio que no existe). Por eso ninguna URL de `redirect` ni de `options` llega al front sin comprobar (S03):

1. **Reglas, en cada salto de redirección:**
   - Solo `https:`: `http:` queda bloqueado hasta que la UI muestre una razón visible.
   - Sin credenciales en la URL y sin puertos fuera del estándar.
   - Sin IPs literales ni nombres locales (`localhost`, `.local`, sin dominio).
   - Sin nombres que resuelvan a redes privadas, loopback, link-local o reservadas. La IP se vuelve a comprobar al conectarse, contra DNS rebinding.
2. **Pedido:** `HEAD` y, si el sitio no lo acepta, `GET` sin leer el cuerpo. Sigue hasta 3 redirecciones con un timeout de 5 s (`URL_CHECK_*`) y se identifica con un `User-Agent` honesto (`Mostrame-LinkCheck/1.0`). Es válida si la respuesta final es 2xx.
3. **Si una URL falla:** un reintento con Claude, al que se le dice qué URL falló y por qué, sin datos de la persona. Si el reintento también falla:
   - Se usa la raíz del dominio, si existe.
   - Si no existe, se saca esa URL.
   - En `options`, si queda un solo sitio, la respuesta pasa a `redirect`. Si no queda ninguno, pasa a `question` con «¿No está lo que buscás? Contame qué querés hacer.».
4. **Caché:** los resultados se recuerdan 10 minutos; los negativos, menos.
5. **Logs:** solo números, motivos y dominios. Nunca la URL completa con su ruta o parámetros.

Para el front no cambia el contrato. Puede llegar `question` donde antes llegaba una URL inventada, y la latencia de `/v1/interpret` sube lo que tarde la comprobación (en general, menos de 1 s) o un reintento cuando Claude se equivoca.

**Búsqueda web (opcional, `INTERPRET_WEB_SEARCH=on`):** Claude elige entre resultados reales de la búsqueda web de Anthropic en lugar de recordar URLs. El verificador sigue activo igual. Está apagada por defecto: ver el benchmark en `docs/railway.md`.

### POST /v1/options

El front envía el `sessionId` de `interpret`, los fragmentos de HTML que considera importantes y, opcionalmente, el **metadato** de la página. Claude devuelve las opciones disponibles, **cada una con su guía completa** (`steps`), teniendo en cuenta todo el recorrido.

Cada paso tiene un `element`:

- **`"#el-3"`**: el id de un elemento del HTML enviado. El front lo ubica y dibuja la indicación (cuadrado, flecha, etc.).
- **`null`**: **paso teórico**. El elemento todavía no existe porque aparece después de una acción de la persona. Los pasos siguientes a uno teórico también lo son.

Los `steps` de cada opción son el comienzo de la tarea en esta página. Al elegir una, el front llama a `/v1/next-step`, que investiga el paso a paso completo y guía hasta terminar.

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
- **`request`** (opcional, hasta 1000 caracteres) es lo que la persona pidió con sus palabras, escrito en «¿No está lo que buscás?» o dicho al responder las opciones con la voz, cuando no estaba entre las opciones. En ese caso:
  - El backend primero investiga cómo se hace eso en este sitio, con la tarea `procedure` y búsqueda web (`GUIDE_WEB_SEARCH`). Tarda entre 10 y 20 s más.
  - Si se puede hacer, devuelve esa tarea como **primera opción**, con el camino desde esta página (el menú, la sección o el buscador que lleva ahí), y su id en **`requestedOptionId`**.
  - El paso a paso queda guardado solo para esa opción, así que `/v1/next-step` no lo vuelve a buscar.
  - Si ninguna opción hace lo pedido, `requestedOptionId` no viene y las opciones son las de la página.
  - El front empieza la guía sola solo con `requestedOptionId`. Sin él, muestra las opciones y avisa que no encontró cómo hacerlo.
  - Una investigación en curso con la misma sesión y el mismo pedido u opción no se repite. Si falla, se guía sin ella y no se vuelve a buscar durante 10 minutos.

### POST /v1/next-step

Lleva a la persona hasta **completar** la opción que eligió, no solo hasta el botón de la opción. El front lo llama para informar el avance y pedir lo que sigue:

- **Al elegir la opción**, con `expectedStep` = el primer paso de la opción y `completedSteps: []`.
- **Al llegar a un paso teórico** (`element: null`), después de que la persona hizo la acción anterior.
- **Al terminar los pasos recibidos**, aunque la página no haya cambiado.
- **Después de un cambio de página**, porque los `#el-N` de los pasos anteriores ya no sirven.

Se sigue llamando hasta que devuelve `done: true`.

```json
{
  "sessionId": "s-abc",
  "optionId": "turno",
  "expectedStep": { "element": null, "instruction": "Elegí la especialidad.", "presentation": "highlight", "waitFor": "userInteraction" },
  "completedSteps": [
    { "element": "#el-3", "instruction": "Hacé clic en «Turnos».", "presentation": "highlight", "waitFor": "userInteraction" }
  ],
  "html": "<form id=\"el-8\"><input id=\"el-9\" type=\"email\" aria-label=\"Correo electrónico\" required>...</form>",
  "metadata": { "page": { "title": "Hospital X - Datos" } }
}
```

Respuesta:

```json
{
  "sessionId": "s-abc",
  "steps": [
    {
      "element": "#el-9",
      "instruction": "Escribí tu correo en «Correo electrónico».",
      "presentation": "scrollAndHighlight",
      "waitFor": "userConfirmation",
      "field": { "question": "¿Cuál es tu correo electrónico?", "sensitive": false }
    },
    { "element": "#el-12", "instruction": "Hacé clic en «Continuar».", "presentation": "highlight", "waitFor": "navigation" }
  ],
  "done": false
}
```

Al terminar:

```json
{ "sessionId": "s-abc", "steps": [], "done": true, "evidence": "Su reserva fue confirmada" }
```

- **Paso a paso investigado:** la primera llamada de cada opción elegida corre antes la tarea interna `procedure`. Claude entiende qué es la opción y, con `GUIDE_WEB_SEARCH=on` (el valor por defecto), busca en la web el paso a paso real, priorizando el sitio oficial y las fuentes uruguayas. El resultado se guarda en la sesión: tiene qué es la tarea, sus etapas, cómo confirma el sitio que terminó y las fuentes. `nextStep` lo usa en cada llamada para saber en qué etapa está la persona y qué falta. No vuelve al front.
  - **Latencia:** esa primera llamada suma una llamada a Claude con búsqueda web, que puede tardar 10 a 20 s más. Las siguientes no la repiten. Si `/v1/options` vuelve a devolver la misma opción (otra página), se investiga de nuevo.
  - Con `GUIDE_WEB_SEARCH=off`, el paso a paso se arma con lo que Claude ya sabe, sin buscar.
  - Si la investigación falla por un motivo pasajero o del modelo (`AI_UNAVAILABLE`, `TIMEOUT`, `RATE_LIMITED`, `AI_INVALID_RESPONSE`, `AI_REFUSED`), se guía igual sin ella y se vuelve a intentar en la llamada siguiente.
- **`field`** (opcional) aparece solo en los pasos que piden un dato de un formulario. `element` apunta a ese lugar. No aparece en pasos teóricos.
  - **`question`:** la pregunta para decir en voz alta («¿Cuál es tu correo electrónico?»).
  - **`sensitive: false`:** la persona puede dictar el dato. El front lo escribe en el campo y le pide que lo revise.
  - **`sensitive: true`:** contraseña o clave, PIN, códigos de verificación, tarjeta, datos bancarios, cédula o documento. El front no pregunta el valor: pone el cursor en el lugar y la persona lo escribe. En este caso `question` dice que lo escribe la persona.
  - El backend nunca recibe el valor. Los pasos de datos vuelven en `completedSteps` igual que los demás, con su `field` y sin valor. El front puede tratar además como sensible cualquier campo que localmente lo parezca (`type=password`, `autocomplete=cc-*`, etc.).
- **`evidence`** (opcional, solo con `done: true`) es el texto de la página que prueba que la tarea terminó, citado tal cual. El backend la descarta si no aparece en el texto visible del `html` recibido (sin distinguir mayúsculas y con espacios normalizados). Sin `evidence`, el front pregunta «¿Pudiste terminar?» en vez de decir «Listo». Elegir la opción o tocar su botón nunca cuenta como terminar.
- **`completedSteps`** (obligatorio, puede ser `[]`): los pasos que completó la persona desde la última llamada. Quedan guardados en la sesión.
- **`metadata`** es opcional y se acumula igual que en `/v1/options`.
- **`steps`** son los pasos que siguen en esta página, con el mismo formato. Si vuelve a aparecer un paso teórico, se llama otra vez a `/v1/next-step`.
- **`done: true`** significa que la tarea terminó; en ese caso `steps` viene vacío.
- **`optionId`** tiene que ser el id de una opción que `/v1/options` devolvió en esa sesión. Si no, responde `400 BAD_REQUEST`.
- **HTML:** conviene marcar los datos obligatorios con `required` o `aria-required="true"` en los controles; Claude los usa para no saltear ninguno.

### Valores y vencimiento de la sesión

| Campo | Valores |
|---|---|
| `presentation` | `highlight`, `scrollAndHighlight` |
| `waitFor` | `userInteraction`, `navigation`, `userConfirmation` |
| `field` | `{ question, sensitive }` solo en pasos de datos de un formulario |

- Las sesiones viven en memoria del servidor y vencen a los **30 minutos sin uso**; cada llamada renueva el plazo. Un reinicio del servidor las borra.
- Un `sessionId` inexistente, vencido o creado con otro token devuelve `404 SESSION_NOT_FOUND`. En ese caso el recorrido anterior se perdió: el front empieza una sesión nueva llamando sin `sessionId`.

### POST /v1/transcribe

Convierte lo que la persona dice en texto. El front manda el texto después a `/v1/interpret` como un mensaje más, igual que si lo hubiera escrito. `/v1/interpret` no cambia.

Quién transcribe lo decide el servidor con `STT_PROVIDER`, sin cambios para el front:

- **`openai`** (recomendado en Railway): la API de transcripción de OpenAI (`OPENAI_STT_MODEL`, por defecto `gpt-transcribe`). El servidor manda el WAV tal cual, en español. No corre ningún modelo en el servidor.
- **`local`**: Whisper (`onnx-community/whisper-small`) en la CPU del servidor. Necesita ~1,1 GB de RAM y 2 vCPU.
- **`mock`** (desarrollo) y **`off`** (apagado, el valor por defecto).

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
{ "text": "Quiero renovar la cédula de identidad" }
```

- `text` viene recortado y con hasta 1000 caracteres.
- **`""` no es un error**: significa que no se entendió nada (silencio, ruido o frases que Whisper inventa con silencio, como «Subtítulos realizados por la comunidad de Amara.org»). El front le pide a la persona que repita o que escriba.

**Errores** (solo códigos que ya existían):

| Caso | Código | HTTP | `retryable` |
|---|---|---|---|
| No es WAV, otro formato (estéreo, 44,1 kHz, 8 bits, float), truncado o menos de 0,3 s | `BAD_REQUEST` | 400 | no |
| Más de 30 s o más de `TRANSCRIBE_MAX_BYTES` + `TRANSCRIBE_HEADER_HEADROOM_BYTES` | `PAYLOAD_TOO_LARGE` | 413 | no |
| Voz a texto apagada en este servidor (`STT_PROVIDER=off`) | `AI_UNAVAILABLE` | 503 | **no**: ocultar el micrófono |
| El modelo local se está cargando o se reinició, la cola está llena, u OpenAI está caído o saturado | `AI_UNAVAILABLE` | 503 | sí |
| La transcripción tardó más que `STT_TIMEOUT_MS` (30 s por defecto) u OpenAI no respondió a tiempo | `TIMEOUT` | 504 | sí |
| Más de 20 solicitudes por minuto por token | `RATE_LIMITED` | 429 | sí |

- **Privacidad:** nuestro servidor no guarda ni registra el audio ni el texto, tampoco en errores: los logs tienen solo la duración del audio, la latencia y el resultado. Con `STT_PROVIDER=openai`, el audio viaja a OpenAI para transcribirse y queda sujeto a sus condiciones de tratamiento y retención (revisarlas antes de producción, como pide S05).
- **Estado:** `GET /health` responde siempre 200 y agrega `stt` (`off`, `loading`, `ready` o `failed`) y `tts` (`off` o `ready`). Sirve para decidir si mostrar el micrófono y el botón de escuchar, no para reintentar en bucle.

```json
{ "status": "ok", "stt": "ready", "tts": "ready" }
```

**Latencia de referencia de Whisper local** (whisper-small q8 en CPU): ~1 a 2 s para una frase corta y ~4 s para 23 s de audio con 2 vCPU. En el primer arranque el modelo tarda unos segundos en estar listo.

#### Vocabulario para OpenAI (`OPENAI_STT_PROMPT` y `OPENAI_STT_KEYWORDS`)

Los dos están **vacíos por defecto**: el servidor no trae una lista fija. `gpt-transcribe` acepta `keywords` (palabras o frases que guían la transcripción) y `prompt` (contexto libre); los modelos `gpt-4o-*-transcribe` solo usan `prompt`.

Valor propuesto, armado solo con nombres y siglas tal como aparecen en gub.uy (consultado el 17/10/2026):

```sh
OPENAI_STT_KEYWORDS=gub.uy,cédula de identidad,Dirección Nacional de Identificación Civil,Ministerio del Interior,DGI,Dirección General Impositiva,BPS,Banco de Previsión Social,BROU,Banco República,BSE,BHU,ANV,UTE,Antel,OSE,Ancap,ASSE,ANEP,INAU
OPENAI_STT_PROMPT=Pedidos de personas en Uruguay sobre trámites y servicios en gub.uy.
```

| Término | Fuente |
|---|---|
| BPS, BROU (Banco República), BSE, BHU, UTE, Ancap, ANEP | Entes autónomos en [gub.uy/otros-organismos](https://www.gub.uy/otros-organismos) |
| Antel, OSE, ASSE, INAU, ANV | Servicios descentralizados en la misma página |
| DGI, Dirección General Impositiva | [gub.uy/direccion-general-impositiva](https://www.gub.uy/direccion-general-impositiva) |
| cédula de identidad, Dirección Nacional de Identificación Civil, Ministerio del Interior | Trámite y organismo en [gub.uy/tramites/cedula-identidad](https://www.gub.uy/tramites/cedula-identidad) |

- No incluye intendencias, ministerios ni el correo: no se verificaron sus nombres de uso en gub.uy (el correo figura solo como «ANC: Administrador Nacional de Correos»). Agregarlos solo desde esa fuente.
- El `prompt` es una frase de contexto, no una lista; los nombres van en `keywords`.
- Medir antes de fijarlo: transcribir los mismos WAV con y sin estas variables y comparar.

**Whisper en local:** con `STT_PROVIDER=local` en `apps/api/.env`, el primer arranque descarga el modelo (~250 MB) a `apps/api/.models` y después lo reutiliza. Para bajarlo antes: `pnpm --filter @hackaton/api build && pnpm --filter @hackaton/api stt:prefetch`. Para integrar el front alcanza con `STT_PROVIDER=mock`.

### POST /v1/speak

Texto a voz: devuelve un **MP3 en streaming** para leer en voz alta una instrucción o un mensaje. Contrato en `packages/contracts/src/speak.ts` (`SPEAK_CONTENT_TYPE`, `SPEAK_MAX_CHARS` y `SpeakRequest`).

**Solicitud:** JSON con el Bearer de siempre.

```bash
curl -X POST "$API/v1/speak" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Tocá «Iniciar trámite» para renovar la cédula."}' --output voz.mp3
```

- `text`: de 1 a 600 caracteres (`SPEAK_MAX_CHARS`) después de quitar espacios al principio y al final. Sin otros campos: la voz y el tono los fija el servidor.

**Respuesta 200:** cuerpo binario `Content-Type: audio/mpeg` y `Cache-Control: no-store`. Llega por partes: el cliente puede empezar a reproducir antes de que termine (por ejemplo, con `MediaSource` o un `<audio>` que apunte a la respuesta).

- El servidor espera el primer pedazo de audio antes de responder: si el proveedor falla antes, la respuesta es un `ApiError` normal. Si se corta **después** de empezar (muy raro), la conexión se cierra antes de tiempo; el cliente lo trata como un error reintentable.
- Si la persona cierra o cambia de pantalla, cortar la descarga: el servidor corta también la generación.

**Errores** (solo códigos que ya existían):

| Caso | Código | HTTP | `retryable` |
|---|---|---|---|
| `text` vacío, de más de 600 caracteres o con campos de más | `BAD_REQUEST` | 400 | no |
| Texto a voz apagado en este servidor (`TTS_PROVIDER=off`, el valor por defecto) | `AI_UNAVAILABLE` | 503 | **no**: ocultar el botón de escuchar |
| OpenAI caído, saturado o sin audio | `AI_UNAVAILABLE` | 503 | sí |
| OpenAI no empezó a responder a tiempo (`OPENAI_TIMEOUT_MS`, 30 s) | `TIMEOUT` | 504 | sí |
| Más de 30 solicitudes por minuto por token (`TTS_RATE_LIMIT_MAX`) | `RATE_LIMITED` | 429 | sí |

- **Voz:** `gpt-4o-mini-tts` (`OPENAI_TTS_MODEL`) con la voz `marin` (`OPENAI_TTS_VOICE`, una de las dos que OpenAI recomienda por calidad) y estas instrucciones fijas en el servidor: «Hablá en español rioplatense, con voseo, pausado, claro y cálido, como alguien que acompaña sin apuro.»
- **Privacidad:** nuestro servidor no guarda ni registra el texto ni el audio; los logs tienen solo la cantidad de caracteres, el tiempo al primer byte, la latencia total, los bytes y el resultado. El texto viaja a OpenAI para generar la voz. No mandar datos que la persona escribió en formularios.

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
  "url": "https://www.bps.gub.uy/historia-laboral",
  "hostname": "www.bps.gub.uy",
  "registrableDomain": "bps.gub.uy",
  "page": {
    "title": "Historia laboral",
    "text": "Texto visible acotado y redactado…",
    "declaredBrand": "BPS",
    "forms": [{ "method": "post", "action": null, "fields": [{ "type": "password", "label": "Contraseña de BPS" }] }],
    "links": [{ "text": "Servicios en línea", "href": "https://scp.bps.gub.uy/" }]
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
    "organization": "Estado uruguayo",
    "source": { "name": "nic.uy: gub.uy solo se registra a través de AGESIC", "url": "https://nic.uy/", "reviewedAt": "2026-10-17T00:00:00.000Z" }
  },
  "risk": "no_signals",
  "reasons": [],
  "coverage": { "identity": "complete", "content": "complete", "registration": "unavailable", "connection": "complete" },
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
  "identity": { "status": "unknown", "impersonatedOrganization": "Banco República (BROU)" },
  "risk": "high",
  "reasons": [
    { "code": "LOOKALIKE_DOMAIN", "category": "fraud",
      "evidence": [{ "source": "Fuentes de autoridad", "checkedAt": "…", "observedBy": "service", "detail": "brou-seguro.com combina brou con una palabra de acceso o seguridad" }] }
  ],
  "coverage": { "identity": "complete", "content": "pending", "registration": "complete", "connection": "complete" },
  "checkedAt": "…",
  "expiresAt": "…"
}
```

- **`identity.status: "verified_official"`** sale **solo** de una fuente de autoridad (ver «Fuentes de oficialidad»), siempre con `basis` y `source`. La coincidencia es por límites de dominio: `gub.uy` cubre `www.bps.gub.uy`, pero no `bps.gub.uy.evil.com` ni `bps-gub-uy.com`. Ni la IA, ni HTTPS, ni la apariencia del sitio pueden otorgarla.
- **`identity.impersonatedOrganization`** aparece cuando hay un motivo de imitación (dominio parecido, subdominio engañoso, caracteres confusos, marca declarada o enlace) que nombra a una organización de las fuentes de autoridad (el Estado, una institución del registro del BCU o una entrada del catálogo de Uruguay).
- **`evidence[].observedBy`**: `user_browser` (lo vio el navegador de la persona) o `service` (fuentes de autoridad, RDAP, inspección de conexión del backend, IA). Lo que ve el backend puede diferir de lo que ve la persona (sesión, ubicación).
- **`explanation`** es complementaria y la genera la IA. No controla etiquetas ni acciones; el front usa sus propios textos revisados.

### Fuentes de oficialidad

«Sitio oficial» (`identity.status: "verified_official"`) solo sale de **una autoridad que pueda probarlo**. Cada respuesta oficial trae `identity.basis` y `identity.source` (`name`, `url`, `reviewedAt`), que el front muestra en «Ver por qué».

| `basis` | Fuente | Cómo se obtiene | `source` |
|---|---|---|---|
| `government_domain` | Zonas de dominio reservadas al Estado uruguayo: `gub.uy` → «Estado uruguayo» y `mil.uy` → «Fuerzas Armadas de Uruguay» (de `zones` del catálogo de Uruguay). No se reconocen zonas de otros países (`.gov`, `.mil`) | Regla de zona por límites de dominio. No se generaliza a otras terminaciones (`edu.uy`, por ejemplo, **no** está reservada al Estado) | Política de la zona: [nic.uy](https://nic.uy/) (AGESIC es el único registrador de `gub.uy` y `mil.uy`), con la fecha de revisión |
| `financial_regulator` | Registro de instituciones del Banco Central del Uruguay (BCU): bancos, financieras, administradoras de crédito, cooperativas, casas de cambio, AFAP, aseguradoras y entidades del Sistema de Pagos | Descarga automática del regulador (ver abajo). Autoriza el dominio registrable del sitio web publicado para cada institución y sus subdominios | «Registro de instituciones del BCU», URL de la ficha o de la página del Sistema de Pagos y fecha de descarga |
| `official_catalog` | Catálogo de Uruguay `data/official-sites.uy.json` (153 entradas revisadas el 17/10/2026), con fuente y fecha **por entrada** | Archivo versionado validado con Zod al arrancar: si es inválido o repite un dominio, el servidor no arranca. Alcance `exact` o `subdomains` | `source` y `reviewedAt` de la entrada |

**Orden y convivencia.** Primero el registro del BCU (si la copia está vigente), después el catálogo y por último las zonas. Si un dominio está en el BCU y en el catálogo, `basis` es `financial_regulator` y `organization` es el nombre corto del catálogo («Banco República (BROU)»). El catálogo cubre lo que no está en el BCU (Antel, UTE, OSE, mutualistas, organismos fuera de `gub.uy`) y los dominios que el BCU no publica (`brou.com.uy`, `bhu.com.uy`). Un dominio que el catálogo revisó y **descartó** con motivo (no responde, redirige a otro, sin verificar) no lo aprueba el BCU aunque lo publique.

**Por qué no hay listas escritas a mano sin fuente.** Una lista de ejemplo no es verificable ni se mantiene sola, y lo que falta en ella termina marcado como «parecido». Las zonas de gobierno y el registro del BCU tienen una autoridad detrás; el catálogo de Uruguay se acepta solo con fuente y fecha por entrada.

**Por qué la IA no aprueba.** En el informe de Netcraft (2025), el 34 % de los dominios de inicio de sesión que un LLM dio para marcas conocidas no pertenecían a la marca. La IA solo **identifica** qué organización dice ser la página (`declaredOrganization`, tipo y país) y si pide credenciales, pagos o códigos. Esa organización se busca en las fuentes de autoridad: si la página dice ser un organismo del Estado uruguayo (BPS, DGI, DNIC, una intendencia…), una institución del BCU o una organización del catálogo, y el dominio no le pertenece, el motivo es `BRAND_IMPERSONATION` con `impersonatedOrganization`, y el riesgo es alto si además pide datos sensibles.

**Organismos del Estado uruguayo (`claims` en `data/government-claims.json`).** Algunos nombres alcanzan solos: BPS / Banco de Previsión Social, DGI / Dirección General Impositiva, DNIC / Identificación Civil, Migración, las 19 intendencias, SUCIVE, ID Uruguay / Usuario gub.uy, Agesic, BCU, URSEC, INAU, Corte Electoral, Catastro, Agencia Nacional de Vivienda y Fondo Nacional de Recursos, entre otros. Los nombres genéricos o siglas ambiguas (MSP, Ministerio del Interior, Registro Civil, MTSS, MEF, MIDES, Poder Judicial, Policía Nacional…) cuentan solo si el texto nombra a Uruguay («Uruguay», «uruguayo», «Montevideo», «República Oriental») o si la IA identifica un organismo de gobierno uruguayo. La IA nunca emite `verified_official` ni baja el riesgo. Con `AI_PROVIDER=mock` o `SITE_CHECK_AI=false`, las mismas reglas corren sobre `declaredBrand` del front.

**Señales que no alcanzan para «oficial»** (no se implementan como oficialidad): Wikidata P856 (sitio web oficial), rankings de popularidad, certificados OV/EV, BIMI y antigüedad del dominio. Como mucho podrían sumar contexto.

**Riesgos de la regla de zona.** Si nic.uy cambia quién puede registrar en `gub.uy` o `mil.uy`, hay que revisar el catálogo. Además, un sitio de gobierno comprometido sigue siendo «oficial»: por eso **el riesgo gana siempre** (una amenaza en `.gub.uy` muestra «Posible estafa»).

#### Registro de instituciones del BCU

El BCU no publica una API documentada con los sitios web de las instituciones. Se arman desde su portal (`bcu-registry.ts`):

- **Superintendencia de Servicios Financieros (SSF):** 12 listas HTML en `https://www.bcu.gub.uy/Servicios-Financieros-SSF/Paginas/<lista>.aspx` (bancos, financieras, administradoras de crédito, cooperativas, casas de cambio, AFAP, aseguradoras…). De cada lista salen los números de institución, y de cada ficha `InformacionInstitucion.aspx?nroinst=N` se leen la razón social, el estado, el nombre de fantasía y el sitio web.
- **Sistema de Pagos:** un POST a `BCUListasHandler.ashx` (lista «Datos Generales», vista «Publicar») devuelve un JSON con 49 entidades (billeteras, cobranzas, procesadores). El sitio web sale de un segundo POST por entidad.
- **Prueba real del 18/10/2026:** 239 pedidos, unos 50 MB y unos 70 s. Quedan **161 instituciones con sitio web** y 16 se descartan (sin sitio utilizable o no activas).
- **Protección del BCU y del servidor:** 2 pedidos en paralelo, tope de 400 pedidos por descarga, `SITE_CHECK_BCU_TIMEOUT_MS` (15 s) por pedido, 4 MB máximo por respuesta y validación con Zod de lo que se lee.
- **Refresco:** al arrancar y cada 24 h, con una revisión por hora. Si falla, la espera entre intentos se duplica (5 min, 10, 20… hasta 6 h).
- **Si el refresco falla:**
  - Hasta 48 h desde la última descarga buena, la copia sigue **vigente**.
  - Hasta 7 días, la copia queda **vieja**: detecta imitaciones, pero **nunca aprueba**, y `coverage.identity` es `partial`.
  - Después, o sin ninguna copia, el registro queda `unavailable`.
- **Durante el arranque** (unos 70 s), o con `SITE_CHECK_BCU_REGISTRY=false`, lo que no está en las zonas ni en el catálogo queda «No pudimos verificarlo».
- **Certificado del BCU:** `www.bcu.gub.uy` envía solo el certificado final (emitido por Abitab), sin los intermedios, y Node no puede verificarlo. Los dos intermedios están en `data/bcu-intermediates.pem`, descargados de las URL AIA del certificado (`repository.certum.pl`, vencen el 02/05/2027 y el 09/06/2027), y se suman a las autoridades de Node **solo para ese host**. Nunca se desactiva la verificación. Si el BCU cambia de cadena, la descarga falla y el registro queda `unavailable`, nunca aprueba.
- Un cambio de formato del portal hace fallar la validación con Zod: el resultado es identidad `unavailable`, nunca una aprobación.

#### Dominios parecidos (sin lista manual)

Las referencias salen, en este orden de peso, de:

1. Dominios del registro del BCU (también de una copia vieja).
2. Dominios del catálogo de Uruguay, incluidos los descartados.
3. Zonas de gobierno.

Las heurísticas siguen el estilo de las advertencias de dominios parecidos de Chrome:

- Mismo esqueleto visual (UTS #39: letras de otro alfabeto, `0`/`o`, `rn`/`m`) → `CONFUSABLE_CHARACTERS` si hay caracteres no ASCII; si no, `LOOKALIKE_DOMAIN`.
- Una edición de distancia, solo con nombres de 7 o más letras.
- El dominio de referencia embebido en otro: `brou.com.uy.verificacion.net` → `MISLEADING_SUBDOMAIN`.
- Marca + palabra clave: `brou-seguro.com`, `antel-uy.com`, `itau-login.com`.
- La marca como subdominio de otro dominio: `brou.secure-login.com`.
- Zonas de gobierno imitadas: `bps-gub-uy.com`, `gub-uy.com`, `bps.gub.uy.evil.com`, o `.gub.uy` falso con homoglifos.

«banco» no cuenta como palabra clave. La misma marca con otra terminación (`bancorepublica.com` frente a `bancorepublica.com.uy`) no se marca: muchas marcas tienen sitios legítimos en otras terminaciones (`santander.com`).

**Nombres que son palabras comunes (`data/common-words.json`).** Varias instituciones del BCU y del catálogo se llaman como palabras de uso diario (Correo, Verde, Pronto, Delta, Visa, Disco, Provincia, Universidad, Cabal…). Con todas las reglas, sitios inocentes como `correo.miempresa.com.uy`, `consorcios.com.uy` o `pronto.algunblog.com` daban «Posible estafa». La lista es una **heurística**, no una fuente de autoridad. Para esos nombres:

- **Siguen aplicando** las reglas que no dan falsas alarmas: el dominio de referencia completo metido en otro (`correo.com.uy.evil.com`, `correo-com-uy.net`) y el mismo esqueleto visual (`c0rreo.com.uy`, letras cirílicas).
- **No aplican:** el nombre como subdominio, una letra de diferencia y nombre + palabra clave.
- **En el texto de la página:** un alias del catálogo que es una palabra común solo cuenta con una palabra financiera («Tarjeta Verde») o con la pista de la IA. «Correo Uruguayo» completo sigue contando.
- **Criterio para sumar una palabra:** es de uso diario y un sitio sin relación podría usarla como nombre, sección o subdominio. Los nombres propios (santander) y las palabras que en un dominio casi siempre son la marca (claro, oca) quedan afuera. Un test verifica que las marcas distintivas (brou, itau, antel, prexcard, ute, ose, bse, abitab, redpagos, mercadopago…) no estén en la lista.

**Siglas de organismos (`acronyms` en `government-claims.json`).** BPS, DGI y BCU cuentan solas cuando son todo el nombre declarado o una parte separada por guion, barra o dos puntos («BPS», «BPS - Mi cuenta»). Dentro de un nombre más largo necesitan que el texto nombre a Uruguay o la pista de la IA: «BPS Logistics» o «DGI Consultores» no se toman como el organismo.

### Cómo se calcula

| Campo | Regla |
|---|---|
| `risk: "high"` | Imitación del dominio (`LOOKALIKE_DOMAIN`, `CONFUSABLE_CHARACTERS`, `MISLEADING_SUBDOMAIN`) o dos señales moderadas distintas |
| `risk: "medium"` | Una señal moderada (`BRAND_IMPERSONATION`, `SENSITIVE_DATA_REQUEST`, `FORM_SENDS_TO_OTHER_DOMAIN`, `LINK_TEXT_MISMATCH`, `URGENCY_OR_THREAT`, `RECENTLY_REGISTERED`), un formulario con datos sensibles por `http`, o un motivo concreto agregado por la IA |
| `risk: "no_signals"` | Sin motivos de fraude y con identidad (y contenido, en la fase de contenido) completas |
| `risk: "unknown"` | Sin motivos, pero alguna verificación obligatoria no se pudo hacer |
| `status: "pending"` | Fase de dirección (`coverage.content: "pending"`) |
| `status: "complete"` | Fase de contenido con identidad y contenido `complete` o `not_applicable` |
| `status: "partial"` | Fase de contenido con identidad o contenido `unavailable` o `partial` (registro del BCU caído o viejo, falla de la IA) |
| `status: "unavailable"` | Dirección local, privada o interna |

- El riesgo tiene prioridad sobre la identidad oficial: una página `.gub.uy` o del BCU comprometida (por ejemplo, con un formulario de clave que envía a otro dominio y un texto de amenaza) devuelve `identity: verified_official` **y** `risk: high` → el indicador muestra «Posible estafa».
- Los motivos `technical` (`NO_HTTPS`, `CERTIFICATE_PROBLEM`, `CROSS_DOMAIN_REDIRECT`) nunca suben el riesgo por sí solos. `INSECURE_FORM_ACTION` solo aparece con datos sensibles y da, como mucho, riesgo medio.
- Antigüedad y HTTPS **nunca** generan un resultado favorable por sí solos: lo favorable solo surge de no encontrar motivos con las verificaciones obligatorias completas.
- No se consultan listas de reportes de phishing o malware (Google Safe Browsing, Web Risk u otras): la detección sale de las fuentes de Uruguay, las reglas propias y la IA.
- Una contraseña sola no es un pedido sensible (cualquier sitio con usuarios la pide). Cuenta como `SENSITIVE_DATA_REQUEST` cuando el sitio, sin identidad oficial, ya muestra otra señal de fraude (por ejemplo, dice ser el BPS). Tarjeta, cuenta bancaria, claves de BPS o DGI y códigos de verificación cuentan siempre en sitios sin identidad oficial.
- La IA solo identifica la organización declarada y los pedidos (credenciales, pagos, códigos), con salida validada por Zod. Lo que identifica se contrasta con las fuentes de autoridad y puede sumar `BRAND_IMPERSONATION` o `SENSITIVE_DATA_REQUEST` (fuente «Análisis con IA»). Nunca baja el riesgo ni cambia `identity`. Si la IA falla o tarda más de `SITE_CHECK_AI_TIMEOUT_MS`, `coverage.content` queda `partial` (nunca favorable) y la respuesta sale sin `explanation`.

### Cobertura mínima acordada con el front

La regla está en `siteIndicatorState()` del contrato y la usan front y tests del backend:

| Estado del indicador | Condición |
|---|---|
| Posible estafa | `risk: high` (siempre primero, aunque sea oficial o parcial) |
| Atención | `risk: medium` |
| Revisando sitio… | `status: pending` |
| Sitio oficial | `identity.status: verified_official` (zona, BCU o catálogo), `coverage.identity: complete`, contenido `complete`/`not_applicable`, ningún motivo `fraud` y `status` distinto de `unavailable` |
| No pudimos verificarlo | Sin identidad oficial: `status` distinto de `complete`, `risk` distinto de `no_signals`, algún motivo `fraud`, o identidad o contenido sin `complete`/`not_applicable` |
| Sin alertas detectadas | Sin identidad oficial, con todo lo anterior completo |

`registration` (RDAP) y `connection` (TLS/redirecciones) **no son obligatorias**: su ausencia nunca aprueba ni reprueba; se informan para transparencia y vencen pronto (`expiresAt`) para reintentar.

### Códigos de motivo

| Código | Categoría | Fuente | Qué significa |
|---|---|---|---|
| `LOOKALIKE_DOMAIN` | fraud | Fuentes de autoridad | Dominio parecido a uno del BCU, del catálogo o a una zona de gobierno: letras sustituidas, una edición, marca + palabra clave |
| `CONFUSABLE_CHARACTERS` | fraud | Fuentes de autoridad | Caracteres de otro alfabeto (punycode/IDN) que imitan un dominio de referencia o una zona de gobierno, o mezcla de alfabetos |
| `MISLEADING_SUBDOMAIN` | fraud | Fuentes de autoridad | Una zona de gobierno, un dominio de referencia o una marca aparece en los subdominios de otro dominio (`bps.gub.uy.evil.com`) |
| `BRAND_IMPERSONATION` | fraud | Contenido / IA | El sitio dice ser un organismo del Estado uruguayo, una institución del BCU o una organización del catálogo y el dominio no le pertenece |
| `SENSITIVE_DATA_REQUEST` | fraud | Contenido / IA | Pide tarjeta, cuenta bancaria, claves de BPS o DGI, pagos o códigos en un sitio sin identidad oficial (o contraseña junto a otra señal) |
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
| RDAP | hash del dominio registrable | 24 h (bootstrap de IANA: 24 h) |
| Conexión | hash de la URL depurada | 1 h |
| Registro del BCU | en memoria, una copia | refresco cada 24 h; vigente 48 h; vieja (no aprueba) hasta 7 días |
| Zonas, catálogos y contenido | sin caché de resultados (se evalúan en cada solicitud). Los índices y nombres normalizados de las fuentes se arman una vez por copia del registro del BCU | 10 min |

- `expiresAt` = la vigencia más corta de las fuentes usadas. Con alguna cobertura `unavailable`/`partial`, y en la fase de dirección, es de **60 segundos**.
- Las fallas no se guardan en caché: «Intentar de nuevo» vuelve a consultar.
- Consultas simultáneas a la misma URL comparten una sola llamada al proveedor.
- Tiempos máximos: `SITE_CHECK_PROVIDER_TIMEOUT_MS` (RDAP y espera al registro del BCU, 4 s), `SITE_CHECK_CONNECTION_TIMEOUT_MS` (todas las redirecciones, 5 s) y `SITE_CHECK_AI_TIMEOUT_MS` (8 s). Las fuentes corren en paralelo.
- Tope por proveedor: `SITE_CHECK_PROVIDER_MAX_PER_MINUTE` (120). Al superarlo, esa cobertura queda `unavailable`.
- Logs: solo fase, estado, riesgo, códigos, coberturas y latencia. Nunca URLs, dominios, contenido de página ni claves.

### Proveedores y configuración

| Variable | Valores | Uso |
|---|---|---|
| `SITE_CHECK_RDAP` | `true`/`false` | Consulta RDAP |
| `SITE_CHECK_BCU_REGISTRY` | `true`/`false` | Registro de instituciones del BCU. Con `false`, las instituciones financieras solo pueden ser «Sitio oficial» por el catálogo, y lo que no está en zonas ni en el catálogo queda sin verificar |
| `SITE_CHECK_BCU_TIMEOUT_MS` | número | Tiempo máximo por pedido al BCU (15 s) |
| `SITE_CHECK_CONNECTION` | `true`/`false` | Inspección de TLS y redirecciones |
| `SITE_CHECK_AI` | `true`/`false` | Identificación de la organización declarada y explicación (usa `AI_PROVIDER`) |
| `SITE_CHECK_RATE_LIMIT_MAX` | número | Solicitudes por ventana y token en `/v1/site-check` |
| `SITE_CHECK_PROVIDER_TIMEOUT_MS`, `SITE_CHECK_CONNECTION_TIMEOUT_MS`, `SITE_CHECK_AI_TIMEOUT_MS`, `SITE_CHECK_PROVIDER_MAX_PER_MINUTE` | número | Tiempos máximos y topes |

Ninguna fuente de Protección de sitios necesita claves. No se usa ningún proveedor de reputación (Google Safe Browsing, Web Risk, VirusTotal, urlscan.io): ninguna URL de la persona se envía a listas de reportes ni a escaneos de terceros.

| Fuente | Licencia y costo | Privacidad | Cobertura |
|---|---|---|---|
| RDAP vía bootstrap IANA | Público y gratuito; cada registro fija sus límites | Solo se envía el dominio registrable | Depende del TLD. **`.uy` no publica RDAP** (no figura en el bootstrap de IANA): para dominios uruguayos `registration` siempre queda `unavailable`, sin que eso cambie el indicador |
| Inspección de conexión propia | Sin costo | El backend se conecta al sitio (sin cookies ni credenciales, solo encabezados, sin query) | TLS de cada salto, hasta 5 redirecciones |

### Limitaciones

- No promete detectar todas las amenazas. Sin listas de reportes, un sitio de phishing que no imita a una organización conocida ni muestra señales en su contenido (por ejemplo, una descarga de malware) puede quedar como «Sin alertas detectadas».
- «Oficial» cubre solo lo que una autoridad respalda: organismos en zonas de gobierno, instituciones del registro del BCU y entradas del catálogo de Uruguay. Empresas legítimas fuera de esas fuentes (comercios, servicios que no están en el catálogo) se muestran como «Sin alertas detectadas», nunca como oficiales.
- El registro del BCU se arma leyendo su portal, que no es una API documentada. Si deja de responder o cambia de formato, las instituciones financieras dejan de verse como oficiales por esa vía (nunca se aprueba en falso). Una institución que use otros dominios además del publicado solo es oficial en esos otros dominios si están en el catálogo.
- Si el BCU publica un dominio que vence y otro lo registra, sigue saliendo oficial hasta que el BCU actualice la ficha (salvo que el catálogo lo haya descartado). `.uy` no tiene RDAP para notar el cambio de titular.
- Si el BCU no publica un nombre de fantasía y la institución no está en el catálogo, `organization` puede venir en mayúsculas («CAMBIO FAGALDE»).
- La detección de dominios parecidos puede dar falsos positivos (un dominio legítimo con un nombre parecido a una institución, por ejemplo con `claro`) y falsos negativos. Por la lista de palabras comunes, desde la dirección sola **ya no se detectan** `correo-uy.com`, `visa-login.com`, `cabal-online.com` ni `correo.secure-login.com`. Se pueden detectar por el contenido si la página nombra a la organización completa («Correo Uruguayo») o con la pista de la IA.
- Las reglas de contenido trabajan sobre el resumen que extrae el navegador: no ven el código de la página ni cambios posteriores, ni contenido dentro de iframes de otro origen.
- La inspección de conexión ve lo que ve el servidor, que puede diferir de lo que ve la persona (sesión, geolocalización, cloaking).
- Las cachés y los topes son en memoria, por proceso: se pierden al reiniciar y no se comparten entre réplicas.

## Qué queda del lado del front

1. **Sesión:** guardar el `sessionId` que devuelve la primera llamada a `/v1/interpret` y mandarlo en **todas** las llamadas siguientes (`interpret`, `options` y `next-step`). Si llega `SESSION_NOT_FOUND`, empezar una sesión nueva.
2. **Chat:** guardar el historial y enviarlo completo en cada `/v1/interpret`. Según `type`: redirigir, mostrar la pregunta o mostrar las opciones de sitios.
3. **Fragmentos de HTML:** armar el HTML que se envía, con un id por elemento y sin datos sensibles.
4. **Metadato:** enviar en `metadata.page` los datos de la página que tenga (título, idioma) al cargarla.
5. **Guía:** al elegir una opción, llamar a `/v1/next-step` y recorrer los `steps` que devuelve. Volver a llamar ante un paso con `element: null`, al terminar los pasos o después de un cambio de página, con el HTML nuevo y los `completedSteps`, hasta `done: true`. En los pasos con `field`, preguntar el dato en voz alta (o, si es sensible, poner el cursor en el lugar). Decir «Listo» solo con `evidence`.
6. **Elementos:** ubicar `element` en la página (si hace falta, subiendo al elemento padre) y manejar el caso en que no se encuentra. El backend no verifica que el id exista en el HTML.
7. **Representación visual:** dibujar la indicación según `presentation`, mostrar `instruction` y esperar según `waitFor`.
8. **Voz:** grabar en WAV PCM 16 bits mono a 16 kHz, mandar a `/v1/transcribe` y usar el `text` como el mensaje de la persona en `/v1/interpret`. Con `text: ""`, pedir que repita. Con `AI_UNAVAILABLE` no reintentable, ocultar el micrófono. Para leer en voz alta, pedir `/v1/speak` y reproducir el MP3 a medida que llega; con `AI_UNAVAILABLE` no reintentable, ocultar el botón de escuchar.
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
- `/v1/next-step`: el paso a paso investigado es fijo y sin búsqueda. Si el HTML tiene un lugar para escribir que todavía no se completó (`<input>` de texto o `<textarea>`), devuelve un paso de datos con `field` (`sensitive: true` si es `type="password"`). Si no, devuelve un clic sobre el primer `id="..."` pendiente. Sin ids pendientes devuelve `steps: []` y `done: true`, con el primer título del HTML como `evidence` si lo hay.
- `/v1/site-check`: la explicación es un texto fijo según el riesgo y la IA nunca agrega motivos. El registro del BCU, RDAP y la inspección de conexión son reales salvo que se deshabiliten con `SITE_CHECK_BCU_REGISTRY=false`, `SITE_CHECK_RDAP=false` y `SITE_CHECK_CONNECTION=false`.
- `/v1/transcribe` con `STT_PROVIDER=mock`: devuelve siempre `{ "text": "Quiero renovar la cédula de identidad" }` para cualquier WAV válido (con silencio devuelve `""`). Las validaciones del WAV y los errores son los reales.
- `/v1/speak` con `TTS_PROVIDER=mock`: devuelve siempre el mismo MP3 válido de ~0,5 s de silencio, en dos partes. Las validaciones y los errores son los reales.

### Probar /v1/site-check a mano

```bash
pnpm dev   # con apps/api/.env copiado de .env.example
TOKEN=dev-token-solo-para-desarrollo-local
# Fase de dirección en un sitio oficial → status pending, identity verified_official (Estado uruguayo)
curl -s localhost:3000/v1/site-check -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"navigationId":"nav-1","contentVersion":0,"url":"https://www.bps.gub.uy/","hostname":"www.bps.gub.uy","registrableDomain":"bps.gub.uy"}'
# Página que dice ser el BPS en otro dominio y pide la clave → risk high, BRAND_IMPERSONATION
curl -s localhost:3000/v1/site-check -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"navigationId":"nav-2","contentVersion":1,"url":"https://tramites-online.com.uy/","hostname":"tramites-online.com.uy","registrableDomain":"tramites-online.com.uy","page":{"title":"BPS","declaredBrand":"BPS","text":"Su prestación será suspendida. Ingrese su contraseña.","forms":[{"method":"post","action":null,"fields":[{"type":"password","label":"Contraseña"}]}],"links":[]}}'
# Dominio parecido al de un banco del BCU → risk high, LOOKALIKE_DOMAIN, ya en la fase de dirección
curl -s localhost:3000/v1/site-check -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"navigationId":"nav-3","contentVersion":0,"url":"https://itau-login.com/","hostname":"itau-login.com","registrableDomain":"itau-login.com"}'
```

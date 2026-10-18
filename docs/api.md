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
- **Límites:** cuerpo de hasta 512 KB, HTML de hasta 200.000 caracteres y 60 solicitudes por minuto por token. `/v1/transcribe` y `/v1/speak` tienen los suyos (ver abajo).

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Saber si el servidor está vivo y si la voz está activa. Sin token |
| POST | `/v1/interpret` | Chat de la home: interpreta lo que pide la persona |
| POST | `/v1/options` | Opciones de la página actual, cada una con su guía |
| POST | `/v1/next-step` | Pasos reales cuando la guía llega a un paso teórico |
| POST | `/v1/transcribe` | Voz a texto: el texto se usa después en `/v1/interpret` |
| POST | `/v1/speak` | Texto a voz: MP3 en streaming para leer en voz alta |

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

## Qué queda del lado del front

1. **Sesión:** guardar el `sessionId` que devuelve la primera llamada a `/v1/interpret` y mandarlo en **todas** las llamadas siguientes (`interpret`, `options` y `next-step`). Si llega `SESSION_NOT_FOUND`, empezar una sesión nueva.
2. **Chat:** guardar el historial y enviarlo completo en cada `/v1/interpret`. Según `type`: redirigir, mostrar la pregunta o mostrar las opciones de sitios.
3. **Fragmentos de HTML:** armar el HTML que se envía, con un id por elemento y sin datos sensibles.
4. **Metadato:** enviar en `metadata.page` los datos de la página que tenga (título, idioma) al cargarla.
5. **Guía:** recorrer los `steps` de la opción elegida. Ante un paso con `element: null`, esperar la acción de la persona y llamar a `/v1/next-step` con el HTML nuevo y los `completedSteps`.
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
- `/v1/next-step`: si el HTML tiene un `id="..."`, devuelve un paso sobre ese elemento con `done: false`. Si no tiene ninguno, devuelve `steps: []` y `done: true`.
- `/v1/transcribe` con `STT_PROVIDER=mock`: devuelve siempre `{ "text": "Quiero renovar la cédula de identidad" }` para cualquier WAV válido (con silencio devuelve `""`). Las validaciones del WAV y los errores son los reales.
- `/v1/speak` con `TTS_PROVIDER=mock`: devuelve siempre el mismo MP3 válido de ~0,5 s de silencio, en dos partes. Las validaciones y los errores son los reales.

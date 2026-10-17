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
- **Límites:** cuerpo de hasta 512 KB, HTML de hasta 200.000 caracteres y 60 solicitudes por minuto por token. `/v1/transcribe` tiene los suyos (ver abajo).

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Saber si el servidor está vivo y el estado del modelo de voz. Sin token |
| POST | `/v1/interpret` | Chat de la home: interpreta lo que pide la persona |
| POST | `/v1/options` | Opciones de la página actual, cada una con su guía |
| POST | `/v1/next-step` | Pasos reales cuando la guía llega a un paso teórico |
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
- Entre **0,3 s y 30 s** (`TRANSCRIBE_MAX_SECONDS`), o sea hasta `TRANSCRIBE_MAX_BYTES` = 960 044 bytes.
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
| Más de 30 s o más de `TRANSCRIBE_MAX_BYTES` | `PAYLOAD_TOO_LARGE` | 413 | no |
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
- `/v1/transcribe` con `STT_PROVIDER=mock`: devuelve siempre `{ "text": "Quiero renovar mi documento" }` para cualquier WAV válido (con silencio devuelve `""`). Las validaciones del WAV y los errores son los reales.

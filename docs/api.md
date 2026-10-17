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
- **Límites:** cuerpo de hasta 512 KB, HTML de hasta 200.000 caracteres y 60 solicitudes por minuto por token.

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Saber si el servidor está vivo. Sin token |
| POST | `/v1/interpret` | Chat de la home: interpreta lo que pide la persona |
| POST | `/v1/options` | Opciones de la página actual y próximo paso de la guía |

### POST /v1/interpret

El objetivo es siempre **llegar a una URL**:

- Si Claude llega a una sola URL, responde `redirect`.
- Si hay más de una posible, responde `options`.
- Si todavía no puede llegar a una URL, responde `question`. El front muestra la pregunta, agrega la respuesta de la persona al historial y vuelve a llamar. Esto se repite hasta obtener un `redirect` u `options`.

El front envía **todo el historial** del chat en cada llamada, para que Claude no pierda el contexto. El último mensaje tiene que ser de la persona (`user`).

```json
{
  "messages": [
    { "role": "user", "content": "Quiero renovar mi documento" },
    { "role": "assistant", "content": "¿En qué país querés hacer el trámite?" },
    { "role": "user", "content": "Argentina" }
  ]
}
```

La respuesta tiene siempre `type` y `message`:

```json
// Claude resolvió el sitio: el front lleva directo a la URL
{ "type": "redirect", "message": "Te llevo al sitio de turnos.", "url": "https://..." }

// Falta información: el front muestra la pregunta en el chat
{ "type": "question", "message": "¿En qué país querés hacer el trámite?" }

// Varios sitios posibles (2 a 5): el front muestra las opciones para elegir
{ "type": "options", "message": "Encontré estas opciones:",
  "options": [ { "title": "...", "url": "https://...", "reason": "..." } ] }
```

- Las URLs siempre son `http` o `https`. Si Claude devuelve otra cosa, el servidor responde con el error `AI_INVALID_RESPONSE`.
- Las URLs las propone Claude: el backend no comprueba que el sitio exista ni que sea el correcto.

### POST /v1/options

El front envía los fragmentos de HTML que considera importantes. Claude devuelve las opciones y el próximo paso, usando **selectores CSS** sobre ese HTML.

Primera llamada en una página (sin `sessionId`): el backend crea la sesión.

```json
{ "html": "<form><input id=\"search\" placeholder=\"Buscar\">...</form>" }
```

Respuesta:

```json
{
  "sessionId": "s-abc",
  "options": [
    { "id": "search", "title": "Buscar un producto", "initialElement": "#search" }
  ],
  "guide": {
    "goal": "search",
    "step": {
      "element": "#search",
      "presentation": "highlight",
      "instruction": "Escribí acá el producto que estás buscando.",
      "waitFor": "userInteraction"
    }
  }
}
```

Siguientes llamadas: el front manda el mismo `sessionId`, la opción elegida (`goal`) y los fragmentos nuevos. Responde con la misma estructura.

```json
{ "sessionId": "s-abc", "goal": "search", "html": "<...fragmentos nuevos...>" }
```

| Campo | Valores |
|---|---|
| `presentation` | `highlight`, `scrollAndHighlight` |
| `waitFor` | `userInteraction`, `navigation`, `userConfirmation` |
| `guide` | `null` si Claude no encuentra un paso posible en el HTML recibido |

**Sesiones:**
- Viven en memoria del servidor y vencen a los **30 minutos sin uso**. Un reinicio del servidor las borra.
- Guardan las opciones y los pasos anteriores, **no el HTML**. Claude los recibe en cada llamada para seguir la tarea.
- Un `sessionId` inexistente, vencido o creado con otro token devuelve `404 SESSION_NOT_FOUND`. El front vuelve a llamar sin `sessionId` para empezar una sesión nueva.

## Qué queda del lado del front

1. **Chat:** guardar el historial y enviarlo completo en cada `/v1/interpret`. Según `type`: redirigir, mostrar la pregunta o mostrar las opciones de sitios.
2. **Fragmentos de HTML:** elegir con sus reglas qué HTML enviar a `/v1/options` y volver a enviar fragmentos nuevos cuando la página cambia.
3. **Sesión:** guardar el `sessionId` que devuelve la primera llamada, mandarlo en las siguientes junto con el `goal` elegido, y empezar de nuevo si llega `SESSION_NOT_FOUND`.
4. **Selectores:** ubicar el elemento con `document.querySelector(element)` y manejar los casos en que el selector no encuentra nada o encuentra varios elementos. Claude genera los selectores y el backend no los verifica contra el HTML.
5. **Representación visual:** resaltar según `presentation`, mostrar `instruction` y esperar según `waitFor` antes de pedir el próximo paso.
6. **Errores:** mostrar un mensaje según `code` y reintentar solo si `retryable` es `true`.

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
- `/v1/options`: usa el primer `id="..."` del HTML como selector (`#id`). Si no hay ninguno, devuelve `options: []` y `guide: null`.

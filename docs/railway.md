# Despliegue de la API en Railway

Responsable: Agustin. Railway Hobby (pago) está aprobado. El despliegue en Tenki (`deploy/tenki/`) sigue igual, pero su política de secretos solo permite `api.anthropic.com`: en Tenki la voz por OpenAI no funcionaría.

## Arquitectura

- **Claude** interpreta lo que pide la persona y guía la página (`/v1/interpret`, `/v1/options` y `/v1/next-step`).
- **OpenAI** pasa la voz a texto (`/v1/transcribe` con `STT_PROVIDER=openai`) y el texto a voz (`/v1/speak` con `TTS_PROVIDER=openai`).
- **En el servidor no corre ningún modelo.** La API es un proceso Node chico: ~60 MB de RAM en reposo dentro del contenedor.

Whisper local (`STT_PROVIDER=local`) sigue disponible como opción para un servidor con 2 vCPU y 2 GB (ver al final).

## Qué hay en el repositorio

| Archivo | Para qué |
|---|---|
| `railway.json` | Build con `apps/api/Dockerfile`, healthcheck en `/health`, reinicio ante fallos (hasta 5 veces) y redespliegue solo si cambian la API, los contratos o las dependencias |
| `apps/api/Dockerfile` | Imagen multi-stage sobre `node:22-bookworm-slim`: instala solo `@hackaton/api` y sus dependencias del workspace, compila y deja las dependencias de producción. **Por defecto no trae el modelo de Whisper** (`WHISPER_IN_IMAGE=false`) |
| `.dockerignore` | Deja afuera `node_modules`, `dist`, `.env`, diseño, documentación y el cliente de escritorio |

El contexto del build es la **raíz del monorepo** (lo que Railway usa por defecto). Para probar la imagen en local:

```bash
docker build -f apps/api/Dockerfile -t mostrame-api .
docker run --rm -p 3000:3000 \
  -e AI_PROVIDER=anthropic -e ANTHROPIC_API_KEY=... -e API_ACCESS_TOKENS=... \
  -e OPENAI_API_KEY=... -e STT_PROVIDER=openai -e TTS_PROVIDER=openai mostrame-api
```

No es alpine: si algún día se usa Whisper local, los binarios de `onnxruntime-node` necesitan glibc.

## Pasos para crear el servicio

1. Nuevo proyecto en Railway → **Deploy from GitHub repo** → este repositorio, rama `main`. Railway detecta `railway.json`. Dejar un solo servicio para la API (Railway puede proponer uno por paquete del monorepo).
2. Cargar las variables de abajo en **Variables** del servicio.
3. En **Settings → Networking**, generar el dominio público. Railway enruta al `PORT` que inyecta; la API escucha en `HOST=::` (IPv4 e IPv6), que también sirve para la red privada de Railway.
4. Verificar: `curl https://<dominio>/health` → `{"status":"ok","stt":"ready","tts":"ready"}`.

## Variables

| Variable | Valor en Railway | Notas |
|---|---|---|
| `NODE_ENV` | `production` | Ya viene en la imagen. Desactiva `/docs` y prohíbe los mocks |
| `PORT` | *(no cargar)* | La inyecta Railway |
| `HOST` | *(no cargar)* | `::` por defecto en la imagen |
| `API_ACCESS_TOKENS` | tokens separados por coma | Mínimo 24 caracteres cada uno. Generar con `openssl rand -base64 32`. **Secreto** |
| `AI_PROVIDER` | `anthropic` | |
| `ANTHROPIC_API_KEY` | clave de Anthropic | **Secreto** |
| `OPENAI_API_KEY` | clave de OpenAI | **Secreto**. Obligatoria con `STT_PROVIDER=openai` o `TTS_PROVIDER=openai` |
| `STT_PROVIDER` | `openai` | Voz a texto. Con `off` (valor por defecto) `/v1/transcribe` responde 503 no reintentable |
| `TTS_PROVIDER` | `openai` | Texto a voz. Con `off` (valor por defecto) `/v1/speak` responde 503 no reintentable |
| `CLAUDE_*` por tarea | ver [Latencia de Claude](#latencia-de-claude) | Opcionales. Sin ellas se usa `CLAUDE_MODEL=claude-opus-5-5` con `CLAUDE_EFFORT=medium` en todo |
| `OPENAI_STT_KEYWORDS`, `OPENAI_STT_PROMPT` | *(opcionales)* | Vacías por defecto. Valor propuesto y fuentes en [api.md](api.md#vocabulario-para-openai-openai_stt_prompt-y-openai_stt_keywords) |
| `OPENAI_STT_MODEL` | *(opcional)* `gpt-transcribe` | |
| `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` | *(opcionales)* `gpt-4o-mini-tts`, `marin` | |
| `OPENAI_TIMEOUT_MS`, `OPENAI_MAX_RETRIES` | *(opcionales)* `30000`, `1` | El timeout cuenta hasta que OpenAI empieza a responder |
| `STT_RATE_LIMIT_MAX`, `TTS_RATE_LIMIT_MAX` | *(opcionales)* `20`, `30` | Por token y por `RATE_LIMIT_WINDOW_MS` |
| `STT_CONCURRENCY`, `STT_QUEUE_MAX` | *(opcionales)* | Con `openai`, 8 transcripciones en paralelo y 4 en espera |
| `CLAUDE_FALLBACKS` | *(opcional)* `default` | Si el clasificador de seguridad de Claude rechaza un pedido, la API reintenta en el modelo que Anthropic recomienda (no aplica a Haiku 5.5). `off` lo apaga |
| `LOG_LEVEL` | `info` | Opcional |

## Recursos recomendados

Sin modelos en el servidor alcanza con lo mínimo:

- **Memoria:** 56 MiB en uso dentro del contenedor (probado con `--memory 512m --cpus 1`). **512 MB** dejan margen de sobra.
- **CPU:** **1 vCPU** (o menos). El trabajo pesado lo hacen Claude y OpenAI; el servidor solo valida y reenvía.
- **Imagen:** 628 MB sin el modelo de Whisper (contra ~1 GB con el modelo); no descarga nada al arrancar.
- **Réplicas:** las sesiones viven en memoria, así que la API tiene que correr con **una sola réplica** (o con sesiones pegajosas) hasta que se muevan a un almacenamiento compartido.

## Latencia de Claude

Cada llamada a Claude deja en el log, solo con números, la tarea, el modelo, el effort, la latencia, los tokens y los tokens leídos de la caché. El system prompt de cada tarea se cachea: en el benchmark, ~1200 de ~1330 tokens de entrada de `interpret` salen de la caché.

**Valores recomendados** (cargarlos en Railway; en el código siguen por defecto Opus 5.5 con effort medium):

```sh
CLAUDE_MODEL_INTERPRET=claude-sonnet-5-5
CLAUDE_EFFORT_INTERPRET=low
CLAUDE_MODEL_NEXT_STEP=claude-sonnet-5-5
CLAUDE_EFFORT_NEXT_STEP=low
# options sin medir todavía: queda en Opus 5.5 medium (CLAUDE_MODEL / CLAUDE_EFFORT).
```

Benchmark del 17/10/2026 con `pnpm --filter @hackaton/api bench:claude` (3 repeticiones por caso, llamadas en serie desde una máquina de desarrollo, con los prompts y esquemas de producción).

- **Casos de `interpret`** (12 llamadas por variante):
  - «Quiero renovar la cédula de identidad»
  - «Necesito pagar la factura de la luz de UTE»
  - «Quiero ver mi historia laboral en el BPS»
  - «Quiero sacar un turno», un caso ambiguo en el que lo correcto es preguntar.
- **Casos de `nextStep`** (6 llamadas por variante): la agenda de la cédula con su formulario y la pantalla de «Agenda confirmada».

| Tarea | Variante | p50 | p95 | USD por llamada | Correctas |
|---|---|---|---|---|---|
| interpret | Opus 5.5 medium (actual) | 3,8 s | 7,2 s | 0,0068 | 12/12 |
| interpret | Opus 5.5 low | 3,3 s | 3,7 s | 0,0045 | 12/12 |
| interpret | **Sonnet 5.5 low** | **2,3 s** | **2,9 s** | 0,0024 | 12/12 |
| interpret | Haiku 5.5 (medium, su default) | 1,9 s | 9,3 s | 0,0002 | 12/12 |
| nextStep | Opus 5.5 medium (actual) | 2,1 s | 4,4 s | 0,0055 | 6/6 |
| nextStep | Opus 5.5 low | 2,1 s | 3,0 s | 0,0047 | 6/6 |
| nextStep | **Sonnet 5.5 low** | **1,6 s** | **2,8 s** | 0,0028 | 6/6 |

- **Qué se considera correcto:**
  - En `interpret`, los tres casos con organismo claro tienen que ir al dominio esperado (`gub.uy`, `ute.com.uy` o `bps.gub.uy`); todas las variantes respondieron `redirect` directo en los 9 casos. El ambiguo tiene que preguntar u ofrecer opciones.
  - En `nextStep`, los pasos tienen que apuntar a ids del HTML, y `done` tiene que ser `false` en el formulario y `true` en la confirmación.
- **Interpret, por qué Sonnet 5.5 low:** igual de correcto, ~40 % menos de p50 y ~60 % menos de p95 que el valor actual, a un tercio del costo. Una corrida anterior dio números parecidos (Opus medium 4,9 s / 9,5 s; Sonnet low 2,3 s / 2,7 s).
- **Por qué no Haiku 5.5:** es el más rápido en la mediana y el más barato, pero su p95 fue el peor en las dos corridas (5,3 s y 9,3 s). Además no tiene fallback del lado del servidor: un rechazo del clasificador queda en `AI_REFUSED`.
- **Costo:** precios de lista de la tabla de modelos (Opus 5.5: USD 4 / 20 por millón de tokens; Sonnet 5.5: 2 / 10; Haiku 5.5: 0,10 / 0,50) con la caché incluida. La lectura de caché de Haiku se estimó en 0,1 × entrada.
- **Límites del benchmark:** pocos casos y repeticiones, y medido desde una sola red. Antes de fijar valores, mirar las métricas de `claude call` en los logs de Railway con tráfico real.

## Whisper local (opcional)

Para transcribir en el propio servidor en lugar de OpenAI:

1. Construir la imagen con el modelo adentro. En Railway, cargar la variable `WHISPER_IN_IMAGE=true` (Railway pasa las variables del servicio como `ARG` del build). En local: `docker build -f apps/api/Dockerfile --build-arg WHISPER_IN_IMAGE=true -t mostrame-api .`
2. `STT_PROVIDER=local`. Opcionales: `STT_MODEL` (`onnx-community/whisper-small`), `STT_DTYPE` (`q8`), `STT_THREADS`. Si se cambian `STT_MODEL` o `STT_DTYPE`, pasar los mismos valores como build args; si no coinciden, el modelo se descarga al arrancar.
3. Recursos: **2 vCPU y 2 GB**. Medido en Docker (arm64, 2 vCPU y 2 GB): ~1,1 GB de RAM con el modelo cargado, 2 s para 1,5 s de audio y 4,2 s para 23 s de audio. Cada inferencia concurrente extra (`STT_CONCURRENCY`) suma ~0,6 GB.

Sin `WHISPER_IN_IMAGE=true`, `STT_PROVIDER=local` igual funciona, pero baja ~250 MB del modelo en cada arranque del contenedor.

## Privacidad

- Nuestro servidor no guarda ni registra audio, texto transcripto ni texto leído en voz alta. Los logs tienen solo números: duración del audio, caracteres, tiempo al primer byte, latencia, tokens y código de resultado.
- Con OpenAI, el audio (STT) y el texto (TTS) viajan a OpenAI y quedan sujetos a sus condiciones de tratamiento y retención. Revisarlas antes de producción, como pide S05.

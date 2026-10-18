# Despliegue de la API en Railway

Responsable: Agustin. Railway Hobby (pago) está aprobado. El despliegue en Tenki (`deploy/tenki/`) sigue igual, pero su política de secretos solo permite `api.anthropic.com`: en Tenki la voz por OpenAI no funcionaría.

## Arquitectura

- **Claude Opus 5.5** interpreta lo que pide la persona y guía la página (`/v1/interpret`, `/v1/options` y `/v1/next-step`). Cada URL que propone se verifica antes de mostrarla.
- **OpenAI** pasa la voz a texto (`/v1/transcribe` con `STT_PROVIDER=openai`) y el texto a voz (`/v1/speak` con `TTS_PROVIDER=openai`).
- **En el servidor no corre ningún modelo.** La API es un proceso Node chico: ~60 MB de RAM en reposo dentro del contenedor.

## Qué hay en el repositorio

| Archivo | Para qué |
|---|---|
| `railway.json` | Build con `apps/api/Dockerfile`, healthcheck en `/health`, reinicio ante fallos (hasta 5 veces) y redespliegue solo si cambian la API, los contratos o las dependencias |
| `apps/api/Dockerfile` | Imagen multi-stage sobre `node:22-bookworm-slim`: instala solo `@hackaton/api` y sus dependencias del workspace, compila y deja las dependencias de producción |
| `.dockerignore` | Deja afuera `node_modules`, `dist`, `.env`, diseño, documentación y el cliente de escritorio |

El contexto del build es la **raíz del monorepo** (lo que Railway usa por defecto). Para probar la imagen en local:

```bash
docker build -f apps/api/Dockerfile -t mostrame-api .
docker run --rm -p 3000:3000 \
  -e AI_PROVIDER=anthropic -e ANTHROPIC_API_KEY=... -e API_ACCESS_TOKENS=... \
  -e OPENAI_API_KEY=... -e STT_PROVIDER=openai -e TTS_PROVIDER=openai mostrame-api
```

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
| `CLAUDE_EFFORT`, `CLAUDE_EFFORT_*` | *(no cargar)* | Opus 5.5 usa `medium` por defecto, con razonamiento adaptativo. Ver [Claude: modelo, effort y URLs](#claude-modelo-effort-y-urls) |
| `URL_CHECK_*` | *(opcionales)* | Verificación de URLs (siempre activa) |
| `GUIDE_WEB_SEARCH`, `GUIDE_WEB_SEARCH_MAX_USES` | *(opcionales)* `on`, `3` | Búsqueda web del paso a paso al elegir una opción de la guía (ver [api.md](api.md#post-v1next-step)) |
| `OPENAI_STT_KEYWORDS`, `OPENAI_STT_PROMPT` | *(opcionales)* | Vacías por defecto. Valor propuesto y fuentes en [api.md](api.md#vocabulario-para-openai-openai_stt_prompt-y-openai_stt_keywords) |
| `OPENAI_STT_MODEL` | *(opcional)* `gpt-transcribe` | |
| `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` | *(opcionales)* `gpt-4o-mini-tts`, `marin` | |
| `TTS_TIMEOUT_MS` | *(opcional)* `30000` | Tope de cada lectura, incluido el streaming del audio |
| `OPENAI_TIMEOUT_MS`, `OPENAI_MAX_RETRIES` | *(opcionales)* `30000`, `1` | El timeout cuenta hasta que OpenAI empieza a responder |
| `STT_RATE_LIMIT_MAX`, `TTS_RATE_LIMIT_MAX` | *(opcionales)* `20`, `30` | Por token y por `RATE_LIMIT_WINDOW_MS` |
| `STT_CONCURRENCY`, `STT_QUEUE_MAX` | *(opcionales)* `8`, `4` | Transcripciones en paralelo hacia OpenAI y cuántas esperan; con la cola llena, 503 reintentable |
| `CLAUDE_FALLBACKS` | *(opcional)* `default` | Si el clasificador de seguridad de Claude rechaza un pedido, la API reintenta en el modelo que Anthropic recomienda (no aplica a Haiku 5.5). `off` lo apaga |
| `LOG_LEVEL` | `info` | Opcional |

## Recursos recomendados

Sin modelos en el servidor alcanza con lo mínimo:

- **Memoria:** 56 MiB en uso dentro del contenedor (probado con `--memory 512m --cpus 1`). **512 MB** dejan margen de sobra.
- **CPU:** **1 vCPU** (o menos). El trabajo pesado lo hacen Claude y OpenAI; el servidor solo valida y reenvía.
- **Imagen:** sin modelos; no descarga nada al arrancar.
- **Réplicas:** las sesiones viven en memoria, así que la API tiene que correr con **una sola réplica** (o con sesiones pegajosas) hasta que se muevan a un almacenamiento compartido.

## Claude: modelo, effort y URLs

**En interpretar la búsqueda y la página no se escatima.** `interpret`, `options` y `nextStep` van con **Claude Opus 5.5** (`claude-opus-5-5`, el valor por defecto de `CLAUDE_MODEL`). No usar Sonnet ni Haiku para estas tareas.

**Por qué no Sonnet 5.5 low** (la recomendación anterior de este documento, retirada): al medir con claves reales, **inventó URLs**.

- `https://www.bps.gub.uy/agendarse` responde 404.
- `https://agenda.bps.gub.uy` es un dominio que no existe.
- En los mismos casos, Opus 5.5 medium devolvió URLs que existen: `https://www.gub.uy/tramites/cedula-identidad`, `https://www.bps.gub.uy` y `https://www.ute.com.uy`.

El benchmark anterior solo miraba el dominio, no si la página existía.

**Valores recomendados:** los valores por defecto del código. No hace falta cargar nada en Railway:

```sh
# CLAUDE_MODEL=claude-opus-5-5   (valor por defecto)
# CLAUDE_EFFORT=medium           (valor por defecto de Opus 5.5; no cargar CLAUDE_EFFORT_*)
```

En Opus 5.5 el razonamiento siempre es adaptativo: el modelo decide en cada pedido cuánto pensar. `effort` solo marca el esfuerzo general, y no hay un valor «automático»: sin configurarlo, Opus 5.5 usa `medium`.

### Verificador de URLs

Además del modelo, **ninguna URL llega a la persona sin comprobar que exista**. El detalle está en [api.md](api.md#verificación-de-urls):

- **Reglas:** solo https; sin IPs privadas, en cada redirección.
- **Si falla:** reintento con Claude; después, la raíz del dominio o una pregunta.

Variables: `URL_CHECK_TIMEOUT_MS` (5000), `URL_CHECK_MAX_REDIRECTS` (3) y `URL_CHECK_CACHE_TTL_MS` (600000). El servidor necesita salida a internet por HTTPS hacia los sitios que propone Claude; Railway la tiene.

### Benchmark (18/10/2026)

Se corrió con `pnpm --filter @hackaton/api bench:claude`, de punta a punta por `InterpretService`: la llamada a Claude, la verificación real de cada URL y los reintentos. Hubo 4 solicitudes en paralelo desde una máquina de desarrollo.

- **Casos uruguayos sin datos personales:** cédula, pasaporte, jubilación en el BPS, factura de UTE, factura de OSE, Antel, contribución inmobiliaria en Montevideo y un caso ambiguo («Quiero sacar un turno»).
- **Correcta:** la URL final existe y es del organismo esperado (`gub.uy`, `bps.gub.uy`, `ute.com.uy`, `ose.com.uy`, `antel.com.uy`, `montevideo.gub.uy`); en el caso ambiguo, una pregunta u opciones.
- **URLs válidas antes:** las que Claude devolvió en el primer intento.
- **URLs válidas después:** las que devolvió la API, comprobadas otra vez con un verificador aparte.

| `interpret` | Solicitudes | p50 | p95 | URLs válidas antes | URLs válidas después | Reintentos | USD por solicitud | Correctas |
|---|---|---|---|---|---|---|---|---|
| **Opus 5.5 medium** (corrida 1) | 16 | 4,5 s | 22,5 s | 94 % (15/16) | 100 % (17/17) | 1 | 0,011 | 16/16 |
| **Opus 5.5 medium** (corrida 2) | 24 | 4,4 s | 9,0 s | 95 % (21/22) | 100 % (22/22) | 1 | 0,0085 | 24/24 |
| Opus 5.5 high (corrida 1) | 16 | 4,9 s | 9,8 s | 100 % (16/16) | 100 % (16/16) | 0 | 0,0092 | 16/16 |
| Opus 5.5 high (corrida 2) | 24 | 4,7 s | 10,1 s | 96 % (22/23) | 96 % (22/23)* | 1 | 0,0098 | 24/24 |
| Opus 5.5 medium + búsqueda web | 16 | 15,2 s | 25,2 s | 100 % (21/21) | 100 % (21/21) | 0 | 0,043 | 16/16 |
| Opus 5.5 high + búsqueda web | 16 | 17,8 s | 27,4 s | 100 % (20/20) | 100 % (20/20) | 0 | 0,046 | 16/16 |

\* La URL había pasado el verificador del servicio y falló en la comprobación de control, hecha segundos después. El dominio es `www.gub.uy`, que a veces tarda más de 3 s en la primera respuesta, así que lo más probable es un timeout puntual del sitio.

| `nextStep` | Solicitudes | p50 | p95 | USD por solicitud | Correctas |
|---|---|---|---|---|---|
| **Opus 5.5 medium** | 6 | 2,2 s | 4,6 s | 0,0075 | 6/6 |
| Opus 5.5 high | 6 | 2,2 s | 4,2 s | 0,0047 | 6/6 |

**Recomendación:**

- **`interpret`: Opus 5.5 medium, sin búsqueda web.** Con el verificador, medium entregó el 100 % de URLs válidas en las dos corridas: con medium, alrededor de 1 de cada 20 URLs necesita un reintento. High acertó un poco más al primer intento (97 % contra 95 %) y tardó unos 0,3 s más en la mediana, sin mejorar el resultado final. Ninguna variante devolvió una URL inventada. Se elige medium para no dar de más recursos: mantener la app más cara no mejora lo que ve la persona.
- **`nextStep`: Opus 5.5 medium.** Las dos variantes acertaron todo, con la misma latencia.
- **Cuándo subir a `high`:** si en producción suben los reintentos o las respuestas convertidas en pregunta (log `interpret urls`), o si `nextStep` empieza a equivocar controles. Se cambia por variable (`CLAUDE_EFFORT_INTERPRET`, `CLAUDE_EFFORT_NEXT_STEP`), sin tocar código.
- **Búsqueda web en `interpret`: se sacó.** Daba todas las URLs válidas desde el primer intento, pero triplicaba la latencia (p50 de 15 a 18 s) y costaba 4 a 5 veces más. Con el verificador y un reintento, sin búsqueda se llega al mismo resultado final en ~4,5 s. La búsqueda web sigue en uso en la tarea `procedure` (`GUIDE_WEB_SEARCH`).
- **Costo:** precio de lista de Opus 5.5 (USD 4 / 20 por millón de tokens, lectura de caché 0,20); en las filas con búsqueda, más USD 0,01 por búsqueda.
- **Límites:** son pocos casos, medidos desde una sola red. Antes de fijar valores, revisar `claude call` e `interpret urls` en los logs de Railway con tráfico real.

## Privacidad

- Nuestro servidor no guarda ni registra audio, texto transcripto ni texto leído en voz alta. Los logs tienen solo números: duración del audio, caracteres, tiempo al primer byte, latencia, tokens y código de resultado.
- Con OpenAI, el audio (STT) y el texto (TTS) viajan a OpenAI y quedan sujetos a sus condiciones de tratamiento y retención. Revisarlas antes de producción, como pide S05.

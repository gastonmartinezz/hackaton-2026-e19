# Despliegue de la API en Railway

Responsable: Agustin. La configuración queda en el repositorio; el servicio en Railway todavía no está creado. El despliegue en Tenki (`deploy/tenki/`) sigue igual.

## Qué hay en el repositorio

| Archivo | Para qué |
|---|---|
| `railway.json` | Build con `apps/api/Dockerfile`, healthcheck en `/health` y reinicio ante fallos (hasta 5 veces) |
| `apps/api/Dockerfile` | Imagen multi-stage sobre `node:22-bookworm-slim`: instala solo `@hackaton/api` y sus dependencias del workspace, compila, deja las dependencias de producción y **descarga el modelo de Whisper en el build** |
| `.dockerignore` | Deja afuera `node_modules`, `dist`, `.env`, diseño, documentación y el cliente de escritorio |

El contexto del build es la **raíz del monorepo** (lo que Railway usa por defecto). Para probar la imagen en local:

```bash
docker build -f apps/api/Dockerfile -t mostrame-api .
docker run --rm -p 3000:3000 \
  -e AI_PROVIDER=anthropic -e ANTHROPIC_API_KEY=... -e API_ACCESS_TOKENS=... \
  -e STT_PROVIDER=local mostrame-api
```

- No es alpine: los binarios de `onnxruntime-node` necesitan glibc.
- El modelo queda en `/models` dentro de la imagen (`STT_MODEL_DIR=/models`), así el contenedor no lo baja en cada arranque. Si se cambia `STT_MODEL` o `STT_DTYPE` en Railway, pasar los mismos valores como build args (Railway expone las variables del servicio como `ARG` en el build); si no coinciden, el modelo se descarga al arrancar.
- La imagen pesa ~1 GB (≈250 MB de modelo q8).

## Pasos para crear el servicio

1. Nuevo proyecto en Railway → **Deploy from GitHub repo** → este repositorio, rama `main`. Railway detecta `railway.json`.
2. Cargar las variables de abajo en **Variables** del servicio.
3. En **Settings → Networking**, generar el dominio público. Railway enruta al `PORT` que inyecta; la API escucha en `HOST=::` (IPv4 e IPv6), que también sirve para la red privada de Railway.
4. Verificar: `curl https://<dominio>/health` → `{"status":"ok","stt":"ready"}` a los pocos segundos de arrancar (`loading` mientras carga el modelo; el healthcheck pasa igual).

## Variables

| Variable | Valor en Railway | Notas |
|---|---|---|
| `NODE_ENV` | `production` | Ya viene en la imagen. Desactiva `/docs` y prohíbe los mocks |
| `PORT` | *(no cargar)* | La inyecta Railway |
| `HOST` | *(no cargar)* | `::` por defecto en la imagen |
| `API_ACCESS_TOKENS` | tokens separados por coma | Mínimo 24 caracteres cada uno. Generar con `openssl rand -base64 32`. **Secreto** |
| `AI_PROVIDER` | `anthropic` | |
| `ANTHROPIC_API_KEY` | clave de Anthropic | **Secreto** |
| `STT_PROVIDER` | `local` | Whisper en el contenedor. Con `off` (valor por defecto) `/v1/transcribe` responde 503 no reintentable |
| `LOG_LEVEL` | `info` | Opcional |
| `CLAUDE_MODEL`, `CLAUDE_EFFORT`, `CLAUDE_TIMEOUT_MS`, `CLAUDE_MAX_RETRIES`, `CLAUDE_MAX_TOKENS` | *(opcionales)* | Mismos valores por defecto que en `.env.example` |
| `STT_MODEL` | *(opcional)* `onnx-community/whisper-small` | Cambiarlo implica un build nuevo con el mismo valor |
| `STT_DTYPE` | *(opcional)* `q8` | Ídem |
| `STT_CONCURRENCY` | *(opcional)* `1` | Inferencias en paralelo. Cada una suma ~0,6 GB de RAM |
| `STT_THREADS` | *(opcional)* `0` | Hilos por inferencia; `0` = vCPU / `STT_CONCURRENCY` |
| `STT_TIMEOUT_MS` | *(opcional)* `30000` | |
| `STT_QUEUE_MAX` | *(opcional)* `4` | Solicitudes en espera; con la cola llena, 503 reintentable |
| `STT_RATE_LIMIT_MAX` | *(opcional)* `20` | Por token y por `RATE_LIMIT_WINDOW_MS` |

## Recursos recomendados

Medido con la imagen en Docker (arm64, 2 vCPU y 2 GB):

- **Memoria:** ~1,1 GB en uso con el modelo cargado y `STT_CONCURRENCY=1`. Reservar **2 GB**; sumar ~0,6 GB por cada inferencia concurrente extra.
- **CPU:** **2 vCPU** como mínimo. Latencias medidas: 2 s para 1,5 s de audio y 4,2 s para 23 s de audio. En las vCPU x86 compartidas de Railway puede ser algo más lento; si se acerca a los 30 s, subir vCPU antes que `STT_TIMEOUT_MS`.
- **Arranque:** el servidor responde enseguida y el modelo queda listo en ~5 s (carga + una inferencia de calentamiento).
- **Réplicas:** las sesiones viven en memoria, así que la API tiene que correr con **una sola réplica** (o con sesiones pegajosas) hasta que se muevan a un almacenamiento compartido.

## Privacidad

Ni el audio ni el texto transcripto se guardan ni se registran. Los logs de `/v1/transcribe` tienen solo la duración del audio, la latencia y el código de resultado.

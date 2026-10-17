# Navegador asistido — backend

Monorepo pnpm. La especificación está en `especificacion-plataforma.md`. La sección 0 define quién es responsable de cada parte.

| Ruta | Contenido | Responsable |
|---|---|---|
| `apps/api` | Servidor Fastify: Claude, validación, sesiones, límites y logs | Agustin |
| `packages/contracts` | Contratos v1 (Zod + JSON Schema) | Compartido front/backend, cambios solo por acuerdo |
| `docs/api.md` | Guía de la API para el front | Agustin |

Endpoints: `GET /health`, `POST /v1/interpret`, `POST /v1/options` y `POST /v1/next-step`. El detalle está en `docs/api.md`.

## Requisitos

- Node 22 (`nvm use`) y pnpm 10 (`npm i -g pnpm@10` o `npx pnpm@10 …`).

## Desarrollo

```sh
cp apps/api/.env.example apps/api/.env
pnpm bootstrap       # install + build de todos los paquetes
pnpm dev:api         # API en http://localhost:3000, documentación en /docs (alias: pnpm dev)
pnpm dev:desktop:api # en otra terminal: Electron contra la API local
pnpm dev:desktop     # Electron con el backend simulado del front, sin API
pnpm test           # todos los paquetes
pnpm typecheck
pnpm contracts:schemas   # regenera packages/contracts/schemas/v1/*.json
```

`dev:desktop:api` toma el puerto y el primer token de `API_ACCESS_TOKENS` de `apps/api/.env`, y los pasa como `ASISTENTE_API_URL` y `ASISTENTE_API_TOKEN`. Si esas variables ya están definidas, se respetan.

En desarrollo, `AI_PROVIDER=mock` permite trabajar sin clave de Anthropic. Para usar Claude, definir `AI_PROVIDER=anthropic` y `ANTHROPIC_API_KEY`. El modelo se elige con `CLAUDE_MODEL` y el esfuerzo con `CLAUDE_EFFORT`.

En desarrollo y tests, el paquete de contratos se resuelve desde `src` mediante la condición `source`, sin build previo. En producción se usa `dist`.

## Despliegue

### Railway (servidor fijo)

La API se despliega en Railway desde GitHub. La configuración está en `railway.json`:

- **Build:** `pnpm --filter '@hackaton/api...' build`.
- **Arranque:** `node apps/api/dist/server.js`.
- **Chequeo de salud:** `/health`.

Solo se redespliega cuando cambian `apps/api`, `packages/contracts` o las dependencias. Los cambios de la app de escritorio no disparan un despliegue.

Preparación en el panel de Railway, una sola vez:

1. Crear el proyecto desde este repositorio y dejar un solo servicio para la API. Railway puede proponer uno por paquete del monorepo.
2. En **Variables** del servicio, cargar:
   - `NODE_ENV=production`
   - `AI_PROVIDER=anthropic`
   - `ANTHROPIC_API_KEY`
   - `API_ACCESS_TOKENS`
   - `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, que evita bajar Electron en el build.

   `PORT` lo define Railway.
3. En **Settings → Networking**, generar el dominio público.

Para usar la app de escritorio contra Railway, definir:

- `ASISTENTE_API_URL`: el dominio de Railway.
- `ASISTENTE_API_TOKEN`: uno de los `API_ACCESS_TOKENS`.

### Tenki Sandbox (alternativa)

Se despliega en Tenki Sandbox (https://tenki.cloud/docs/sandbox) con `deploy/tenki/deploy.sh`.

Preparación, una sola vez:

```sh
tenki login                                   # aceptar con "Allow Secrets access"
tenki secrets create ANTHROPIC_API_KEY        # en una terminal interactiva; pega la clave oculta
cp deploy/tenki/.env.example deploy/tenki/.env.sandbox
# completar API_ACCESS_TOKENS (openssl rand -base64 32); el archivo no se versiona
```

Despliegue y redespliegue (requiere `jq`):

```sh
./deploy/tenki/deploy.sh
```

El script crea lo que falte y es seguro repetirlo:

- La política `anthropic` (`deploy/tenki/anthropic-policy.json`).
- Un sandbox *sticky* `asistente-api`, que corre hasta que se lo termine.
- La URL fija `asistente-api`. Si el sandbox se recrea, se vuelve a asociar sola.

Después sube el último commit (`git archive HEAD`), compila, reinicia la API e imprime la URL. Los cambios sin commit no se suben.

La clave de Anthropic nunca entra al sandbox. El `.env` del sandbox lleva el marcador `secrets://ANTHROPIC_API_KEY` y Tenki lo reemplaza por la clave real fuera de la VM. El reemplazo se hace solo en los `POST` a `api.anthropic.com/v1/` que permite la política.

Para usar la app de escritorio contra el sandbox, definir:

- `ASISTENTE_API_URL`: la URL impresa.
- `ASISTENTE_API_TOKEN`: uno de los `API_ACCESS_TOKENS` de `.env.sandbox`.

El log está en `/home/tenki/api.log` y se ve con `tenki sandbox exec --session asistente-api -c 'tail -50 api.log'`. El proceso no sobrevive a un reinicio del agente de Tenki. Si la URL deja de responder, alcanza con volver a correr el script.

- Los secretos (`ANTHROPIC_API_KEY`, `API_ACCESS_TOKENS`) quedan solo en el servidor. Nunca van en el cliente.
- En producción, el servidor no arranca en modo `mock`.
- Las sesiones (empiezan en `/v1/interpret` y siguen en `/v1/options` y `/v1/next-step`) están en memoria: vencen a los 30 minutos sin uso y se pierden si el servidor se reinicia.

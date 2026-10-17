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

Se despliega en Tenki Sandbox (https://tenki.cloud/docs/sandbox). Las instrucciones están pendientes.

- Los secretos (`ANTHROPIC_API_KEY`, `API_ACCESS_TOKENS`) quedan solo en el servidor. Nunca van en el cliente.
- En producción, el servidor no arranca en modo `mock`.
- Las sesiones (empiezan en `/v1/interpret` y siguen en `/v1/options` y `/v1/next-step`) están en memoria: vencen a los 30 minutos sin uso y se pierden si el servidor se reinicia.

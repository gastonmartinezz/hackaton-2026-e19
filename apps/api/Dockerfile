# API de Mostrame (Fastify). Contexto de build: la raíz del monorepo.
#   docker build -f apps/api/Dockerfile -t mostrame-api .
#
# No corre ningún modelo: Claude y OpenAI (voz) se usan por API.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo

# Solo los manifiestos del workspace: la capa de dependencias se reutiliza mientras no cambien.
FROM base AS manifests
COPY . /src
RUN mkdir /out \
 && cd /src \
 && cp package.json pnpm-lock.yaml pnpm-workspace.yaml /out/ \
 && find apps packages -mindepth 2 -maxdepth 2 -name package.json -exec cp --parents {} /out/ \;

FROM base AS build
# pnpm con la versión exacta de "packageManager".
COPY package.json ./
RUN corepack enable && corepack install
COPY --from=manifests /out/ ./
RUN pnpm install --frozen-lockfile --filter '@hackaton/api...'
COPY . .
RUN pnpm --filter '@hackaton/api...' build \
 && pnpm --filter @hackaton/api deploy --legacy --prod /prod/api

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=:: \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /prod/api ./
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

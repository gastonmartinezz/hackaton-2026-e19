# API de Mostrame (Fastify). Contexto de build: la raíz del monorepo.
#   docker build -f apps/api/Dockerfile -t mostrame-api .
#
# Por defecto la imagen es liviana y no trae el modelo de Whisper: la voz va por OpenAI
# (STT_PROVIDER=openai, TTS_PROVIDER=openai). Para Whisper local (STT_PROVIDER=local),
# construir con el modelo adentro:
#   docker build -f apps/api/Dockerfile --build-arg WHISPER_IN_IMAGE=true -t mostrame-api .
#
# bookworm-slim y no alpine: onnxruntime-node trae binarios enlazados con glibc.

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
# Peso muerto en Linux (~360 MB): binarios de onnxruntime-node para macOS y Windows, y
# onnxruntime-web, que transformers.js ya trae empaquetado y en Node no carga.
RUN rm -rf /prod/api/node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/darwin \
           /prod/api/node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/win32 \
           /prod/api/node_modules/.pnpm/onnxruntime-web@*/node_modules/onnxruntime-web/dist

# Con WHISPER_IN_IMAGE=true baja el modelo en el build (y prueba que carga con las dependencias
# de producción) para no descargarlo en cada arranque. Si se cambia STT_MODEL o STT_DTYPE,
# pasar los mismos valores como build args. Sin el modelo, STT_PROVIDER=local lo baja al arrancar.
ARG WHISPER_IN_IMAGE=false
ARG STT_MODEL=onnx-community/whisper-small
ARG STT_DTYPE=q8
RUN mkdir -p /models \
 && if [ "$WHISPER_IN_IMAGE" = "true" ]; then \
      STT_MODEL="$STT_MODEL" STT_DTYPE="$STT_DTYPE" STT_MODEL_DIR=/models \
      node /prod/api/dist/modules/transcribe/prefetch-model.js; \
    else \
      echo "Imagen sin modelo de Whisper (WHISPER_IN_IMAGE=$WHISPER_IN_IMAGE)"; \
    fi

FROM ${NODE_IMAGE} AS runtime
ARG STT_MODEL=onnx-community/whisper-small
ARG STT_DTYPE=q8
ENV NODE_ENV=production \
    HOST=:: \
    PORT=3000 \
    STT_MODEL=${STT_MODEL} \
    STT_DTYPE=${STT_DTYPE} \
    STT_MODEL_DIR=/models
WORKDIR /app
COPY --from=build --chown=node:node /prod/api ./
COPY --from=build --chown=node:node /models /models
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

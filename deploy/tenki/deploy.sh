#!/usr/bin/env bash
# Despliega apps/api en un sandbox de Tenki. Sirve para el primer despliegue y para los siguientes:
# crea lo que falte (política y sesión), sube el commit actual, compila, reinicia y expone el puerto.
#
# Requisitos: CLI de Tenki logueado, jq, secreto ANTHROPIC_API_KEY en el workspace
# y deploy/tenki/.env.sandbox (copiado de .env.example).
#
# Se sube HEAD con `git archive`: solo archivos versionados, nunca .env locales ni cambios sin commit.
set -euo pipefail

SESSION="${TENKI_SESSION:-asistente-api}"
SLUG="${TENKI_SLUG:-asistente-api}"
POLICY=anthropic
REMOTE_HOME=/home/tenki
PORT=3000

cd "$(git rev-parse --show-toplevel)"
ENV_FILE=deploy/tenki/.env.sandbox

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Falta $ENV_FILE. Copiar deploy/tenki/.env.example y completar API_ACCESS_TOKENS." >&2
  exit 1
fi
if ! grep -qE '^API_ACCESS_TOKENS=.{24,}' "$ENV_FILE"; then
  echo "API_ACCESS_TOKENS vacío o demasiado corto en $ENV_FILE." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Aviso: hay cambios sin commit; se despliega HEAD ($(git rev-parse --short HEAD))." >&2
fi

if ! tenki secrets policies get "$POLICY" >/dev/null 2>&1; then
  echo "Creando la política $POLICY…"
  tenki secrets policies create "$POLICY" --file deploy/tenki/anthropic-policy.json >/dev/null
fi

if ! tenki sandbox get --session "$SESSION" >/dev/null 2>&1; then
  echo "Creando el sandbox $SESSION…"
  # La política se fija al crear la sesión: sin ella, el marcador de la clave no se reemplaza.
  tenki sandbox create --name "$SESSION" --sticky --disk-size-gb 10 --secret-policy "$POLICY" >/dev/null
fi

archive="$(mktemp -t asistente-api).tar.gz"
trap 'rm -f "$archive"' EXIT
git archive --format=tar.gz -o "$archive" HEAD

echo "Subiendo $(git rev-parse --short HEAD)…"
tenki sandbox write --session "$SESSION" --path "$REMOTE_HOME/app.tar.gz" --data-file "$archive" >/dev/null
tenki sandbox write --session "$SESSION" --path "$REMOTE_HOME/api.env" --data-file "$ENV_FILE" >/dev/null

echo "Compilando y reiniciando…"
# Se compila en app.new y solo se reemplaza app si todo salió bien, así un fallo no tira el servidor actual.
tenki sandbox exec --session "$SESSION" --timeout 10m -c "
set -eu
cd $REMOTE_HOME
rm -rf app.new && mkdir app.new
tar -xzf app.tar.gz -C app.new && rm app.tar.gz
install -m 600 api.env app.new/apps/api/.env && rm api.env
cd app.new
pnpm install --frozen-lockfile --filter '@hackaton/api...'
pnpm --filter '@hackaton/api...' build
cd $REMOTE_HOME
if [ -f api.pid ]; then kill \$(cat api.pid) 2>/dev/null || true; sleep 1; fi
rm -rf app && mv app.new app
cd app
nohup node apps/api/dist/server.js >$REMOTE_HOME/api.log 2>&1 </dev/null &
echo \$! >$REMOTE_HOME/api.pid
for i in \$(seq 1 30); do
  curl -sf http://127.0.0.1:$PORT/health >/dev/null && echo 'API en marcha' && exit 0
  sleep 1
done
echo 'La API no respondió; últimas líneas del log:' >&2
tail -30 $REMOTE_HOME/api.log >&2
exit 1
"

# URL con nombre fijo: si la sesión se recrea, se vuelve a asociar y la app no necesita otra URL.
session_id="$(tenki sandbox get --session "$SESSION" --json | jq -r .id)"
preview="$(tenki sandbox preview-url list --json | jq -c --arg slug "$SLUG" '.preview_urls[]? | select(.slug == $slug)')"
if [[ -z "$preview" ]]; then
  tenki sandbox preview-url create --slug "$SLUG" --session "$SESSION" --port "$PORT" >/dev/null
elif [[ "$(jq -r .session_id <<<"$preview")" != "$session_id" || "$(jq -r .port <<<"$preview")" != "$PORT" ]]; then
  tenki sandbox preview-url bind "$(jq -r .id <<<"$preview")" --session "$SESSION" --port "$PORT" >/dev/null
fi
url="$(tenki sandbox preview-url list --json | jq -r --arg slug "$SLUG" '.preview_urls[] | select(.slug == $slug) | .preview_url')"
echo
echo "Backend: $url"

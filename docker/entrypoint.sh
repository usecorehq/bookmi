#!/bin/sh
# Bookmi API entrypoint — mirrors qore-backend pattern.
# Runs Drizzle migrations first (idempotent), then starts the HTTP server.
# Set SKIP_MIGRATIONS=true to bypass (useful for a one-off migrate container
# or local docker-compose runs that manage migrations separately).
set -e

if [ "${SKIP_MIGRATIONS:-}" != "true" ]; then
  echo "[entrypoint] Running database migrations…"
  node dist/migrate.js
  echo "[entrypoint] Migrations complete."
fi

case "${APP_ROLE:-web}" in
  worker)
    exec node dist/main.worker.js
    ;;
  web|*)
    exec node dist/main.js
    ;;
esac
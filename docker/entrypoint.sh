#!/bin/sh
# Bookmi API entrypoint — same image, two roles (web|worker), dispatched
# on APP_ROLE. Coolify sets APP_ROLE per service; a service with the var
# unset defaults to web so single-service deploys keep working.
#
# Migrations run first regardless (idempotent — safe under concurrent
# web+worker startups). Set SKIP_MIGRATIONS=true to bypass, useful for a
# one-off migrate container or replicated deploys where a dedicated step
# owns migration.
set -e

if [ "${SKIP_MIGRATIONS:-}" != "true" ]; then
  echo "[entrypoint] Running database migrations…"
  node dist/migrate.js
  echo "[entrypoint] Migrations complete."
fi

case "${APP_ROLE:-web}" in
  worker)
    echo "[entrypoint] Starting Bookmi worker (schedulers + BullMQ consumers)…"
    exec node dist/main.worker.js
    ;;
  web|*)
    echo "[entrypoint] Starting Bookmi API (PORT=${PORT:-4000})…"
    exec node dist/main.js
    ;;
esac

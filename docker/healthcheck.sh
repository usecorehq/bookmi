#!/bin/sh
# Container liveness probe. Role-aware — the worker runs headless
# (NestFactory.createApplicationContext, no HTTP), so curl to /api/health
# is not a meaningful signal for it. If the worker process crashes, tini
# exits and the container exits — Coolify's rolling deploy catches that
# via container status, not this probe.
set -e

case "${APP_ROLE:-web}" in
  worker)
    exit 0
    ;;
  web|*)
    curl -fsS "http://127.0.0.1:${PORT:-4000}/api/health" > /dev/null || exit 1
    ;;
esac

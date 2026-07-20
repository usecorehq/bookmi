#!/bin/sh
# Liveness probe for the Bookmi API container.
# The health endpoint is public (no JWT required) at GET /api/health.
set -e

case "${APP_ROLE:-web}" in
  worker)
    exit 0
    ;;
  web|*)
    curl -fsS "http://127.0.0.1:${PORT:-3000}/v1/health" >/dev/null || exit 1
    ;;
esac

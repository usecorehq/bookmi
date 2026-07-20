#!/bin/sh
# Liveness probe for the Bookmi API container.
# The health endpoint is public (no JWT required) at GET /api/health.
set -e

curl -fsS "http://127.0.0.1:${PORT:-4000}/api/health" > /dev/null || exit 1

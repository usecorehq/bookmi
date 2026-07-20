# syntax=docker/dockerfile:1.7

# ─── stage 1: install all deps ─────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/tsconfig/package.json ./packages/tsconfig/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ─── stage 2: build ────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared-types/node_modules ./packages/shared-types/node_modules 2>/dev/null || true
# Copy source — shared-types first (api build depends on it)
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY turbo.json ./
# Build shared-types then api; produces apps/api/dist/
RUN pnpm --filter @bookmi/shared-types build
RUN pnpm --filter @bookmi/api build
# Prune devDependencies from the workspace that api needs at runtime
RUN pnpm --filter @bookmi/api --prod deploy /app/pruned

# ─── stage 3: runtime ──────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# PORT is set in Coolify env vars; default matches nest bootstrap fallback
ENV PORT=4000

# curl for health probes; tini reaps zombies + forwards SIGTERM cleanly
# so Nest's shutdown hooks and BullMQ drain actually run.
RUN apk add --no-cache curl tini

# Only the compiled output + pruned prod node_modules
COPY --from=build /app/pruned/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
# Migrations live inside dist after nest build copies them
COPY --from=build /app/apps/api/src/drizzle/migrations ./src/drizzle/migrations
COPY --from=build /app/apps/api/package.json ./package.json

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh

# Non-root — Node's official image ships a `node` user (uid 1000)
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD /usr/local/bin/healthcheck.sh

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]

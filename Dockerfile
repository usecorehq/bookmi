# syntax=docker/dockerfile:1.7

# ─── stage 1: prune the monorepo ───────────────────────────────────────────
FROM node:22-alpine AS pruner
WORKDIR /app
RUN npm install -g turbo
COPY . .
ENV TARGET_APP=@bookmi/api
RUN turbo prune ${TARGET_APP} --docker

# ─── stage 2: build stage (handles install + compilation) ──────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# 1. Copy the pruned workspace structure and lockfiles first
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml

# 2. Install all dependencies inside this stage using build cache
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 3. Copy the actual source files out of the pruned monorepo
COPY --from=pruner /app/out/full/ .
COPY turbo.json ./

# 4. Build the application (nest will be found perfectly now)
ENV TARGET_APP=@bookmi/api
RUN pnpm --filter ${TARGET_APP} build

# 5. Prune devDependencies cleanly for runtime allocation
RUN pnpm --filter ${TARGET_APP} --prod deploy /app/pruned

# ─── stage 3: runtime ──────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

RUN apk add --no-cache curl tini

# Only pull production node_modules and built target artifacts
COPY --from=build /app/pruned/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/src/drizzle/migrations ./src/drizzle/migrations
COPY --from=build /app/apps/api/package.json ./package.json

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD /usr/local/bin/healthcheck.sh

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
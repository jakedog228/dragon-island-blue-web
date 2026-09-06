# syntax=docker/dockerfile:1.7

# Dragon Island Blue deployment image.
#
# Two artifacts come out of one build:
#   - `game`: the authoritative server as a single bundled ESM file.
#   - `web`:  the static browser client, copied into the proxy image at deploy time.
#
# NOTHING copyrighted is present in any stage. The client build already refuses to embed game
# content (`publicDir: false` in apps/web/vite.config.ts), and the server reads its extracted
# resource tree from a read-only bind mount at runtime. See .dockerignore.

# ------------------------------------------------------------------------------------------------
# Stage 1: dependencies
# ------------------------------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /repo

# corepack pins pnpm to the version the lockfile was produced with, so the image cannot silently
# resolve a different dependency graph than the one that was tested.
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY apps ./apps

# --frozen-lockfile makes a stale lockfile a build failure rather than a silent upgrade.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile

# ------------------------------------------------------------------------------------------------
# Stage 2: build both artifacts
# ------------------------------------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo

COPY tsconfig.base.json ./
COPY docs/code-mod-api.md ./docs/code-mod-api.md

# Fail the image build on a type error rather than shipping a bundle that only happens to run.
RUN pnpm --filter @dib/game-server typecheck
RUN pnpm --filter @dib/game-server build
RUN pnpm --filter @dib/web build

# ------------------------------------------------------------------------------------------------
# Stage 3: server runtime
# ------------------------------------------------------------------------------------------------
FROM node:22-alpine AS game
WORKDIR /app

# wget backs the container healthcheck; busybox already provides it in the base image.
ENV NODE_ENV=production \
    DIB_GAME_ENV=production \
    DIB_GAME_PORT=8788 \
    DIB_GAME_BIND_HOST=0.0.0.0 \
    DIB_GAME_DATA_DIR=/var/lib/dib-game \
    DIB_GAME_EXTRACTED_DATA=/srv/extracted/data \
    DIB_GAME_HMAC_SECRET_FILE=/run/secrets/dib_game_hmac \
    DIB_GAME_TRUST_PROXY=1 \
    DIB_GAME_LOG_LEVEL=info

# Only the bundle. No sources, no node_modules, no transpiler, no package manager.
COPY --from=build /repo/apps/game-server/dist/dib-game-server.mjs ./dib-game-server.mjs

# The state directory is a volume mount point; pre-creating it with the right owner means the
# container can run read-only everywhere else.
RUN mkdir -p /var/lib/dib-game && chown -R node:node /var/lib/dib-game

# Same treatment for the durable log directory: it is a volume mount point that the unprivileged
# runtime user must be able to write to under a read-only root filesystem.
RUN mkdir -p /var/log/dib-game && chown -R node:node /var/log/dib-game

USER node
EXPOSE 8788

# Readiness, not liveness: it reports 503 until an installed logic pack is actually serving, which
# is the condition the proxy should wait for before sending traffic.
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8788/api/game/readiness || exit 1

# Exec form so the process is PID 1 and receives SIGTERM directly; the runtime drains on it.
ENTRYPOINT ["node", "/app/dib-game-server.mjs"]
CMD ["serve"]

# ------------------------------------------------------------------------------------------------
# Stage 4: proxy + static client
# ------------------------------------------------------------------------------------------------
FROM caddy:2-alpine AS proxy

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv/web

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:2019/metrics || exit 1

FROM node:24-alpine AS base

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Runtime dependency tree only. Everything in devDependencies (vite/rollup,
# vitest + jsdom, playwright, tsc, drizzle-kit, oxlint/oxfmt native binaries,
# tailwind oxide, @types/*) is build-time-only: server.mjs and dist/server
# import nothing outside `dependencies`, so the published image gets a fresh
# --prod install instead of the full tree from `deps`.
FROM base AS prod-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile --prod

# Build the SPA (dist/client) and the server bundle (dist/server)
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV production
RUN corepack enable pnpm && pnpm build

# Production image: single node process serving the SPA, the REST routes and the
# server functions. Rules are applied from ./drizzle at startup (see server.mjs).
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

# The server bundle keeps its runtime dependencies external, so only the
# production install tree is copied. Copying the builder's node_modules would
# ship the whole dev toolchain (~100 MB compressed) and cannot be split into a
# smaller layer afterwards.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.mjs ./server.mjs
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 3000

ENV PORT 3000
ENV DATABASE_PATH "/app/data/db.sqlite"
ENV ASAR_DIR "/app/data/asar"
ENV TEMP_DIR "/app/data/temp"
ENV ADMIN_USER_NAME "admin"
ENV ADMIN_USER_PASSWORD ""

CMD ["node", "server.mjs"]

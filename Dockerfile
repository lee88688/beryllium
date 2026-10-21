FROM node:24-alpine AS base

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

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

# The server bundle keeps its runtime dependencies external, so the install
# tree from the builder stage is copied as-is (dev-only tooling included; pruning
# it is a follow-up, see docs/).
COPY --from=builder /app/node_modules ./node_modules
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

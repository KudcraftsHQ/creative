# syntax=docker/dockerfile:1.7
#
# One image, two applications: the web app and a worker with no domain. They
# differ only in the command Coolify runs, which is what keeps them honestly
# identical — the worker cannot drift from the code the API is running.
#
# Stages:
#   base    → shared FROM
#   install → full deps (build) and prod-only deps (runtime) in separate trees
#   builder → prisma generate, vite build, bun build
#   runner  → slim runtime: prod deps, built artifacts, and the fonts

FROM oven/bun:1 AS base
WORKDIR /app

# ────────────────────────────────────────────────────────────
# install
# ────────────────────────────────────────────────────────────
FROM base AS install

RUN mkdir -p /tmp/dev/apps/api /tmp/dev/apps/web /tmp/dev/apps/cli /tmp/dev/apps/mcp /tmp/dev/packages/core
COPY package.json bun.lock /tmp/dev/
COPY apps/api/package.json /tmp/dev/apps/api/
COPY apps/web/package.json /tmp/dev/apps/web/
COPY apps/cli/package.json /tmp/dev/apps/cli/
COPY apps/mcp/package.json /tmp/dev/apps/mcp/
COPY packages/core/package.json /tmp/dev/packages/core/
COPY apps/api/prisma /tmp/dev/apps/api/prisma
RUN cd /tmp/dev && (bun install --frozen-lockfile || bun install)

RUN mkdir -p /tmp/prod/apps/api /tmp/prod/apps/web /tmp/prod/apps/cli /tmp/prod/apps/mcp /tmp/prod/packages/core
COPY package.json bun.lock /tmp/prod/
COPY apps/api/package.json /tmp/prod/apps/api/
COPY apps/web/package.json /tmp/prod/apps/web/
COPY apps/cli/package.json /tmp/prod/apps/cli/
COPY apps/mcp/package.json /tmp/prod/apps/mcp/
COPY packages/core/package.json /tmp/prod/packages/core/
COPY apps/api/prisma /tmp/prod/apps/api/prisma
RUN cd /tmp/prod && (bun install --frozen-lockfile --production || bun install --production)

# ────────────────────────────────────────────────────────────
# builder
# ────────────────────────────────────────────────────────────
FROM base AS builder

# Bun installs a workspace's dependencies into that workspace's own node_modules
# and keeps the shared store at the root — so every package that takes part in the
# build needs both. Missing packages/core here is what makes `zod` unresolvable
# from core's own source.
COPY --from=install /tmp/dev/node_modules ./node_modules
COPY --from=install /tmp/dev/apps/api/node_modules ./apps/api/node_modules
COPY --from=install /tmp/dev/apps/web/node_modules ./apps/web/node_modules
COPY --from=install /tmp/dev/packages/core/node_modules ./packages/core/node_modules
# The fonts are installed below by running the CLI itself, so it needs its deps.
COPY --from=install /tmp/dev/apps/cli/node_modules ./apps/cli/node_modules
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY templates ./templates
COPY assets ./assets

RUN cd apps/api && bunx prisma generate
RUN cd apps/web && bun run build
RUN cd apps/api && bun run build

# The fonts are registered at build time and baked in, so a render is reproducible
# from the image alone: a container that fetched its faces at boot would render
# differently the day Google's repository moves a file.
#
# From assets/fonts, not from Google. `font add <family>` goes through the GitHub
# API, whose unauthenticated quota is sixty requests an hour for the entire host —
# so every deployment spent quota re-downloading the same files, and once it ran
# out the image stopped building for reasons unrelated to the change. See
# assets/fonts/README.md.
ENV CREATIVE_HOME=/app/.creative
RUN bun run apps/cli/src/index.ts font add ./assets/fonts/Anton-Regular.ttf \
      --family "Anton" --license OFL --source "google/fonts ofl/anton, vendored in assets/fonts" \
 && bun run apps/cli/src/index.ts font add ./assets/fonts/ArchivoBlack-Regular.ttf \
      --family "Archivo Black" --license OFL --source "google/fonts ofl/archivoblack, vendored in assets/fonts"

# ────────────────────────────────────────────────────────────
# runner
# ────────────────────────────────────────────────────────────
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Jakarta
ENV PORT=3000
ENV CREATIVE_HOME=/app/.creative
ENV CREATIVE_TEMPLATES=/app/templates

# curl is not decoration: Coolify's healthcheck shells into the container and runs
# one, and bun:1-slim ships neither curl nor wget — without it every deployment
# rolls back as unhealthy however well the app is running.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates curl \
 && ln -fs /usr/share/zoneinfo/Asia/Jakarta /etc/localtime \
 && dpkg-reconfigure -f noninteractive tzdata \
 && rm -rf /var/lib/apt/lists/*

COPY --from=install /tmp/prod/node_modules ./node_modules
COPY --from=install /tmp/prod/apps/api/node_modules ./apps/api/node_modules
# The API bundle keeps @napi-rs/canvas external and the worker runs core from
# source, so core's own dependencies have to be present at runtime too.
COPY --from=install /tmp/prod/packages/core/node_modules ./packages/core/node_modules

COPY package.json ./
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/dist ./apps/api/dist
# The worker runs from source rather than a second bundle, and the API's src is
# what it imports — both ship as-is.
COPY --from=builder /app/apps/api/src ./apps/api/src
# Signup is closed on the deployed instance, so provisioning an account means
# running this inside the container. It has to ship as source.
COPY --from=builder /app/apps/api/scripts ./apps/api/scripts
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/templates ./templates
COPY --from=builder /app/.creative ./.creative

RUN cd apps/api && bunx prisma generate

EXPOSE 3000

# Migrations run here, on the web application only. The worker is started with a
# different command and must not race it.
CMD ["sh", "-c", "cd /app/apps/api && bunx prisma migrate deploy && cd /app && bun apps/api/dist/index.js"]

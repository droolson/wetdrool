# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

FROM ${NODE_IMAGE} AS build

ENV COREPACK_HOME=/opt/corepack \
    PNPM_HOME=/opt/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY patches ./patches
COPY apps/moderation-service/package.json ./apps/moderation-service/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/test-fixtures/package.json ./packages/test-fixtures/package.json

RUN --mount=type=cache,id=socially-woke-pnpm,target=/opt/pnpm/store \
    pnpm install --frozen-lockfile --filter @socially-woke/moderation-service...

COPY apps/moderation-service ./apps/moderation-service
COPY packages/protocol ./packages/protocol

RUN pnpm --filter @socially-woke/protocol build \
    && pnpm --filter @socially-woke/moderation-service build \
    && pnpm --filter @socially-woke/moderation-service deploy \
      --prod \
      --legacy \
      --strict-peer-dependencies=false \
      /opt/moderation-service

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    MODERATION_HOST=0.0.0.0 \
    MODERATION_PORT=4400
WORKDIR /app

RUN groupadd --system --gid 10004 socially-woke \
    && useradd --system --uid 10004 --gid socially-woke --home-dir /nonexistent socially-woke

COPY --from=build --chown=socially-woke:socially-woke /opt/moderation-service ./

USER 10004:10004
EXPOSE 4400

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4400/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "dist/src/server.js"]

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
COPY apps/relay/package.json ./apps/relay/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json

RUN --mount=type=cache,id=wokesocial-pnpm,target=/opt/pnpm/store \
    pnpm install --frozen-lockfile --filter @wokesocial/relay...

COPY apps/relay ./apps/relay
COPY packages/protocol ./packages/protocol

RUN pnpm --filter @wokesocial/protocol build \
    && pnpm --filter @wokesocial/relay build \
    && pnpm --filter @wokesocial/relay deploy \
      --prod \
      --legacy \
      --strict-peer-dependencies=false \
      /opt/relay

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    RELAY_HOST=0.0.0.0 \
    RELAY_PORT=4200
WORKDIR /app

RUN groupadd --system --gid 10003 wokesocial \
    && useradd --system --uid 10003 --gid wokesocial --home-dir /nonexistent wokesocial

COPY --from=build --chown=wokesocial:wokesocial /opt/relay ./

USER 10003:10003
EXPOSE 4200

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4200/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "dist/src/main.js"]

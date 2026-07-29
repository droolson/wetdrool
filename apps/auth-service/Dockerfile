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
COPY apps/auth-service/package.json ./apps/auth-service/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/crypto/package.json ./packages/crypto/package.json

RUN --mount=type=cache,id=wokesocial-pnpm,target=/opt/pnpm/store \
    pnpm install --frozen-lockfile --filter @wokesocial/auth-service...

COPY apps/auth-service ./apps/auth-service
COPY packages/config ./packages/config
COPY packages/crypto ./packages/crypto

RUN pnpm --filter @wokesocial/config build \
    && pnpm --filter @wokesocial/crypto build \
    && pnpm --filter @wokesocial/auth-service build \
    && pnpm --filter @wokesocial/auth-service deploy \
      --prod \
      --legacy \
      --strict-peer-dependencies=false \
      /opt/auth-service

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    AUTH_HOST=0.0.0.0 \
    AUTH_PORT=4300
WORKDIR /app

RUN groupadd --system --gid 10001 wokesocial \
    && useradd --system --uid 10001 --gid wokesocial --home-dir /nonexistent wokesocial

COPY --from=build --chown=wokesocial:wokesocial /opt/auth-service ./

USER 10001:10001
EXPOSE 4300

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4300/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "--enable-source-maps"]
CMD ["dist/src/server.js"]

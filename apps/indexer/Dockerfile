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
COPY apps/indexer/package.json ./apps/indexer/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/rate-limit/package.json ./packages/rate-limit/package.json
COPY packages/storage/package.json ./packages/storage/package.json
COPY packages/test-fixtures/package.json ./packages/test-fixtures/package.json

RUN --mount=type=cache,id=wokesocial-pnpm,target=/opt/pnpm/store \
    pnpm install --frozen-lockfile --filter @wokesocial/indexer...

COPY apps/indexer ./apps/indexer
COPY packages/config ./packages/config
COPY packages/protocol ./packages/protocol
COPY packages/rate-limit ./packages/rate-limit
COPY packages/storage ./packages/storage
COPY packages/test-fixtures ./packages/test-fixtures

RUN pnpm --filter @wokesocial/config build \
    && pnpm --filter @wokesocial/protocol build \
    && pnpm --filter @wokesocial/rate-limit build \
    && pnpm --filter @wokesocial/storage build \
    && pnpm --filter @wokesocial/indexer build \
    && pnpm --filter @wokesocial/indexer deploy \
      --prod \
      --legacy \
      --strict-peer-dependencies=false \
      /opt/indexer

FROM ${NODE_IMAGE} AS runtime

ENV APP_ENV=production \
    NODE_ENV=production \
    INDEXER_HOST=0.0.0.0 \
    INDEXER_PORT=4000 \
    CONTENT_STORAGE_PATH=/var/lib/wokesocial/content
WORKDIR /app

RUN groupadd --system --gid 10005 wokesocial \
    && useradd --system --uid 10005 --gid wokesocial --home-dir /nonexistent wokesocial \
    && install -d -o wokesocial -g wokesocial -m 0700 /var/lib/wokesocial/content

COPY --from=build --chown=wokesocial:wokesocial /opt/indexer ./

USER 10005:10005
VOLUME ["/var/lib/wokesocial/content"]
EXPOSE 4000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const port=process.env.INDEXER_PORT??'4000';fetch(`http://127.0.0.1:${port}/readyz`,{signal:AbortSignal.timeout(2500)}).then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})"]

ENTRYPOINT ["node", "--enable-source-maps"]
CMD ["dist/src/server.js"]

# syntax=docker/dockerfile:1.7

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS build

ENV PNPM_HOME=/opt/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY patches ./patches
COPY packages/config/package.json ./packages/config/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/storage/package.json ./packages/storage/package.json
COPY apps/media-worker/package.json ./apps/media-worker/package.json

RUN pnpm install --frozen-lockfile --filter @wokesocial/media-worker...

COPY packages/config ./packages/config
COPY packages/protocol ./packages/protocol
COPY packages/storage ./packages/storage
COPY apps/media-worker ./apps/media-worker

RUN pnpm --filter @wokesocial/media-worker... build
RUN pnpm --config.strict-peer-dependencies=false \
    --filter @wokesocial/media-worker \
    --prod deploy --legacy /opt/media-worker

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends ffmpeg=7:5.1.9-0+deb12u1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV MEDIA_WORKER_HOST=0.0.0.0
ENV MEDIA_WORKER_PORT=4500
ENV MEDIA_WORKER_STAGING_ROOT=/var/lib/wokesocial/staging
ENV MEDIA_WORKER_TEMPORARY_ROOT=/var/lib/wokesocial/temporary
ENV MEDIA_WORKER_STORAGE_ROOT=/var/lib/wokesocial/cas

RUN install -d -o node -g node -m 0700 \
    /var/lib/wokesocial \
    /var/lib/wokesocial/staging \
    /var/lib/wokesocial/temporary \
    /var/lib/wokesocial/cas

COPY --from=build --chown=node:node /opt/media-worker /opt/media-worker

WORKDIR /opt/media-worker
USER node
EXPOSE 4500
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "const port=process.env.MEDIA_WORKER_PORT??'4500';fetch(`http://127.0.0.1:${port}/readyz`,{signal:AbortSignal.timeout(2500)}).then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})"]

ENTRYPOINT ["node", "--enable-source-maps"]
CMD ["dist/src/server.js"]

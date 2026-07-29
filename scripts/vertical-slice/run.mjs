import { randomInt, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chainEnvironment } from '../toolchain-paths.mjs';
import { repositoryRoot } from '../workspaces.mjs';

const PROGRAM_ID = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const POSTGRES_IMAGE =
  'postgres:18.4-alpine3.24@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15';
const POSTGRES_DATABASE = 'wokesocial_vertical';
const POSTGRES_ADMIN_USER = 'wokesocial_vertical';
const POSTGRES_ADMIN_PASSWORD = 'vertical-slice-local-only';
const INDEXER_RUNTIME_PASSWORD = 'vertical-indexer-runtime-only';
const INDEXER_MIGRATION_PASSWORD = 'vertical-indexer-migration-only';
const EXPECTED_RUST_VERSION = 'rustc 1.89.0 ';
const EXPECTED_AGAVE_VERSION = '2.3.0';
const EXPECTED_ANCHOR_VERSION = '0.32.1';
const SUCCESS_TIMEOUT_MS = 90_000;
const currentFile = fileURLToPath(import.meta.url);
const argumentsAfterScript = process.argv.slice(2);
const preflightOnly =
  argumentsAfterScript.length === 1 && argumentsAfterScript[0] === '--preflight-only';
const shutdownController = new AbortController();

if (resolve(process.argv[1] ?? '') !== currentFile) {
  throw new Error('The vertical-slice orchestrator must be executed as a script.');
}
if (argumentsAfterScript.length > 0 && !preflightOnly) {
  throw new Error('Usage: node scripts/vertical-slice/run.mjs [--preflight-only]');
}

const state = {
  children: [],
  containerName: undefined,
  portReservation: undefined,
  runDirectory: undefined,
};
let cleanupPromise;
let terminationSignal;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (terminationSignal !== undefined) {
      return;
    }
    terminationSignal = signal;
    process.stderr.write(`\n[vertical-slice] Received ${signal}; stopping active work.\n`);
    shutdownController.abort(new Error(`Vertical-slice execution interrupted by ${signal}.`));
  });
}

try {
  if (preflightOnly) {
    await fastPreflight();
  } else {
    await main();
  }
  await cleanup();
  assertNotTerminating();
  process.stdout.write(
    preflightOnly
      ? '[vertical-slice] PASS: fast orchestration preflight.\n'
      : '[vertical-slice] PASS: validator → storage → indexer replay → web UI.\n',
  );
} catch (error) {
  await printDiagnostics(error);
  process.exitCode =
    terminationSignal === 'SIGINT' ? 130 : terminationSignal === 'SIGTERM' ? 143 : 1;
  await cleanup();
}

async function fastPreflight() {
  assertLocalOnlyEnvironment();
  step('Running fast orchestration preflight');
  await runChecked('Docker daemon check', 'docker', ['version', '--format', '{{.Server.Version}}']);
  for (const [label, path] of [
    ['installed workspace dependencies', join(repositoryRoot, 'node_modules', '.modules.yaml')],
    [
      'pinned Agave validator',
      join(
        repositoryRoot,
        '.local',
        'toolchains',
        'agave',
        '2.3.0',
        'solana-release',
        'bin',
        'solana-test-validator',
      ),
    ],
    [
      'pinned Anchor CLI',
      join(repositoryRoot, '.local', 'toolchains', 'anchor', '0.32.1', 'bin', 'anchor'),
    ],
    [
      'pinned Rust launcher',
      join(repositoryRoot, '.local', 'toolchains', 'cargo', 'bin', 'rustup'),
    ],
    ['Anchor SBF program', join(repositoryRoot, 'target', 'deploy', 'social_protocol.so')],
    ['Anchor IDL', join(repositoryRoot, 'target', 'idl', 'social_protocol.json')],
  ]) {
    await requireFile(path, label);
  }
  await runChecked('Offline signed-fixture construction', process.execPath, [
    'tests/vertical-slice/offline-smoke.mjs',
  ]);
  state.portReservation = await reservePortBlock(30);
  await state.portReservation.release();
  state.portReservation = undefined;
}

async function main() {
  assertLocalOnlyEnvironment();
  const verticalSliceRoot = join(repositoryRoot, '.local', 'vertical-slice');
  await mkdir(verticalSliceRoot, { recursive: true, mode: 0o700 });
  state.runDirectory = await mkdtemp(join(verticalSliceRoot, 'run-'));
  await mkdir(join(state.runDirectory, 'logs'), { recursive: true });
  const contentDirectory = join(state.runDirectory, 'content');
  const metadataPath = join(state.runDirectory, 'fixture.json');
  const ledgerDirectory = join(state.runDirectory, 'ledger');
  const deployerKeypair = join(repositoryRoot, '.local', 'solana', 'deployer.json');
  const programBinary = join(repositoryRoot, 'target', 'deploy', 'social_protocol.so');
  const programIdl = join(repositoryRoot, 'target', 'idl', 'social_protocol.json');
  const chainEnv = chainEnvironment({
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    TURBO_TELEMETRY_DISABLED: '1',
  });

  step('Checking Docker and installing the checksum-pinned local chain toolchains');
  await runChecked('Docker daemon check', 'docker', ['version', '--format', '{{.Server.Version}}']);
  await runChecked('Pinned toolchain installation', process.execPath, [
    'scripts/install-chain-toolchain.mjs',
  ]);
  await runChecked('Deterministic local key preparation', process.execPath, [
    'scripts/prepare-local-solana.mjs',
  ]);

  const rustVersion = await capture(
    join(repositoryRoot, '.local', 'toolchains', 'cargo', 'bin', 'rustup'),
    ['run', '1.89.0', 'rustc', '--version'],
    { env: chainEnv },
  );
  const agaveBinary = join(
    repositoryRoot,
    '.local',
    'toolchains',
    'agave',
    '2.3.0',
    'solana-release',
    'bin',
    'solana-test-validator',
  );
  const solanaBinary = join(dirname(agaveBinary), 'solana');
  const anchorBinary = join(
    repositoryRoot,
    '.local',
    'toolchains',
    'anchor',
    '0.32.1',
    'bin',
    'anchor',
  );
  const agaveVersion = await capture(agaveBinary, ['--version'], { env: chainEnv });
  const anchorVersion = await capture(anchorBinary, ['--version'], { env: chainEnv });
  assertIncludes(rustVersion, EXPECTED_RUST_VERSION, 'Rust toolchain');
  assertIncludes(agaveVersion, EXPECTED_AGAVE_VERSION, 'Agave toolchain');
  assertIncludes(anchorVersion, EXPECTED_ANCHOR_VERSION, 'Anchor toolchain');

  step('Building one coherent SBF/IDL state plus production indexer and Next applications');
  await runChecked('Anchor SBF build', anchorBinary, ['build'], { env: chainEnv });
  await runChecked('Anchor event decoder drift check', 'pnpm', [
    '--filter',
    '@wokesocial/indexer',
    'check:anchor-events',
  ]);
  await runChecked('Production application build', 'pnpm', [
    '--filter',
    '@wokesocial/indexer...',
    '--filter',
    '@wokesocial/web...',
    'build',
  ]);
  await runChecked('Playwright Chromium installation', process.execPath, [
    'scripts/install-playwright.mjs',
  ]);
  await requireFile(programBinary, 'Anchor SBF program');
  await requireFile(programIdl, 'Anchor IDL');
  await requireFile(
    join(repositoryRoot, 'apps', 'indexer', 'dist', 'src', 'server.js'),
    'production indexer',
  );
  await requireFile(
    join(repositoryRoot, 'apps', 'web', '.next', 'BUILD_ID'),
    'production Next build',
  );

  const idl = JSON.parse(await readFile(programIdl, 'utf8'));
  if (idl.address !== PROGRAM_ID) {
    throw new Error(`Fresh IDL declares ${String(idl.address)}, expected ${PROGRAM_ID}.`);
  }
  const deployedProgramId = await capture(
    solanaBinary,
    ['-k', 'target/deploy/social_protocol-keypair.json', 'address'],
    { env: chainEnv },
  );
  if (deployedProgramId !== PROGRAM_ID) {
    throw new Error(
      `Generated local program keypair is ${deployedProgramId}, expected ${PROGRAM_ID}.`,
    );
  }
  const deployerAddress = await capture(
    solanaBinary,
    ['-k', '.local/solana/deployer.json', 'address'],
    { env: chainEnv },
  );

  state.portReservation = await reservePortBlock(30);
  const basePort = state.portReservation.base;
  const ports = {
    rpc: basePort,
    websocket: basePort + 1,
    faucet: basePort + 2,
    gossip: basePort + 3,
    dynamicStart: basePort + 4,
    dynamicEnd: basePort + 27,
    indexer: basePort + 28,
    web: basePort + 29,
  };
  await state.portReservation.release(Array.from({ length: 28 }, (_, offset) => offset));

  const rpcUrl = `http://127.0.0.1:${ports.rpc}`;
  const websocketUrl = `ws://127.0.0.1:${ports.websocket}`;
  const indexerUrl = `http://127.0.0.1:${ports.indexer}`;
  const webUrl = `http://127.0.0.1:${ports.web}`;

  step(`Starting a fresh local validator on explicit RPC port ${ports.rpc}`);
  const validator = spawnLogged(
    'validator',
    agaveBinary,
    [
      '--ledger',
      ledgerDirectory,
      '--reset',
      '--quiet',
      '--bind-address',
      '127.0.0.1',
      '--gossip-host',
      '127.0.0.1',
      '--rpc-port',
      String(ports.rpc),
      '--faucet-port',
      String(ports.faucet),
      '--gossip-port',
      String(ports.gossip),
      '--dynamic-port-range',
      `${ports.dynamicStart}-${ports.dynamicEnd}`,
      '--mint',
      deployerAddress,
      '--bpf-program',
      PROGRAM_ID,
      programBinary,
      '--limit-ledger-size',
      '10000',
      '--log-messages-bytes-limit',
      '200000',
    ],
    { env: chainEnv },
  );
  await waitForRpcHealth(rpcUrl, validator, 60_000);
  const genesisHash = await rpcCall(rpcUrl, 'getGenesisHash');
  if (typeof genesisHash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]+$/u.test(genesisHash)) {
    throw new Error('Local validator returned an invalid genesis hash.');
  }
  const networkId = `wokenet:v1:${genesisHash}:${PROGRAM_ID}`;

  step('Starting an isolated disposable PostgreSQL projection');
  const database = await startPostgres();
  const databaseUrl = `postgresql://wokesocial_indexer_runtime:${INDEXER_RUNTIME_PASSWORD}@127.0.0.1:${database.port}/${POSTGRES_DATABASE}`;
  const databaseMigrationUrl = `postgresql://wokesocial_indexer_migration:${INDEXER_MIGRATION_PASSWORD}@127.0.0.1:${database.port}/${POSTGRES_DATABASE}`;

  step('Publishing canonical signed manifests and finalized protocol transactions');
  await runChecked(
    'On-chain fixture publication',
    process.execPath,
    ['tests/vertical-slice/seed.mjs'],
    {
      env: {
        ...process.env,
        CONTENT_STORAGE_PATH: contentDirectory,
        DEPLOYER_KEYPAIR_PATH: deployerKeypair,
        PROGRAM_ID,
        SOLANA_RPC_URL: rpcUrl,
        SOLANA_WS_URL: websocketUrl,
        VERTICAL_SLICE_METADATA_PATH: metadataPath,
      },
    },
  );
  const fixture = JSON.parse(await readFile(metadataPath, 'utf8'));
  assertFixture(fixture, networkId);

  const serviceEnvironment = {
    ...process.env,
    ALLOWED_ORIGINS: webUrl,
    APP_ENV: 'test',
    CONTENT_STORAGE_PATH: contentDirectory,
    DATABASE_URL: databaseUrl,
    INDEXER_BATCH_SIZE: '1000',
    INDEXER_DEPLOYMENT_SLOT: '0',
    INDEXER_HOST: '127.0.0.1',
    INDEXER_NETWORK_ID: networkId,
    INDEXER_POLL_INTERVAL_MS: '100',
    INDEXER_PORT: String(ports.indexer),
    INDEXER_RETRY_ATTEMPTS: '3',
    INDEXER_RETRY_BASE_MS: '10',
    INDEXER_RETRY_MAX_MS: '100',
    LOG_LEVEL: 'info',
    NEXT_PUBLIC_APP_ORIGIN: webUrl,
    NEXT_PUBLIC_INDEXER_URL: indexerUrl,
    NEXT_PUBLIC_PROGRAM_ID: PROGRAM_ID,
    NEXT_PUBLIC_SOLANA_CLUSTER: 'localnet',
    NEXT_PUBLIC_SOLANA_RPC_URL: rpcUrl,
    NODE_ENV: 'production',
    RATE_LIMIT_DANGEROUSLY_USE_MEMORY_STORE: '1',
    RATE_LIMIT_DEPLOYMENT_ID: 'vertical-slice',
    RATE_LIMIT_KEY_SECRET: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
    SESSION_SECRET: 'vertical-slice-local-session-secret-only',
    SOLANA_COMMITMENT: 'finalized',
    SOLANA_RPC_URLS: rpcUrl,
    SOLANA_WS_URLS: websocketUrl,
  };
  const indexerEnvironment = {
    ...serviceEnvironment,
    NODE_ENV: 'test',
  };
  for (const name of Object.keys(indexerEnvironment)) {
    if (
      ['DATABASE_MIGRATION_URL', 'REDIS_URL', 'SESSION_SECRET', 'SPONSOR_SIGNER_URI'].includes(
        name,
      ) ||
      ['PGPASSWORD', 'PGPASSFILE', 'POSTGRES_PASSWORD', 'POSTGRES_PASSWORD_FILE'].includes(name) ||
      /(?:^|_)DATABASE_(?:MIGRATION|RUNTIME)_(?:PASSWORD|URL)$/u.test(name) ||
      (/(?:^|_)DATABASE_URL$/u.test(name) && name !== 'DATABASE_URL')
    ) {
      Reflect.deleteProperty(indexerEnvironment, name);
    }
  }
  const indexerMigrationEnvironment = {
    ...indexerEnvironment,
    DATABASE_MIGRATION_URL: databaseMigrationUrl,
  };

  step('Applying explicit production-built indexer migrations with the migration role');
  await runChecked(
    'Production-built indexer migrations',
    process.execPath,
    [join(repositoryRoot, 'apps', 'indexer', 'dist', 'src', 'migrate.js')],
    { env: indexerMigrationEnvironment },
  );

  step('Running the production indexer sync and asserting its public feed contract');
  await state.portReservation.release([28]);
  let indexer = startIndexer(indexerEnvironment);
  await waitForHttp(`${indexerUrl}/readyz`, indexer, 30_000, async (response) => {
    const body = await response.json();
    return response.ok && body?.ok === true;
  });
  const firstFeed = await waitForExpectedFeed(indexerUrl, fixture, indexer);
  await assertFeedContract(firstFeed, fixture);
  const firstCommunity = await waitForExpectedCommunity(indexerUrl, fixture, indexer);
  await assertCommunityContracts(indexerUrl, firstCommunity, fixture);

  step('Exercising the production-built Next application before projection replay');
  await state.portReservation.release([29]);
  state.portReservation = undefined;
  await verifyProductionWeb(
    serviceEnvironment,
    ports.web,
    webUrl,
    indexerUrl,
    fixture,
    'pre-replay',
  );

  step('Clearing the PostgreSQL projection and replaying it from finalized chain history');
  await stopChild(indexer);
  await runChecked(
    'Production projection replay',
    process.execPath,
    ['tests/vertical-slice/replay.mjs'],
    {
      env: {
        ...indexerEnvironment,
        VERTICAL_SLICE_METADATA_PATH: metadataPath,
      },
    },
  );

  step('Restarting the production indexer over the replayed projection');
  indexer = startIndexer(indexerEnvironment);
  await waitForExpectedFeed(indexerUrl, fixture, indexer);
  const replayedCommunity = await waitForExpectedCommunity(indexerUrl, fixture, indexer);
  await assertCommunityContracts(indexerUrl, replayedCommunity, fixture);

  step('Exercising the production-built Next application after projection replay');
  await verifyProductionWeb(
    serviceEnvironment,
    ports.web,
    webUrl,
    indexerUrl,
    fixture,
    'post-replay',
  );

  await stopChild(indexer);
}

async function verifyProductionWeb(environment, webPort, webUrl, indexerUrl, fixture, phase) {
  const web = spawnLogged(
    `web-${phase}`,
    'pnpm',
    [
      '--dir',
      join(repositoryRoot, 'apps', 'web'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(webPort),
    ],
    {
      env: {
        ...environment,
        WOKESOCIAL_INDEXER_URL: indexerUrl,
      },
    },
  );
  try {
    await waitForHttp(`${webUrl}/home`, web, 45_000, (response) => response.ok);
    await runChecked(
      `Production browser verification (${phase})`,
      'pnpm',
      [
        '--dir',
        join(repositoryRoot, 'apps', 'web'),
        'exec',
        'playwright',
        'test',
        '--config',
        'vertical-slice.playwright.config.ts',
      ],
      {
        env: {
          ...process.env,
          PLAYWRIGHT_BASE_URL: webUrl,
          VERTICAL_SLICE_EXPECTED_AUTHOR: fixture.authorDisplayName,
          VERTICAL_SLICE_EXPECTED_COMMUNITY: fixture.communityName,
          VERTICAL_SLICE_EXPECTED_COMMUNITY_ADDRESS: fixture.communityAddress,
          VERTICAL_SLICE_EXPECTED_COMMUNITY_SLUG: fixture.communitySlug,
          VERTICAL_SLICE_EXPECTED_POST: fixture.postBody,
          VERTICAL_SLICE_EXPECTED_POST_ID: fixture.postObjectId,
          VERTICAL_SLICE_SUPPRESSED_POST: fixture.tombstonedPostBody,
        },
      },
    );
  } finally {
    await stopChild(web);
  }
}

function startIndexer(environment) {
  return spawnLogged(
    'indexer',
    process.execPath,
    [join(repositoryRoot, 'apps', 'indexer', 'dist', 'src', 'server.js')],
    { env: environment },
  );
}

async function startPostgres() {
  state.containerName = `wokesocial-vertical-${process.pid}-${randomUUID().slice(0, 8)}`;
  const result = await capture('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    state.containerName,
    '--env',
    `POSTGRES_DB=${POSTGRES_DATABASE}`,
    '--env',
    `POSTGRES_USER=${POSTGRES_ADMIN_USER}`,
    '--env',
    `POSTGRES_PASSWORD=${POSTGRES_ADMIN_PASSWORD}`,
    '--publish',
    '127.0.0.1::5432',
    '--tmpfs',
    '/var/lib/postgresql:rw,nosuid,nodev,size=512m',
    '--health-cmd',
    `pg_isready -U ${POSTGRES_ADMIN_USER} -d ${POSTGRES_DATABASE} -h 127.0.0.1`,
    '--health-interval',
    '1s',
    '--health-timeout',
    '3s',
    '--health-retries',
    '60',
    '--health-start-period',
    '2s',
    POSTGRES_IMAGE,
  ]);
  if (!/^[a-f0-9]{12,64}$/u.test(result)) {
    throw new Error(`Docker returned an unexpected PostgreSQL container ID: ${result}`);
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const health = await capture(
      'docker',
      ['inspect', '--format', '{{.State.Health.Status}}', state.containerName],
      { allowFailure: true },
    );
    if (health === 'healthy') {
      break;
    }
    if (health === 'unhealthy') {
      throw new Error('Disposable PostgreSQL reported an unhealthy state.');
    }
    await delay(250);
  }
  const health = await capture(
    'docker',
    ['inspect', '--format', '{{.State.Health.Status}}', state.containerName],
    { allowFailure: true },
  );
  if (health !== 'healthy') {
    throw new Error('Disposable PostgreSQL did not become healthy within 60 seconds.');
  }
  const provisioningPath = '/tmp/wokesocial-provision-service-roles.sql';
  await runChecked('PostgreSQL role provisioning source copy', 'docker', [
    'cp',
    join(repositoryRoot, 'infra', 'postgres', 'provision-service-roles.sql'),
    `${state.containerName}:${provisioningPath}`,
  ]);
  await runChecked('PostgreSQL least-privilege role provisioning', 'docker', [
    'exec',
    '--env',
    `POSTGRES_DB=${POSTGRES_DATABASE}`,
    '--env',
    'AUTH_DATABASE_RUNTIME_PASSWORD=vertical-unused-auth-runtime-only',
    '--env',
    'AUTH_DATABASE_MIGRATION_PASSWORD=vertical-unused-auth-migration-only',
    '--env',
    `INDEXER_DATABASE_RUNTIME_PASSWORD=${INDEXER_RUNTIME_PASSWORD}`,
    '--env',
    `INDEXER_DATABASE_MIGRATION_PASSWORD=${INDEXER_MIGRATION_PASSWORD}`,
    '--env',
    'MODERATION_DATABASE_RUNTIME_PASSWORD=vertical-unused-moderation-runtime-only',
    '--env',
    'MODERATION_DATABASE_MIGRATION_PASSWORD=vertical-unused-moderation-migration-only',
    state.containerName,
    'psql',
    '--username',
    POSTGRES_ADMIN_USER,
    '--dbname',
    POSTGRES_DATABASE,
    '--file',
    provisioningPath,
  ]);
  const mapping = await capture('docker', ['port', state.containerName, '5432/tcp']);
  const port = Number(/127\.0\.0\.1:(\d+)/u.exec(mapping)?.[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Docker returned an invalid PostgreSQL port mapping: ${mapping}`);
  }
  return { port };
}

async function waitForExpectedFeed(indexerUrl, fixture, child) {
  let accepted;
  await waitForHttp(
    `${indexerUrl}/v1/feed/home?limit=20`,
    child,
    SUCCESS_TIMEOUT_MS,
    async (response) => {
      if (!response.ok) {
        return false;
      }
      const body = await response.json();
      if (
        !Array.isArray(body?.posts) ||
        body.posts.some((post) => post?.id === fixture.tombstonedPostObjectId)
      ) {
        return false;
      }
      const expected = body.posts.find((post) => post?.id === fixture.postObjectId);
      if (expected === undefined) {
        return false;
      }
      accepted = body;
      return true;
    },
  );
  return accepted;
}

async function assertFeedContract(feed, fixture) {
  if (!feed || typeof feed !== 'object') {
    throw new Error('Indexer feed contract did not return an object.');
  }
  const post = feed.posts?.find((candidate) => candidate.id === fixture.postObjectId);
  if (
    post?.body !== fixture.postBody ||
    post?.author?.displayName !== fixture.authorDisplayName ||
    post?.verification?.state !== 'verified' ||
    post?.verification?.signatureValid !== true ||
    post?.verification?.contentHashValid !== true ||
    post?.verification?.anchor?.finality !== 'finalized' ||
    post?.verification?.manifestUri !== `ipfs://${fixture.postCid}` ||
    post?.verification?.contentHash !== fixture.postPayloadHash
  ) {
    throw new Error('Indexer consumer feed did not preserve the verified validator fixture.');
  }
  if (!Number.isSafeInteger(feed.meta?.checkpointSlot) || feed.meta.checkpointSlot < 0) {
    throw new Error('Indexer consumer feed did not expose a finalized checkpoint.');
  }
}

async function waitForExpectedCommunity(indexerUrl, fixture, child) {
  let accepted;
  const query = new URLSearchParams({ network: fixture.networkId });
  await waitForHttp(
    `${indexerUrl}/v1/communities/${encodeURIComponent(fixture.communityAddress)}?${query.toString()}`,
    child,
    SUCCESS_TIMEOUT_MS,
    async (response) => {
      if (!response.ok) {
        return false;
      }
      const body = await response.json();
      if (
        body?.community?.communityAddress !== fixture.communityAddress ||
        body.community.objectId !== fixture.communityObjectId ||
        body.community.manifestVerified !== true
      ) {
        return false;
      }
      accepted = body;
      return true;
    },
  );
  return accepted;
}

async function assertCommunityContracts(indexerUrl, detail, fixture) {
  const community = detail?.community;
  if (
    detail?.canonical !== false ||
    detail?.projection !== 'wokenet-open-indexer' ||
    detail?.network !== fixture.networkId ||
    Object.hasOwn(detail, 'memberships') ||
    community?.networkId !== fixture.networkId ||
    community?.communityAddress !== fixture.communityAddress ||
    community?.objectId !== fixture.communityObjectId ||
    community?.manifestCid !== fixture.communityCid ||
    community?.manifestHash !== fixture.communityPayloadHash ||
    community?.manifestVerified !== true ||
    community?.schemaVersion !== 2 ||
    community?.manifestAuthority !== fixture.authorAuthority ||
    community?.latestActionAuthority !== fixture.authorAuthority ||
    community?.signingKeyId !== `${fixture.authorIdentityId}#root/${fixture.authorAuthority}` ||
    community?.governanceVersion !== 1 ||
    community?.governanceStrategyHash !== fixture.communityGovernanceDigest ||
    community?.manifestGovernanceVersion !== 1 ||
    community?.manifestGovernanceStrategyHash !== fixture.communityGovernanceDigest ||
    community?.content?.name !== fixture.communityName ||
    community?.content?.slug !== fixture.communitySlug ||
    community?.content?.visibility !== 'public' ||
    community?.content?.replacement?.sequence !== 1
  ) {
    throw new Error('Community detail did not preserve the verified validator fixture.');
  }

  const directoryQuery = new URLSearchParams({
    network: fixture.networkId,
    limit: '20',
  });
  const directory = await requiredJson(
    `${indexerUrl}/v1/communities?${directoryQuery.toString()}`,
    'community directory',
  );
  const directoryCommunity = directory.communities?.find(
    (candidate) => candidate.communityAddress === fixture.communityAddress,
  );
  if (
    directory?.canonical !== false ||
    directory?.projection !== 'wokenet-open-indexer' ||
    directory?.recipe !== 'community-directory-v1' ||
    directory?.network !== fixture.networkId ||
    Object.hasOwn(directory, 'memberships') ||
    !Array.isArray(directory.communities) ||
    directory.communities.some(
      (candidate) =>
        candidate?.manifestVerified !== true || candidate?.content?.visibility !== 'public',
    ) ||
    directoryCommunity?.objectId !== fixture.communityObjectId
  ) {
    throw new Error('Community directory did not expose only verified public projections.');
  }

  const searchQuery = new URLSearchParams({
    network: fixture.networkId,
    q: fixture.communityName,
    limit: '30',
  });
  const search = await requiredJson(
    `${indexerUrl}/v1/search?${searchQuery.toString()}`,
    'public community search',
  );
  const searchCommunity = search.results?.find(
    (candidate) =>
      candidate?.kind === 'community' &&
      candidate?.community?.communityAddress === fixture.communityAddress,
  );
  if (
    search?.canonical !== false ||
    search?.network !== fixture.networkId ||
    search?.ranking?.version !== 'public-match-v2' ||
    searchCommunity?.community?.objectId !== fixture.communityObjectId ||
    searchCommunity?.community?.content?.visibility !== 'public'
  ) {
    throw new Error('Public search did not preserve the verified community fixture.');
  }
}

async function requiredJson(url, label) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }
  return response.json();
}

function assertFixture(fixture, expectedNetworkId) {
  const requiredStrings = [
    'authorDisplayName',
    'authorAuthority',
    'authorIdentityId',
    'communityAddress',
    'communityCid',
    'communityGovernanceDigest',
    'communityName',
    'communityObjectId',
    'communityPayloadHash',
    'communitySlug',
    'postBody',
    'postCid',
    'postObjectId',
    'postPayloadHash',
    'tombstonedPostBody',
    'tombstonedPostObjectId',
    'viewerIdentityId',
  ];
  for (const field of requiredStrings) {
    if (typeof fixture?.[field] !== 'string' || fixture[field].length === 0) {
      throw new Error(`Fixture metadata is missing ${field}.`);
    }
  }
  if (fixture.networkId !== expectedNetworkId || fixture.programId !== PROGRAM_ID) {
    throw new Error('Fixture metadata was produced for an unexpected network or program.');
  }
  if (!Array.isArray(fixture.transactionSignatures) || fixture.transactionSignatures.length < 10) {
    throw new Error('Fixture metadata does not prove the expected finalized transactions.');
  }
}

async function waitForRpcHealth(url, child, timeout) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    assertRunning(child);
    try {
      const result = await rpcCall(url, 'getHealth');
      if (result === 'ok') {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Local validator did not become healthy within ${timeout / 1_000} seconds: ${errorText(lastError)}`,
  );
}

async function rpcCall(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    signal: AbortSignal.timeout(2_000),
  });
  const body = await response.json();
  if (!response.ok || body?.error !== undefined) {
    throw new Error(`RPC ${method} failed: ${JSON.stringify(body?.error ?? body)}`);
  }
  return body.result;
}

async function waitForHttp(url, child, timeout, accept) {
  const deadline = Date.now() + timeout;
  let lastFetchError;
  let lastRejectedResponse;
  while (Date.now() < deadline) {
    assertRunning(child);
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json,text/html' },
        signal: AbortSignal.timeout(3_000),
      });
      const diagnosticBody = await response.clone().text();
      if (await accept(response)) {
        return;
      }
      lastRejectedResponse = new Error(
        `HTTP ${response.status}: ${diagnosticBody.slice(0, 500) || '<empty response body>'}`,
      );
    } catch (error) {
      lastFetchError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Timed out waiting for ${url}: ${errorText(lastRejectedResponse ?? lastFetchError)}`,
  );
}

async function reservePortBlock(size) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const base = randomInt(20_000, 60_000 - size);
    const servers = [];
    try {
      for (let offset = 0; offset < size; offset += 1) {
        servers.push({ offset, server: await listen(base + offset) });
      }
      const activeServers = new Map(servers.map(({ offset, server }) => [offset, server]));
      return {
        base,
        release: async (offsets = [...activeServers.keys()]) => {
          const selected = [];
          for (const offset of offsets) {
            const server = activeServers.get(offset);
            if (server !== undefined) {
              activeServers.delete(offset);
              selected.push(server);
            }
          }
          await Promise.all(selected.map(closeServer));
        },
      };
    } catch {
      await Promise.all(servers.map(({ server }) => closeServer(server)));
    }
  }
  throw new Error('Unable to reserve a collision-free local validator port block.');
}

function listen(port) {
  return new Promise((resolveListen, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.removeListener('error', reject);
      resolveListen(server);
    });
  });
}

function closeServer(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function spawnLogged(name, command, args, options = {}) {
  assertNotTerminating();
  const logPath = join(state.runDirectory, 'logs', `${name}.log`);
  const fileDescriptor = openSync(logPath, 'a', 0o600);
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    detached: process.platform !== 'win32',
    env: options.env ?? process.env,
    signal: shutdownController.signal,
    stdio: ['ignore', fileDescriptor, fileDescriptor],
  });
  closeSync(fileDescriptor);
  const tracked = { child, logPath, name, stopped: false };
  state.children.push(tracked);
  child.once('error', (error) => {
    tracked.spawnError = error;
  });
  return tracked;
}

function assertRunning(tracked) {
  if (tracked.spawnError) {
    throw new Error(`${tracked.name} failed to start: ${tracked.spawnError.message}`);
  }
  if (tracked.child.exitCode !== null || tracked.child.signalCode !== null) {
    throw new Error(
      `${tracked.name} exited before readiness (code ${String(tracked.child.exitCode)}, signal ${String(tracked.child.signalCode)}).`,
    );
  }
}

async function stopChild(tracked) {
  if (!tracked || tracked.stopped) {
    return;
  }
  tracked.stopped = true;
  if (tracked.child.exitCode !== null || tracked.child.signalCode !== null) {
    return;
  }
  signalChild(tracked.child, 'SIGTERM');
  if (!(await waitForExit(tracked.child, 8_000))) {
    signalChild(tracked.child, 'SIGKILL');
    await waitForExit(tracked.child, 3_000);
  }
}

function signalChild(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error;
    }
  }
}

function waitForExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolveWait) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', exited);
      resolveWait(false);
    }, timeout);
    const exited = () => {
      clearTimeout(timer);
      resolveWait(true);
    };
    child.once('exit', exited);
  });
}

async function runChecked(label, command, args, options = {}) {
  const exit = await run(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
  });
  if (exit.code !== 0) {
    throw new Error(`${label} failed with exit code ${String(exit.code)}.`);
  }
}

function run(command, args, options) {
  assertNotTerminating();
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      ...options,
      signal: shutdownController.signal,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveRun({ code, signal }));
  });
}

async function capture(command, args, options = {}) {
  if (!options.ignoreShutdown) {
    assertNotTerminating();
  }
  return new Promise((resolveCapture, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      signal: options.ignoreShutdown ? undefined : shutdownController.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0 && !options.allowFailure) {
        reject(
          new Error(
            `${command} ${args.join(' ')} failed (${String(code)}): ${stderr.trim() || stdout.trim()}`,
          ),
        );
        return;
      }
      resolveCapture((options.includeStderr ? `${stdout}\n${stderr}` : stdout).trim());
    });
  });
}

async function cleanup() {
  if (cleanupPromise !== undefined) {
    return cleanupPromise;
  }
  cleanupPromise = (async () => {
    if (state.portReservation !== undefined) {
      await state.portReservation.release();
      state.portReservation = undefined;
    }
    for (const child of [...state.children].reverse()) {
      await stopChild(child);
    }
    if (state.containerName !== undefined) {
      await capture('docker', ['rm', '--force', state.containerName], {
        allowFailure: true,
        ignoreShutdown: true,
      });
      state.containerName = undefined;
    }
    if (
      process.exitCode !== 1 &&
      process.env.KEEP_VERTICAL_SLICE_ARTIFACTS !== '1' &&
      state.runDirectory !== undefined
    ) {
      await rm(state.runDirectory, { recursive: true, force: true });
      state.runDirectory = undefined;
    }
  })();
  return cleanupPromise;
}

async function printDiagnostics(error) {
  process.stderr.write(`\n[vertical-slice] FAIL: ${errorText(error)}\n`);
  for (const tracked of state.children) {
    let content = '';
    try {
      content = readFileSync(tracked.logPath, 'utf8');
    } catch {
      continue;
    }
    const tail = content.split('\n').slice(-80).join('\n').trim();
    if (tail) {
      process.stderr.write(`\n[vertical-slice] ${tracked.name} log tail:\n${tail}\n`);
    }
  }
  if (state.containerName !== undefined) {
    const logs = await capture('docker', ['logs', '--tail', '80', state.containerName], {
      allowFailure: true,
      ignoreShutdown: true,
      includeStderr: true,
    });
    if (logs) {
      process.stderr.write(`\n[vertical-slice] PostgreSQL log tail:\n${logs}\n`);
    }
  }
  if (state.runDirectory !== undefined) {
    process.stderr.write(
      `\n[vertical-slice] Failure artifacts retained at ${state.runDirectory}\n`,
    );
  }
}

async function requireFile(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} is missing at ${path}.`);
  }
}

function assertIncludes(actual, expected, label) {
  if (!actual.includes(expected)) {
    throw new Error(`${label} drifted: expected ${expected}, received ${actual}.`);
  }
}

function assertLocalOnlyEnvironment() {
  for (const [name, value] of Object.entries({
    PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    SOLANA_RPC_URLS: process.env.SOLANA_RPC_URLS,
    SOLANA_WS_URL: process.env.SOLANA_WS_URL,
    SOLANA_WS_URLS: process.env.SOLANA_WS_URLS,
  })) {
    if (value !== undefined && /\b(?:api\.mainnet-beta|mainnet|devnet|testnet)\b/iu.test(value)) {
      throw new Error(`${name} points at a non-local network; vertical-slice execution refused.`);
    }
  }
}

function delay(milliseconds) {
  assertNotTerminating();
  return new Promise((resolveDelay, rejectDelay) => {
    const timer = setTimeout(() => {
      shutdownController.signal.removeEventListener('abort', aborted);
      resolveDelay();
    }, milliseconds);
    const aborted = () => {
      clearTimeout(timer);
      rejectDelay(shutdownController.signal.reason);
    };
    shutdownController.signal.addEventListener('abort', aborted, { once: true });
  });
}

function step(message) {
  process.stdout.write(`\n[vertical-slice] ${message}\n`);
}

function errorText(error) {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function assertNotTerminating() {
  if (shutdownController.signal.aborted) {
    throw shutdownController.signal.reason;
  }
}

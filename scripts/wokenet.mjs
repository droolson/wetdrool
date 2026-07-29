import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const networkRoot = join(repositoryRoot, 'network', 'wokenet');
const forkRoot = join(networkRoot, 'firedancer');
const lockPath = join(forkRoot, 'SOURCE.lock.json');
const capabilitiesPath = join(forkRoot, 'NATIVE_RPC_CAPABILITIES.json');
const genesisPolicyPath = join(networkRoot, 'GENESIS_POLICY.json');
const trustedTemporaryRoot = process.platform === 'win32' ? tmpdir() : '/tmp';

function fail(message) {
  throw new Error(`wokenet: ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function commandEnvironment(overrides = {}) {
  const environment = {};
  for (const key of [
    'HOME',
    'USER',
    'LOGNAME',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'https_proxy',
    'http_proxy',
    'all_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ]) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key];
  }
  environment.PATH =
    process.platform === 'darwin'
      ? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
      : '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  environment.LANG = 'C';
  environment.LC_ALL = 'C';
  environment.TMPDIR = trustedTemporaryRoot;
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  return { ...environment, ...overrides };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: commandEnvironment(options.env),
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || result.error?.message;
    fail(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

function resolvePatch(relativePath) {
  const patchesRoot = resolve(forkRoot, 'patches');
  const patchPath = resolve(forkRoot, relativePath);
  const withinRoot = patchPath === patchesRoot || patchPath.startsWith(`${patchesRoot}${sep}`);
  assert(withinRoot, `patch escapes the fork patch directory: ${relativePath}`);
  return patchPath;
}

function loadPolicy() {
  assert(existsSync(lockPath), `${relative(repositoryRoot, lockPath)} is missing`);
  assert(existsSync(capabilitiesPath), `${relative(repositoryRoot, capabilitiesPath)} is missing`);
  const lock = readJson(lockPath);
  const capabilities = readJson(capabilitiesPath);
  assert(lock.schemaVersion === 1, 'unsupported Firedancer source-lock schema');
  assert(capabilities.schemaVersion === 1, 'unsupported RPC capability schema');
  assert(
    lock.upstream.repository === 'https://github.com/firedancer-io/firedancer.git',
    'Firedancer upstream must be the official HTTPS repository',
  );
  assert(/^[0-9a-f]{40}$/u.test(lock.upstream.commit), 'upstream commit must be a full SHA');
  assert(
    typeof lock.upstream.commitTimestamp === 'string' &&
      Number.isFinite(Date.parse(lock.upstream.commitTimestamp)),
    'upstream commit timestamp must be ISO-8601',
  );
  assert(
    capabilities.upstreamCommit === lock.upstream.commit,
    'RPC capability evidence must bind to the pinned upstream commit',
  );
  assert(
    lock.buildDependencies?.openssl?.repository === 'https://github.com/openssl/openssl' &&
      lock.buildDependencies.openssl.tag === 'openssl-3.6.2' &&
      /^[0-9a-f]{40}$/u.test(lock.buildDependencies.openssl.commit),
    'the pinned OpenSSL build dependency is missing or invalid',
  );
  assert(
    capabilities.productionReady === false &&
      capabilities.activationPolicy?.allowProductionTraffic === false &&
      capabilities.activationPolicy?.allowMainNetworkGenesis === false,
    'native Firedancer must remain fail-closed until its production gates pass',
  );
  const requiredMissingMethods = [
    'getSignaturesForAddress',
    'getSignatureStatuses',
    'getTransaction',
    'sendTransaction',
    'simulateTransaction',
  ];
  const observedRequiredReads = [
    'getAccountInfo',
    'getBalance',
    'getGenesisHash',
    'getLatestBlockhash',
    'getMultipleAccounts',
    'getProgramAccounts',
    'getSlot',
  ];
  assert(
    capabilities.nativeValidator?.binary === lock.downstream.validatorBinary &&
      capabilities.nativeValidator.usesAgaveRuntime === false &&
      capabilities.nativeValidator.upstreamReleaseAvailable === false,
    'native validator capability policy is incomplete or unsafe',
  );
  const liveClusterSafety = capabilities.liveClusterSafety;
  assert(
    liveClusterSafety?.implemented === true &&
      liveClusterSafety.productionActivationAuthorized === false &&
      liveClusterSafety.configMode === 'consensus.wokenet_live_cluster' &&
      liveClusterSafety.exactGenesisHashBinding === 'consensus.expected_genesis_hash' &&
      liveClusterSafety.runtimeClassification ===
        'config.is_live_cluster=true; config.cluster=wokenet' &&
      liveClusterSafety.modeOmissionFailsClosed === true &&
      liveClusterSafety.localnetTopologyAttestationBinary === lock.downstream.developmentBinary &&
      JSON.stringify(liveClusterSafety.disabledModePreservesUpstreamClassificationOnlyFor) ===
        JSON.stringify(['local-or-development', 'recognized-built-in-cluster']) &&
      liveClusterSafety.rejectsBuiltInSolanaAndPythGenesisHashes === true &&
      JSON.stringify(liveClusterSafety.requirements) ===
        JSON.stringify([
          'native-firedancer',
          'non-local-production-command',
          'no-agave',
          'canonical-nonzero-32-byte-genesis-hash',
          'nonzero-expected-shred-version',
          'genesis-validation',
          'explicit-identity',
          'sandbox',
          'multiprocess',
          'production-benchmark-limits',
        ]) &&
      JSON.stringify(liveClusterSafety.directNativeCTestCoverage) ===
        JSON.stringify([
          'test_config_parse:wokenet-live-policy',
          'test_config_parse:wokenet-live-toml-parse',
          'test_config_parse:wokenet-live-classification',
        ]),
    'WokeNet live-cluster safety capability evidence is incomplete or unsafe',
  );
  assert(
    capabilities.nativeRpc?.binary === lock.downstream.validatorBinary &&
      capabilities.nativeRpc.evidenceClassification ===
        'mixed-source-observation-and-native-c-unit-conformance' &&
      capabilities.nativeRpc.nonVotingTemplateBootProven === false &&
      capabilities.nativeRpc.templateBlockProductionEnabled === false &&
      JSON.stringify(capabilities.nativeRpc.templateBootBlockers) ===
        JSON.stringify([
          'connected-native-rpc-observer-boot-not-demonstrated',
          'tower-to-replay-to-rpc-finalized-and-cache-pruning-integration-not-demonstrated',
          'observer-restart-commitment-continuity-not-demonstrated',
        ]) &&
      JSON.stringify(capabilities.nativeRpc.directNativeCTestCoverage) ===
        JSON.stringify(['getMultipleAccounts', 'getProgramAccounts']) &&
      JSON.stringify(capabilities.nativeRpc.implementedRequiredReads) ===
        JSON.stringify(observedRequiredReads) &&
      JSON.stringify(capabilities.nativeRpc.missingRequiredMethods) ===
        JSON.stringify(requiredMissingMethods),
    'native RPC capability sets or evidence classification are stale',
  );
  const nonVotingObserver = capabilities.nativeRpc.nonVotingObserver;
  assert(
    nonVotingObserver?.sourceImplemented === true &&
      nonVotingObserver.wokenetLiveClusterOnly === true &&
      nonVotingObserver.exactConfigRole ===
        'empty paths.vote_account; layout.enable_block_production=false; tiles.rpc.enabled=true; zero paths.authorized_voter_paths' &&
      nonVotingObserver.voteAccountRequiredOutsideExactRole === true &&
      nonVotingObserver.suppliedVoteAccountRemainsVoting === true &&
      nonVotingObserver.retainsVirtualTowerRootAndReset === true &&
      nonVotingObserver.skipsOwnVoteAccountReconciliation === true &&
      nonVotingObserver.constructsVoteTransactions === false &&
      nonVotingObserver.checkpointSerializationObserved === false &&
      nonVotingObserver.restartCommitmentContinuityProven === false &&
      nonVotingObserver.connectedBootProven === false &&
      nonVotingObserver.directNativeCTestExecution?.passed === true &&
      nonVotingObserver.directNativeCTestExecution.environment ===
        'linux-x86_64-docker-emulation' &&
      nonVotingObserver.directNativeCTestExecution.nativeHardware === false &&
      JSON.stringify(nonVotingObserver.directNativeCTestExecution.tests) ===
        JSON.stringify(['test_config_parse', 'test_tower_tile']) &&
      JSON.stringify(nonVotingObserver.directNativeCTestCoverage) ===
        JSON.stringify([
          'test_config_parse:wokenet-rpc-observer-role-matrix',
          'test_tower_tile:observer-vote-suppression',
          'test_tower_tile:observer-account-reconciliation-skip',
          'test_tower_tile:observer-virtual-tower-replay-root-and-pruning',
        ]),
    'native WokeNet non-voting RPC observer evidence is incomplete or unsafe',
  );
  const executionResultPropagation = capabilities.nativeRpc.executionResultPropagation;
  assert(
    executionResultPropagation?.sourceImplemented === true &&
      executionResultPropagation.productionComplete === false &&
      JSON.stringify(executionResultPropagation.rpcMethodsPromoted) === JSON.stringify([]) &&
      executionResultPropagation.boundary ===
        'execrp completion through scheduler metadata to replay transaction event' &&
      JSON.stringify(executionResultPropagation.identityFields) ===
        JSON.stringify(['slot', 'bank_idx', 'bank_seq']) &&
      JSON.stringify(executionResultPropagation.resultFields) ===
        JSON.stringify(['txn_err', 'exec_err', 'exec_err_kind', 'exec_err_idx', 'custom_err']) &&
      executionResultPropagation.schedulerPoolReuseReset === true &&
      executionResultPropagation.signatureFailureAuthoritative === true &&
      executionResultPropagation.nonInstructionNestedErrorsNormalized === true &&
      executionResultPropagation.fullCustomErrorRangePreserved === true &&
      executionResultPropagation.directNativeCTestExecution?.passed === true &&
      executionResultPropagation.directNativeCTestExecution.environment ===
        'linux-x86_64-docker-emulation' &&
      executionResultPropagation.directNativeCTestExecution.nativeHardware === false &&
      JSON.stringify(executionResultPropagation.directNativeCTestExecution.tests) ===
        JSON.stringify(['test_sched', 'test_execrp_tile', 'test_replay_tile']) &&
      JSON.stringify(executionResultPropagation.directNativeCTestExecution.arguments) ===
        JSON.stringify({
          test_sched: [],
          test_execrp_tile: ['--page-sz', 'normal', '--page-cnt', '1572864'],
          test_replay_tile: ['--page-sz', 'normal', '--page-cnt', '1048576'],
        }) &&
      JSON.stringify(
        executionResultPropagation.directNativeCTestExecution.attestedNofileSoftLimit,
      ) ===
        JSON.stringify({
          test_execrp_tile: 1_048_576,
          test_replay_tile: 1_048_576,
        }) &&
      JSON.stringify(executionResultPropagation.testedCompletionOrders) ===
        JSON.stringify([
          'execution-before-signature-success',
          'execution-before-signature-failure',
          'signature-failure-before-execution',
        ]) &&
      JSON.stringify(executionResultPropagation.untestedCompletionOrders) ===
        JSON.stringify(['signature-success-before-execution']) &&
      JSON.stringify(executionResultPropagation.directNativeCTestCoverage) ===
        JSON.stringify([
          'test_sched:scheduler-pool-reuse-reset',
          'test_execrp_tile:execution-and-signature-completion-metadata',
          'test_replay_tile:identity-and-result-propagation',
          'test_replay_tile:signature-failure-both-tested-orders',
          'test_replay_tile:non-instruction-error-normalization',
          'test_replay_tile:custom-error-uint-max',
        ]) &&
      JSON.stringify(executionResultPropagation.remainingProductionWork) ===
        JSON.stringify([
          'live-cache-topology-and-replay-insertion',
          'snapshot-result-storage-and-cache-restore',
          'dead-fork-notification-integration',
          'commitment-confirmations',
          'rpc-json-implementation',
          'connected-native-validator-integration',
        ]),
    'native execution-result propagation evidence is incomplete or overstates RPC readiness',
  );
  const liveSignatureStatusCacheCore = capabilities.nativeRpc.liveSignatureStatusCacheCore;
  assert(
    liveSignatureStatusCacheCore?.sourceImplemented === true &&
      liveSignatureStatusCacheCore.productionComplete === false &&
      JSON.stringify(liveSignatureStatusCacheCore.rpcMethodsPromoted) === JSON.stringify([]) &&
      liveSignatureStatusCacheCore.scope ===
        'standalone caller-sized live replay-result cache core' &&
      liveSignatureStatusCacheCore.linkedIntoValidatorBinaries === false &&
      liveSignatureStatusCacheCore.connectedCaller === false &&
      liveSignatureStatusCacheCore.snapshotRestoreSupported === false &&
      liveSignatureStatusCacheCore.borshPayloadSupported === false &&
      JSON.stringify(liveSignatureStatusCacheCore.exactBankIdentity) ===
        JSON.stringify(['bank_idx', 'bank_seq']) &&
      liveSignatureStatusCacheCore.rootRetentionSlots === 300 &&
      liveSignatureStatusCacheCore.failClosedOnIncomplete === true &&
      liveSignatureStatusCacheCore.deadBankTombstones === true &&
      liveSignatureStatusCacheCore.deterministicRootPruning === true &&
      liveSignatureStatusCacheCore.compactKey?.bytes === 20 &&
      JSON.stringify(liveSignatureStatusCacheCore.compactKey.offsetRange) ===
        JSON.stringify([0, 11]) &&
      liveSignatureStatusCacheCore.compactKey.selection ===
        'deterministic caller seed plus blockhash' &&
      liveSignatureStatusCacheCore.compactKey.agaveProductionSelectionDifference ===
        'Agave v3.1.8 selects the same range with runtime RNG' &&
      liveSignatureStatusCacheCore.compactKey.collisionsReturnAmbiguous === true &&
      liveSignatureStatusCacheCore.concurrency?.writers === 1 &&
      liveSignatureStatusCacheCore.concurrency.readOnlyReadersSupported === true &&
      liveSignatureStatusCacheCore.concurrency.publication ===
        'lock-free C atomics with bounded seqlock retries' &&
      liveSignatureStatusCacheCore.concurrency.retryExhaustion === 'QUERY_AGAIN' &&
      liveSignatureStatusCacheCore.directNativeCTestExecution?.passed === true &&
      liveSignatureStatusCacheCore.directNativeCTestExecution.environment ===
        'linux-x86_64-docker-emulation' &&
      liveSignatureStatusCacheCore.directNativeCTestExecution.nativeHardware === false &&
      JSON.stringify(liveSignatureStatusCacheCore.directNativeCTestExecution.tests) ===
        JSON.stringify(['test_sigstatuscache']) &&
      JSON.stringify(liveSignatureStatusCacheCore.directNativeCTestExecution.sanitizers) ===
        JSON.stringify(['address', 'undefined', 'leak']) &&
      JSON.stringify(liveSignatureStatusCacheCore.remainingProductionWork) ===
        JSON.stringify([
          'topology-and-workspace-allocation',
          'live-replay-insertion',
          'dead-bank-and-root-event-wiring',
          'snapshot-root-visibility-in-separately-versioned-abi',
          'rpc-query-consumer',
          'connected-native-validator-integration',
        ]),
    'native live signature-status cache core evidence is incomplete or overstates integration',
  );
  const snapshotResultParser = capabilities.nativeRpc.snapshotResultParser;
  assert(
    snapshotResultParser?.sourceImplemented === true &&
      snapshotResultParser.productionComplete === false &&
      JSON.stringify(snapshotResultParser.rpcMethodsPromoted) === JSON.stringify([]) &&
      snapshotResultParser.boundary ===
        'slot-delta parser typed result view with borrowed BorshIoError chunks' &&
      snapshotResultParser.completeTransactionAndInstructionDiscriminants === true &&
      snapshotResultParser.strictIncrementalUtf8 === true &&
      snapshotResultParser.parserLocalBorshLengthCap === false &&
      snapshotResultParser.snapinRetainsTypedResults === false &&
      snapshotResultParser.sharedCacheRestoration === false &&
      snapshotResultParser.agaveGeneratedGoldenFixture === false &&
      snapshotResultParser.maxRootedSlotDeltas === 300 &&
      snapshotResultParser.layoutBytes?.snapshotEntry === 64 &&
      snapshotResultParser.layoutBytes.typedResult === 32 &&
      snapshotResultParser.layoutBytes.advanceResult === 48 &&
      snapshotResultParser.layoutBytes.parserFootprintBefore === 14_208 &&
      snapshotResultParser.layoutBytes.parserFootprintAfter === 14_208 &&
      snapshotResultParser.directNativeCTestExecution?.passed === true &&
      snapshotResultParser.directNativeCTestExecution.environment ===
        'linux-x86_64-docker-emulation' &&
      snapshotResultParser.directNativeCTestExecution.nativeHardware === false &&
      JSON.stringify(snapshotResultParser.directNativeCTestExecution.tests) ===
        JSON.stringify(['test_slot_delta_parser', 'test_snap_roundtrip']) &&
      snapshotResultParser.directNativeCTestExecution.fuzzerTargetBuilds === true &&
      JSON.stringify(snapshotResultParser.remainingProductionWork) ===
        JSON.stringify([
          'configured-borsh-storage-with-fail-closed-capacity',
          'snapin-to-shared-cache-restoration',
          'snapshot-root-identity-and-visibility-abi',
          'agave-generated-golden-or-differential-fixtures',
          'immediate-post-restore-query-integration',
        ]),
    'native snapshot result parser evidence is incomplete or overstates restoration',
  );
  const programAccounts = capabilities.nativeRpc.getProgramAccounts;
  assert(
    programAccounts?.productionComplete === false &&
      programAccounts.conformance ===
        'bounded native subset; not unrestricted or full Solana RPC conformance' &&
      programAccounts.storagePath ===
        'native epoch-protected fd_accdb owner scan on a referenced frozen fork' &&
      JSON.stringify(programAccounts.supportedFilters) ===
        JSON.stringify(['dataSize', 'memcmp:base58', 'memcmp:base64', 'memcmp:bytes']) &&
      JSON.stringify(programAccounts.unsupportedFilters) ===
        JSON.stringify(['tokenAccountState']) &&
      programAccounts.limits?.filters === 4 &&
      programAccounts.limits?.results === 1024 &&
      programAccounts.limits?.scanWorkUnits === 4_000_000 &&
      programAccounts.limits?.scanOwnerDataBytes === 64 * 1024 * 1024 &&
      programAccounts.limits?.preSliceMatchedAccountDataBytes === 32 * 1024 * 1024 &&
      JSON.stringify(programAccounts.supportedConfig) ===
        JSON.stringify([
          'commitment',
          'dataSlice',
          'encoding:binary',
          'encoding:base58',
          'encoding:base64',
          'encoding:base64+zstd',
          'minContextSlot',
          'sortResults',
          'withContext',
        ]) &&
      JSON.stringify(programAccounts.unsupportedConfig) === JSON.stringify(['encoding:jsonParsed']),
    'native getProgramAccounts semantics or resource limits are stale',
  );
  assert(
    lock.downstream.validatorBinary === 'firedancer' &&
      lock.downstream.developmentBinary === 'firedancer-dev',
    'only the native Firedancer binaries may be configured',
  );
  assert(
    lock.downstream.versionMarker === 'WokeNet Firedancer downstream-v1',
    'the downstream binary version marker is missing or unexpected',
  );
  const requiredForbiddenBinaries = ['agave-validator', 'fdctl', 'fddev', 'solana-test-validator'];
  assert(
    Array.isArray(lock.downstream.forbiddenRuntimeBinaries) &&
      new Set(lock.downstream.forbiddenRuntimeBinaries).size ===
        lock.downstream.forbiddenRuntimeBinaries.length &&
      requiredForbiddenBinaries.every((binary) =>
        lock.downstream.forbiddenRuntimeBinaries.includes(binary),
      ),
    'forbidden runtime binary policy is incomplete or duplicated',
  );
  assert(
    Array.isArray(lock.downstream.patches) &&
      lock.downstream.patches.length === 8 &&
      JSON.stringify(lock.downstream.patches.map(({ path }) => path)) ===
        JSON.stringify([
          'patches/0001-explicit-sovereign-genesis-allocations.patch',
          'patches/0002-native-get-program-accounts.patch',
          'patches/0003-wokenet-live-cluster-safety.patch',
          'patches/0004-native-non-voting-rpc-observer.patch',
          'patches/0005-native-c-test-execution-fixes.patch',
          'patches/0006-wokenet-preserve-replay-execution-result-metadata.patch',
          'patches/0007-wokenet-live-signature-status-cache-core.patch',
          'patches/0008-wokenet-preserve-snapshot-transaction-result-metadata.patch',
        ]),
    'the exact ordered eight-patch downstream queue is not pinned',
  );
  for (const patch of lock.downstream.patches) {
    assert(
      typeof patch.path === 'string' && /^[0-9A-Za-z][0-9A-Za-z._/-]*$/u.test(patch.path),
      'invalid downstream patch path',
    );
    assert(/^[0-9a-f]{64}$/u.test(patch.sha256), `invalid checksum for ${patch.path}`);
    const patchPath = resolvePatch(patch.path);
    assert(existsSync(patchPath), `missing patch ${patch.path}`);
    assert(sha256(patchPath) === patch.sha256, `checksum mismatch for ${patch.path}`);
  }
  return { capabilities, lock };
}

function stripTomlComment(line) {
  let quote;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
    } else if (quote === "'") {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '#') {
      return line.slice(0, index);
    }
  }
  assert(quote === undefined, 'unterminated string in TOML');
  return line;
}

function splitTomlArray(value) {
  const entries = [];
  let start = 0;
  let quote;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
    } else if (quote === "'") {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ',') {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  assert(quote === undefined, 'unterminated string in TOML array');
  entries.push(value.slice(start).trim());
  return entries.filter((entry) => entry.length > 0);
}

function parseTomlValue(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      fail(`invalid TOML string ${value}`);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^[+-]?[0-9](?:_?[0-9])*$/u.test(value)) {
    return BigInt(value.replaceAll('_', ''));
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitTomlArray(value.slice(1, -1)).map(parseTomlValue);
  }
  fail(`unsupported TOML value ${value}`);
}

function parseToml(path) {
  const values = new Map();
  let table = '';
  const lines = readFileSync(path, 'utf8').split(/\r?\n/u);
  for (const [lineIndex, sourceLine] of lines.entries()) {
    const line = stripTomlComment(sourceLine).trim();
    if (line.length === 0) continue;
    const tableMatch = /^\[([0-9A-Za-z_-]+(?:\.[0-9A-Za-z_-]+)*)\]$/u.exec(line);
    if (tableMatch) {
      table = tableMatch[1];
      continue;
    }
    const assignment = /^([0-9A-Za-z_-]+)\s*=\s*(.+)$/u.exec(line);
    assert(
      assignment,
      `unsupported TOML syntax at ${relative(repositoryRoot, path)}:${lineIndex + 1}`,
    );
    const key = table.length > 0 ? `${table}.${assignment[1]}` : assignment[1];
    assert(!values.has(key), `duplicate TOML key ${key}`);
    values.set(key, parseTomlValue(assignment[2].trim()));
  }
  return values;
}

function tomlValue(values, key) {
  assert(values.has(key), `TOML key ${key} is missing`);
  return values.get(key);
}

function assertTomlValue(values, key, expected, context) {
  const actual = tomlValue(values, key);
  const matches =
    typeof expected === 'bigint'
      ? actual === expected
      : Array.isArray(expected)
        ? Array.isArray(actual) &&
          actual.length === expected.length &&
          actual.every((item, index) => item === expected[index])
        : actual === expected;
  assert(matches, `${context} has an invalid ${key}`);
}

function checkStatic() {
  const { lock } = loadPolicy();
  const genesisPolicy = readJson(genesisPolicyPath);
  assert(genesisPolicy.schemaVersion === 1, 'unsupported genesis-policy schema');
  assert(
    genesisPolicy.networkName === 'WokeNet' &&
      genesisPolicy.nativeCurrency?.name === 'WOKE' &&
      genesisPolicy.nativeCurrency?.ticker === 'WOKE' &&
      genesisPolicy.nativeCurrency?.decimals === 9 &&
      genesisPolicy.nativeCurrency?.baseUnitsPerWoke === '1000000000' &&
      genesisPolicy.nativeCurrency?.wireBaseUnit === 'lamport' &&
      genesisPolicy.nativeCurrency?.isSPLToken === false,
    'native WOKE unit policy is inconsistent',
  );
  assert(
    BigInt(genesisPolicy.nativeCurrency.baseUnitsPerWoke) ===
      10n ** BigInt(genesisPolicy.nativeCurrency.decimals),
    'native WOKE decimal and base-unit policies disagree',
  );
  assert(
    genesisPolicy.production?.genesisApproved === false &&
      genesisPolicy.production?.supplyApproved === false &&
      genesisPolicy.production?.inflationApproved === false &&
      genesisPolicy.production?.allocationApproved === false &&
      genesisPolicy.production?.liveClusterActivationApproved === false &&
      genesisPolicy.production?.publicSaleConfigured === false &&
      genesisPolicy.production?.legalReviewComplete === false,
    'production genesis must remain locked pending explicit reviews',
  );
  assert(
    Object.values(genesisPolicy.production).every((value) => value === false),
    'every production activation decision must remain false',
  );

  const localConfig = parseToml(join(networkRoot, 'config', 'localnet.toml'));
  const localContext = 'localnet.toml';
  assertTomlValue(localConfig, 'name', 'wokenet-local', localContext);
  assertTomlValue(localConfig, 'telemetry', false, localContext);
  assertTomlValue(localConfig, 'gossip.entrypoints', [], localContext);
  assertTomlValue(localConfig, 'snapshots.genesis_download', false, localContext);
  assertTomlValue(localConfig, 'snapshots.sources.servers', [], localContext);
  assertTomlValue(localConfig, 'snapshots.sources.gossip.allow_any', false, localContext);
  assertTomlValue(localConfig, 'snapshots.sources.gossip.allow_list', [], localContext);
  assertTomlValue(localConfig, 'tiles.gui.enabled', false, localContext);
  assertTomlValue(localConfig, 'tiles.rpc.enabled', true, localContext);
  assertTomlValue(localConfig, 'tiles.rpc.rpc_listen_address', '127.0.0.1', localContext);
  assertTomlValue(localConfig, 'consensus.wokenet_live_cluster', false, localContext);
  assertTomlValue(localConfig, 'development.sandbox', true, localContext);
  assertTomlValue(localConfig, 'development.no_agave', true, localContext);
  assertTomlValue(
    localConfig,
    'development.genesis.creation_time_unix_seconds',
    BigInt(genesisPolicy.localnet.creationTimeUnixSeconds),
    localContext,
  );
  assertTomlValue(
    localConfig,
    'development.genesis.faucet_balance_lamports',
    BigInt(genesisPolicy.localnet.faucetLamports),
    localContext,
  );
  assertTomlValue(
    localConfig,
    'development.genesis.identity_balance_lamports',
    BigInt(genesisPolicy.localnet.bootstrapIdentityLamports),
    localContext,
  );
  assertTomlValue(
    localConfig,
    'development.genesis.vote_account_stake_lamports',
    BigInt(genesisPolicy.localnet.bootstrapStakeLamports),
    localContext,
  );
  assertTomlValue(
    localConfig,
    'development.genesis.fund_initial_accounts',
    BigInt(genesisPolicy.localnet.wellKnownFundedAccountCount),
    localContext,
  );
  assertTomlValue(
    localConfig,
    'development.genesis.fund_initial_amount_lamports',
    0n,
    localContext,
  );

  for (const [template, name, rpcEnabled] of [
    ['validator.toml.example', 'wokenet-validator-01', false],
    ['rpc.toml.example', 'wokenet-rpc-01', true],
  ]) {
    const config = parseToml(join(networkRoot, 'config', template));
    assertTomlValue(config, 'name', name, template);
    assertTomlValue(config, 'telemetry', false, template);
    assertTomlValue(
      config,
      'gossip.entrypoints',
      ['entrypoint-01.network.woke.social:8001', 'entrypoint-02.network.woke.social:8001'],
      template,
    );
    assertTomlValue(config, 'snapshots.genesis_download', false, template);
    assertTomlValue(
      config,
      'snapshots.sources.servers',
      ['https://snapshot-01.network.woke.social:443'],
      template,
    );
    assertTomlValue(config, 'snapshots.sources.gossip.allow_any', false, template);
    assertTomlValue(
      config,
      'snapshots.sources.gossip.allow_list',
      ['REPLACE_WITH_TRUSTED_SNAPSHOT_VALIDATOR_PUBLIC_KEY'],
      template,
    );
    assertTomlValue(
      config,
      'consensus.expected_genesis_hash',
      'REPLACE_WITH_CEREMONY_GENESIS_HASH',
      template,
    );
    assertTomlValue(config, 'consensus.expected_shred_version', 0n, template);
    assertTomlValue(config, 'consensus.wokenet_live_cluster', true, template);
    assertTomlValue(config, 'tiles.gui.enabled', false, template);
    assertTomlValue(config, 'tiles.rpc.enabled', rpcEnabled, template);
    if (rpcEnabled) {
      assertTomlValue(config, 'tiles.rpc.rpc_listen_address', '127.0.0.1', template);
      assertTomlValue(config, 'layout.enable_block_production', false, template);
      assert(
        !config.has('paths.vote_account'),
        `${template} must keep paths.vote_account empty for the non-voting observer role`,
      );
      assert(
        !config.has('paths.authorized_voter_paths'),
        `${template} must not configure authorized voters for the non-voting observer role`,
      );
    }
    assertTomlValue(config, 'development.sandbox', true, template);
    assertTomlValue(config, 'development.no_clone', false, template);
    assertTomlValue(config, 'development.no_agave', true, template);
    assertTomlValue(config, 'development.genesis.validate_genesis_hash', true, template);
    assertTomlValue(config, 'development.bench.larger_max_cost_per_block', false, template);
    assertTomlValue(config, 'development.bench.larger_shred_limits_per_block', false, template);
    assertTomlValue(config, 'development.bench.disable_blockstore_from_slot', 0n, template);
    assertTomlValue(config, 'development.bench.disable_status_cache', false, template);
  }

  process.stdout.write(
    `WokeNet policy is internally consistent at Firedancer ${lock.upstream.commit}.\n`,
  );
}

function nativeBuildLine(sourceRoot, binary) {
  const localMakePath =
    binary === 'firedancer'
      ? join(sourceRoot, 'src', 'app', 'firedancer', 'Local.mk')
      : join(sourceRoot, 'src', 'app', 'firedancer-dev', 'Local.mk');
  const lines = readFileSync(localMakePath, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.includes(`make-bin,${binary},`));
  assert(lines.length === 1, `expected exactly one ${binary} native build declaration`);
  return lines[0];
}

function sourceState(sourceRoot, lock) {
  assert(isAbsolute(sourceRoot), 'source path must be absolute');
  assert(existsSync(join(sourceRoot, '.git')), 'source path is not a Git checkout');
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot });
  assert(
    head === lock.upstream.commit,
    `source HEAD ${head} does not match ${lock.upstream.commit}`,
  );
  const origin = run('git', ['remote', 'get-url', 'origin'], { cwd: sourceRoot });
  assert(origin === lock.upstream.repository, `source origin ${origin} is not the pinned upstream`);
  const commitTimestamp = run('git', ['show', '-s', '--format=%cI', 'HEAD'], {
    cwd: sourceRoot,
  });
  assert(
    Date.parse(commitTimestamp) === Date.parse(lock.upstream.commitTimestamp),
    `source commit timestamp ${commitTimestamp} does not match ${lock.upstream.commitTimestamp}`,
  );
  const rpcSource = readFileSync(join(sourceRoot, 'src', 'discof', 'rpc', 'fd_rpc_tile.c'), 'utf8');
  for (const method of [
    'getSignaturesForAddress',
    'getSignatureStatuses',
    'getTransaction',
    'sendTransaction',
    'simulateTransaction',
  ]) {
    assert(
      rpcSource.includes(`UNIMPLEMENTED(${method})`),
      `capability evidence is stale: ${method} is no longer marked unimplemented`,
    );
  }
  assert(
    !rpcSource.includes('UNIMPLEMENTED(getProgramAccounts)') &&
      rpcSource.includes('fd_accdb_scan_owner_nocache(') &&
      rpcSource.includes('fd_rpc_program_scan_visit'),
    'native getProgramAccounts implementation evidence is missing',
  );
  const rpcTestSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'rpc', 'test_rpc_tile.c'),
    'utf8',
  );
  const accdbTestSource = readFileSync(
    join(sourceRoot, 'src', 'flamenco', 'accdb', 'test_accdb.c'),
    'utf8',
  );
  assert(
    rpcTestSource.includes('-- getProgramAccounts --') &&
      rpcTestSource.includes('method\\":\\"getProgramAccounts') &&
      accdbTestSource.includes('test_scan_owner_nocache'),
    'native getProgramAccounts C conformance tests are missing',
  );
  const configSource = readFileSync(
    join(sourceRoot, 'src', 'app', 'shared', 'fd_config.c'),
    'utf8',
  );
  const configHeader = readFileSync(
    join(sourceRoot, 'src', 'app', 'shared', 'fd_config.h'),
    'utf8',
  );
  const configParser = readFileSync(
    join(sourceRoot, 'src', 'app', 'shared', 'fd_config_parse.c'),
    'utf8',
  );
  const configTestSource = readFileSync(
    join(sourceRoot, 'src', 'app', 'shared', 'test_config_parse.c'),
    'utf8',
  );
  const defaultConfigSource = readFileSync(
    join(sourceRoot, 'src', 'app', 'firedancer', 'config', 'default.toml'),
    'utf8',
  );
  const compatibilityDefaultConfigSource = readFileSync(
    join(sourceRoot, 'src', 'app', 'fdctl', 'config', 'default.toml'),
    'utf8',
  );
  const topologySource = readFileSync(
    join(sourceRoot, 'src', 'app', 'firedancer', 'topology.c'),
    'utf8',
  );
  const topoHeader = readFileSync(join(sourceRoot, 'src', 'disco', 'topo', 'fd_topo.h'), 'utf8');
  const genesisTileSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'genesis', 'fd_genesi_tile.c'),
    'utf8',
  );
  const towerTileSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'tower', 'fd_tower_tile.c'),
    'utf8',
  );
  const towerTestSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'tower', 'test_tower_tile.c'),
    'utf8',
  );
  const execrpHeader = readFileSync(
    join(sourceRoot, 'src', 'discof', 'replay', 'fd_execrp.h'),
    'utf8',
  );
  const execrpTileSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'execrp', 'fd_execrp_tile.c'),
    'utf8',
  );
  const execrpTestSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'execrp', 'test_execrp_tile.c'),
    'utf8',
  );
  const schedulerSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'replay', 'fd_sched.c'),
    'utf8',
  );
  const schedulerHeader = readFileSync(
    join(sourceRoot, 'src', 'discof', 'replay', 'fd_sched.h'),
    'utf8',
  );
  const schedulerTestSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'replay', 'test_sched.c'),
    'utf8',
  );
  const replayTileSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'replay', 'fd_replay_tile.c'),
    'utf8',
  );
  const replayTileHeader = readFileSync(
    join(sourceRoot, 'src', 'discof', 'replay', 'fd_replay_tile.h'),
    'utf8',
  );
  const replayTestSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'replay', 'test_replay_tile.c'),
    'utf8',
  );
  const sigstatuscacheHeader = readFileSync(
    join(sourceRoot, 'src', 'flamenco', 'runtime', 'fd_sigstatuscache.h'),
    'utf8',
  );
  const sigstatuscacheSource = readFileSync(
    join(sourceRoot, 'src', 'flamenco', 'runtime', 'fd_sigstatuscache.c'),
    'utf8',
  );
  const sigstatuscacheTestSource = readFileSync(
    join(sourceRoot, 'src', 'flamenco', 'runtime', 'test_sigstatuscache.c'),
    'utf8',
  );
  const slotDeltaParserHeader = readFileSync(
    join(sourceRoot, 'src', 'discof', 'restore', 'utils', 'fd_slot_delta_parser.h'),
    'utf8',
  );
  const slotDeltaParserSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'restore', 'utils', 'fd_slot_delta_parser.c'),
    'utf8',
  );
  const slotDeltaParserTestSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'restore', 'utils', 'test_slot_delta_parser.c'),
    'utf8',
  );
  const snapinTileSource = readFileSync(
    join(sourceRoot, 'src', 'discof', 'restore', 'fd_snapin_tile.c'),
    'utf8',
  );
  const clusterHeader = readFileSync(
    join(sourceRoot, 'src', 'disco', 'genesis', 'fd_genesis_cluster.h'),
    'utf8',
  );
  assert(
    configHeader.includes('int    wokenet_live_cluster;') &&
      configParser.includes('CFG_POP      ( bool,   consensus.wokenet_live_cluster') &&
      defaultConfigSource.includes('wokenet_live_cluster = false') &&
      configSource.includes('fd_config_wokenet_live_policy_check(') &&
      configSource.includes('!is_local_cluster && !dev && cluster==FD_CLUSTER_UNKNOWN') &&
      configSource.includes('return FD_CONFIG_WOKENET_LIVE_ERR_MODE_REQUIRED;') &&
      configSource.includes('fd_config_classify_cluster( config, is_local_cluster, dev );') &&
      configSource.includes('config->consensus.expected_genesis_hash') &&
      configSource.includes('config->is_live_cluster = 1;') &&
      configSource.includes('strcpy( config->cluster, "wokenet" );') &&
      !clusterHeader.includes('FD_CLUSTER_WOKENET'),
    'WokeNet live-cluster classification is missing or changes protocol cluster identity',
  );
  assert(
    topologySource.includes(
      'tile->genesi.has_expected_genesis_hash = !!strcmp( config->consensus.expected_genesis_hash, "" );',
    ) &&
      topologySource.includes(
        'fd_base58_decode_32( config->consensus.expected_genesis_hash, tile->genesi.expected_genesis_hash )',
      ) &&
      genesisTileSource.includes(
        'ctx->has_expected_genesis_hash && memcmp( ctx->genesis_hash, ctx->expected_genesis_hash, 32UL )',
      ),
    'WokeNet live mode is not bound to the exact genesis bytes enforced by the genesi tile',
  );
  assert(
    topologySource.includes('fd_topob_tile( topo, "tower",   "tower"') &&
      topoHeader.includes('int   is_voting;') &&
      topoHeader.includes('int   vote_observer;') &&
      topologySource.includes(
        `tile->tower.vote_observer      = config->consensus.wokenet_live_cluster &&
                                     !config->firedancer.layout.enable_block_production &&
                                     config->tiles.rpc.enabled &&
                                     !tile->tower.is_voting &&
                                     !config->firedancer.paths.authorized_voter_paths_cnt;`,
      ) &&
      topologySource.includes(
        'tile->tower.is_voting          = !!config->paths.vote_account[ 0 ];',
      ) &&
      configSource.includes(
        'config->firedancer.layout.enable_block_production || !config->tiles.rpc.enabled',
      ) &&
      configSource.includes('config->firedancer.paths.authorized_voter_paths_cnt') &&
      towerTileSource.includes(
        'int found_authority  = ctx->is_voting && found && vote_account_config(',
      ) &&
      towerTileSource.includes('if( FD_UNLIKELY( !ctx->is_voting ) ) {') &&
      towerTileSource.includes('ctx->our_vote_acct_sz = 0UL;') &&
      towerTileSource.includes(
        'reconcile_our_vote_account( ctx, bank, slot_completed, found_our_vote_acct, our_vote_acct_bal );',
      ) &&
      towerTileSource.includes('fd_tower_vote_and_reset(') &&
      towerTileSource.includes('FD_TEST( ctx->is_voting!=ctx->vote_observer );') &&
      towerTestSource.includes('test_observer_skips_vote_account_reconcile();') &&
      towerTestSource.includes('pub->msg.slot_done.has_vote_txn==0') &&
      towerTestSource.includes('FD_TEST( ctx->vote_observer );') &&
      towerTestSource.includes('FD_TEST( slot_done_cnt==num_slots );') &&
      towerTestSource.includes('FD_TEST( virtual_vote_cnt );') &&
      towerTestSource.includes('FD_TEST( new_root_cnt );') &&
      towerTestSource.includes('FD_TEST( ctx->tower->root>start_slot );') &&
      towerTestSource.includes('slot<ctx->tower->root') &&
      towerTestSource.includes('slot>=ctx->tower->root') &&
      towerTestSource.includes('test_wksp_new_mmap(') &&
      towerTestSource.includes('fd_votes_update_voters( ctx->votes') &&
      compatibilityDefaultConfigSource.includes('faucet_balance_lamports = 500000000000000000') &&
      compatibilityDefaultConfigSource.includes('identity_balance_lamports = 500000000000'),
    'native WokeNet non-voting RPC observer policy, topology, tower, or direct C tests changed',
  );
  assert(
    execrpHeader.includes('struct fd_execrp_txn_exec_done_msg') &&
      execrpHeader.includes('int exec_err;') &&
      execrpHeader.includes('int exec_err_kind;') &&
      execrpHeader.includes('uint exec_err_idx;') &&
      execrpHeader.includes('uint custom_err;') &&
      execrpHeader.includes('struct fd_execrp_txn_sigverify_done_msg') &&
      execrpHeader.includes('ulong slot;') &&
      execrpHeader.includes('ulong bank_seq;') &&
      execrpTileSource.includes('msg->txn_exec->exec_err        = ctx->txn_out.err.exec_err;') &&
      execrpTileSource.includes('msg->txn_exec->custom_err      = ctx->txn_out.err.custom_err;') &&
      execrpTileSource.includes('out_msg->txn_sigverify->slot    = bank->f.slot;') &&
      execrpTileSource.includes('out_msg->txn_sigverify->bank_seq = bank->bank_seq;') &&
      execrpTestSource.includes('FD_UNIT_TEST( execrp_result_metadata )') &&
      execrpTestSource.includes('out_msg->txn_exec->custom_err==UINT_MAX') &&
      execrpTestSource.includes('out_msg->txn_sigverify->bank_seq==bank->bank_seq'),
    'native execrp completion identity, full result metadata, or direct C tests changed',
  );
  assert(
    schedulerHeader.includes('#define FD_SCHED_TXN_SIGVERIFY_FAIL (0x0010UL)') &&
      schedulerHeader.includes('fd_sched_txn_info_reset(') &&
      schedulerHeader.includes('.bank_seq            = ULONG_MAX,') &&
      schedulerHeader.includes('.tick_sigverify_disp = LONG_MAX,') &&
      schedulerHeader.includes('.tick_exec_done      = LONG_MAX,') &&
      schedulerHeader.includes('.exec_err_idx        = UINT_MAX,') &&
      schedulerHeader.includes('.custom_err          = 0U,') &&
      schedulerSource.includes('fd_sched_txn_info_reset( sched->txn_info_pool + txn_idx,') &&
      schedulerTestSource.includes('run_txn_info_reuse_case();') &&
      schedulerTestSource.includes('FD_TEST( info->bank_seq==ULONG_MAX );') &&
      schedulerTestSource.includes('FD_TEST( info->exec_err_idx==UINT_MAX );'),
    'native scheduler identity/result reset semantics or direct C test changed',
  );
  assert(
    replayTileHeader.includes('struct fd_replay_txn_executed') &&
      replayTileHeader.includes('ulong bank_seq;') &&
      replayTileHeader.includes('uint custom_err;') &&
      replayTileSource.includes('txn_info_validate_exec_identity(') &&
      replayTileSource.includes('txn_info_validate_sigverify_identity(') &&
      replayTileSource.includes('txn_info->txn_err = FD_RUNTIME_TXN_ERR_SIGNATURE_FAILURE;') &&
      replayTileSource.includes(
        'if( FD_UNLIKELY( txn_info->flags&FD_SCHED_TXN_SIGVERIFY_FAIL ) ) return;',
      ) &&
      replayTileSource.includes('txn_executed->bank_seq        = txn_info->bank_seq;') &&
      replayTileSource.includes('txn_executed->custom_err      = txn_info->custom_err;') &&
      replayTestSource.includes('test_txn_result_propagation();') &&
      replayTestSource.includes(
        'Execution before failed signature verification: signature failure',
      ) &&
      replayTestSource.includes(
        'Failed signature verification before execution: the later worker',
      ) &&
      replayTestSource.includes('executed->custom_err==UINT_MAX') &&
      replayTestSource.includes('info->txn_err==FD_RUNTIME_TXN_ERR_ACCOUNT_NOT_FOUND') &&
      replayTestSource.includes('info->exec_err_idx==UINT_MAX'),
    'native replay execution-result propagation, normalization, ordering, or C test changed',
  );
  assert(
    sigstatuscacheHeader.includes('V1 is a live replay-result cache core.') &&
      sigstatuscacheHeader.includes('#define FD_SIGSTATUSCACHE_ROOT_MAX         (300UL)') &&
      sigstatuscacheHeader.includes('FD_SIGSTATUSCACHE_QUERY_INCOMPLETE') &&
      sigstatuscacheHeader.includes('FD_SIGSTATUSCACHE_QUERY_AMBIGUOUS') &&
      sigstatuscacheHeader.includes('FD_SIGSTATUSCACHE_QUERY_AGAIN') &&
      sigstatuscacheHeader.includes('fd_sigstatuscache_bank_id_t child,') &&
      sigstatuscacheHeader.includes('fd_sigstatuscache_bank_dead(') &&
      sigstatuscacheHeader.includes('fd_sigstatuscache_publish_root(') &&
      sigstatuscacheSource.includes('fd_sigstatuscache_fail_incomplete(') &&
      sigstatuscacheSource.includes('FD_SIGSTATUSCACHE_BANK_DEAD') &&
      sigstatuscacheSource.includes(
        'atomic_fetch_add_explicit( &cache->publish_seq, 1UL, memory_order_relaxed );',
      ) &&
      sigstatuscacheTestSource.includes('test_forks_reuse_dead_and_prune();') &&
      sigstatuscacheTestSource.includes('test_compact_keys_and_results();') &&
      sigstatuscacheTestSource.includes('test_root_retention();') &&
      sigstatuscacheTestSource.includes('test_capacity_and_incomplete();') &&
      sigstatuscacheTestSource.includes('test_read_only_atomic_publication();') &&
      sigstatuscacheTestSource.includes('FD_SIGSTATUSCACHE_QUERY_INCOMPLETE') &&
      sigstatuscacheTestSource.includes('FD_SIGSTATUSCACHE_QUERY_AMBIGUOUS'),
    'native live signature-status cache core, fail-closed semantics, or direct C tests changed',
  );
  assert(
    slotDeltaParserHeader.includes(
      'FD_STATIC_ASSERT( sizeof(fd_sstxncache_entry_t)==64UL, sstxncache_entry_footprint );',
    ) &&
      slotDeltaParserHeader.includes(
        'FD_STATIC_ASSERT( sizeof(fd_sstxncache_txn_result_t)==32UL, sstxncache_txn_result_footprint );',
      ) &&
      slotDeltaParserHeader.includes(
        'FD_STATIC_ASSERT( sizeof(fd_slot_delta_parser_advance_result_t)==48UL, slot_delta_parser_advance_result_footprint );',
      ) &&
      slotDeltaParserHeader.includes('FD_SLOT_DELTA_PARSER_ADVANCE_BORSH_IO_ERROR_DATA') &&
      slotDeltaParserHeader.includes('FD_SLOT_DELTA_PARSER_ADVANCE_ERROR_INVALID_BORSH_IO_UTF8') &&
      slotDeltaParserSource.includes('utf8_consume(') &&
      slotDeltaParserSource.includes(
        'parser->state==STATE_CACHE_STATUS_RESULT_ERR_INSTR_ERR_BORSH_IO_DATA',
      ) &&
      slotDeltaParserTestSource.includes('test_all_supported_error_discriminants( parser );') &&
      slotDeltaParserTestSource.includes('test_borsh_then_next_entry( parser );') &&
      slotDeltaParserTestSource.includes(
        'test_multiple_slots_groups_and_empty_groups( parser );',
      ) &&
      snapinTileSource.includes(
        'metadata for a future shared status cache and is not retained here.',
      ) &&
      snapinTileSource.includes('advance==FD_SLOT_DELTA_PARSER_ADVANCE_BORSH_IO_ERROR_DATA'),
    'native snapshot result parser, streamed Borsh validation, bounded claims, or direct C tests changed',
  );
  for (const policyEvidence of [
    'FD_CONFIG_WOKENET_LIVE_OK',
    'FD_CONFIG_WOKENET_LIVE_ERR_NATIVE_FIREDANCER_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_PRODUCTION_MODE_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_NO_AGAVE_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_GENESIS_HASH_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_GENESIS_HASH_INVALID',
    'FD_CONFIG_WOKENET_LIVE_ERR_SOVEREIGN_HASH_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_SHRED_VERSION_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_GENESIS_VALIDATION_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_IDENTITY_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_SANDBOX_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_MULTIPROCESS_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_LARGER_BLOCK_COST_FORBIDDEN',
    'FD_CONFIG_WOKENET_LIVE_ERR_LARGER_SHREDS_FORBIDDEN',
    'FD_CONFIG_WOKENET_LIVE_ERR_BLOCKSTORE_BYPASS_FORBIDDEN',
    'FD_CONFIG_WOKENET_LIVE_ERR_STATUS_CACHE_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_MODE_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_VOTE_ACCOUNT_REQUIRED',
    'FD_CONFIG_WOKENET_LIVE_ERR_OBSERVER_VOTERS_FORBIDDEN',
  ]) {
    assert(
      configSource.includes(policyEvidence) && configTestSource.includes(policyEvidence),
      `native WokeNet live-cluster policy or C test is missing ${policyEvidence}`,
    );
  }
  assert(
    configTestSource.includes('test_wokenet_live_policy( config );') &&
      configTestSource.includes('test_wokenet_live_vote_roles( config );') &&
      configTestSource.includes('static char const cfg_str_3[]') &&
      configTestSource.includes('config->consensus.expected_shred_version==1') &&
      configTestSource.includes('fd_config_classify_cluster( config, 0, 0 );') &&
      configTestSource.includes('!strcmp( config->cluster, "wokenet" )'),
    'native WokeNet live-cluster C parser, policy, or classification test is not executed',
  );
  for (const binary of [lock.downstream.validatorBinary, lock.downstream.developmentBinary]) {
    const buildLine = nativeBuildLine(sourceRoot, binary);
    const linkTokens = buildLine.split(/[,\s)]+/u);
    for (const forbiddenBinary of lock.downstream.forbiddenRuntimeBinaries) {
      const forbiddenToken = forbiddenBinary.replaceAll('-', '_');
      assert(
        !linkTokens.includes(forbiddenToken),
        `${binary} unexpectedly links forbidden runtime ${forbiddenBinary}`,
      );
    }
  }
  const nativeMain = readFileSync(join(sourceRoot, 'src', 'app', 'firedancer', 'main.c'), 'utf8');
  const developmentMain = readFileSync(
    join(sourceRoot, 'src', 'app', 'firedancer-dev', 'main.c'),
    'utf8',
  );
  const developmentMainHeader = readFileSync(
    join(sourceRoot, 'src', 'app', 'firedancer-dev', 'main.h'),
    'utf8',
  );
  assert(nativeMain.includes('fd_main( argc, argv, 1,'), 'firedancer is not in native mode');
  assert(
    developmentMain.includes('fd_dev_main( argc, argv, 1,') &&
      developmentMainHeader.includes('&fd_action_mem,'),
    'firedancer-dev is not in native mode or cannot attest localnet through mem',
  );
}

function expectedPatchedDiff(sourceRoot, lock) {
  const temporaryRoot = mkdtempSync(join(trustedTemporaryRoot, 'wokenet-firedancer-index-'));
  const temporaryIndex = join(temporaryRoot, 'index');
  const env = { GIT_INDEX_FILE: temporaryIndex };
  try {
    run('git', ['read-tree', lock.upstream.commit], { cwd: sourceRoot, env });
    for (const patch of lock.downstream.patches) {
      run('git', ['apply', '--cached', resolvePatch(patch.path)], {
        cwd: sourceRoot,
        env,
      });
    }
    return run(
      'git',
      ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', lock.upstream.commit, '--'],
      { cwd: sourceRoot, env },
    );
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function actualWorkingTreeDiff(sourceRoot, lock) {
  const temporaryRoot = mkdtempSync(join(trustedTemporaryRoot, 'wokenet-firedancer-worktree-'));
  const temporaryIndex = join(temporaryRoot, 'index');
  const env = { GIT_INDEX_FILE: temporaryIndex };
  try {
    run('git', ['read-tree', lock.upstream.commit], { cwd: sourceRoot, env });
    run('git', ['add', '--all', '--', '.'], { cwd: sourceRoot, env });
    run('git', ['diff', '--cached', '--check'], { cwd: sourceRoot, env });
    return run(
      'git',
      ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', lock.upstream.commit, '--'],
      { cwd: sourceRoot, env },
    );
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function checkSource(sourceRoot) {
  const { lock } = loadPolicy();
  sourceState(sourceRoot, lock);
  const expectedDiff = expectedPatchedDiff(sourceRoot, lock);
  const actualDiff = actualWorkingTreeDiff(sourceRoot, lock);

  assert(actualDiff.length > 0, 'source is missing the pinned downstream patch queue');
  assert(
    actualDiff === expectedDiff,
    'source changes do not exactly match the pinned downstream patch queue',
  );
  run('git', ['diff', '--check'], { cwd: sourceRoot });
  process.stdout.write(`WokeNet Firedancer source is patched at ${lock.upstream.commit}.\n`);
}

function firedancerVersion(sourceRoot) {
  const versionSource = readFileSync(
    join(sourceRoot, 'src', 'app', 'firedancer', 'version.mk'),
    'utf8',
  );
  const component = (name) => {
    const match = new RegExp(`^FD_VERSION_${name} := ([0-9]+)$`, 'mu').exec(versionSource);
    assert(match, `Firedancer ${name.toLowerCase()} version is missing`);
    return match[1];
  };
  return `${component('MAJOR')}.${component('MINOR')}.${component('PATCH')}`;
}

function inspectBinaries(sourceRoot, objectRoot, lock) {
  const resolvedSourceRoot = realpathSync(sourceRoot);
  const resolvedObjectRoot = realpathSync(objectRoot);
  assert(
    resolvedObjectRoot.startsWith(`${resolvedSourceRoot}${sep}`),
    'Firedancer object directory escapes the source checkout',
  );
  const manifest = {
    schemaVersion: 1,
    upstreamCommit: lock.upstream.commit,
    downstreamVersionMarker: lock.downstream.versionMarker,
    nativeMode: true,
    binaries: [],
  };
  const version = firedancerVersion(sourceRoot);
  const expectedVersionOutput = `${lock.downstream.versionMarker} ${version} (${lock.upstream.commit})`;
  const binaryDigests = new Set();
  const commonNativeSymbols = [
    { name: 'fd_tile_replay', type: 'OBJECT' },
    { name: 'fd_tile_execrp', type: 'OBJECT' },
    { name: 'fd_tile_rpc', type: 'OBJECT' },
  ];
  for (const binary of [lock.downstream.validatorBinary, lock.downstream.developmentBinary]) {
    const binaryPath = join(resolvedObjectRoot, 'bin', binary);
    assert(existsSync(binaryPath), `missing built binary ${binaryPath}`);
    assert(
      realpathSync(binaryPath) === binaryPath,
      `${binary} must be a regular in-tree build output, not a symlink`,
    );
    const metadata = statSync(binaryPath);
    assert(metadata.isFile() && (metadata.mode & 0o111) !== 0, `${binary} is not executable`);
    const fileDescription = run('file', ['--brief', binaryPath]);
    assert(fileDescription.includes('ELF'), `${binary} is not an ELF binary`);
    const elfHeader = run('readelf', ['--file-header', '--wide', binaryPath]);
    assert(/\bClass:\s+ELF64\b/u.test(elfHeader), `${binary} is not an ELF64 binary`);
    assert(
      /\bData:\s+2's complement, little endian\b/u.test(elfHeader),
      `${binary} does not use the required little-endian ELF encoding`,
    );
    assert(/\bType:\s+(?:EXEC|DYN)\b/u.test(elfHeader), `${binary} is not an executable ELF image`);
    assert(
      /\bMachine:\s+Advanced Micro Devices X86-64\b/u.test(elfHeader),
      `${binary} does not target Linux x86-64`,
    );
    const versionOutput = run(binaryPath, ['--version'], { cwd: sourceRoot });
    assert(
      versionOutput === expectedVersionOutput,
      `${binary} version output does not attest the pinned downstream source`,
    );
    const symbolTable = run('readelf', ['--symbols', '--wide', binaryPath]);
    const symbols = symbolTable
      .split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u))
      .filter((fields) => fields.length >= 8 && /^\d+:$/u.test(fields[0]))
      .map((fields) => ({
        type: fields[3],
        binding: fields[4],
        sectionIndex: fields[6],
        name: fields[7].split('@')[0],
      }));
    const requiredSymbols = [
      ...commonNativeSymbols,
      ...(binary === lock.downstream.validatorBinary
        ? [{ name: 'fd_main', type: 'FUNC' }]
        : [
            { name: 'fd_dev_main', type: 'FUNC' },
            { name: 'firedancer_dev_dev_cmd_fn', type: 'FUNC' },
          ]),
    ];
    for (const symbol of requiredSymbols) {
      assert(
        symbols.some(
          (entry) =>
            entry.name === symbol.name &&
            entry.type === symbol.type &&
            entry.binding === 'GLOBAL' &&
            entry.sectionIndex !== 'UND',
        ),
        `${binary} is missing defined global native Firedancer ${symbol.type.toLowerCase()} ${symbol.name}`,
      );
    }
    assert(
      !symbols.some((entry) => entry.name.startsWith('fd_sigstatuscache_')),
      `${binary} unexpectedly links the dormant signature-status cache core without a caller`,
    );
    const dynamicSection = run('readelf', ['--dynamic', '--wide', binaryPath]);
    for (const forbiddenBinary of lock.downstream.forbiddenRuntimeBinaries) {
      assert(
        !dynamicSection.toLowerCase().includes(forbiddenBinary.toLowerCase()),
        `${binary} has a forbidden dynamic dependency on ${forbiddenBinary}`,
      );
    }
    assert(
      !dynamicSection.includes('agave_validator'),
      `${binary} has a forbidden Agave validator dependency`,
    );
    const digest = sha256(binaryPath);
    assert(!binaryDigests.has(digest), 'native validator and development binaries are identical');
    binaryDigests.add(digest);
    manifest.binaries.push({
      name: binary,
      bytes: metadata.size,
      sha256: digest,
      format: fileDescription,
      elf: {
        class: 'ELF64',
        data: "2's complement, little endian",
        machine: 'Advanced Micro Devices X86-64',
      },
      requiredNativeSymbols: requiredSymbols.map(({ name }) => name),
      requiredNativeSymbolTypes: Object.fromEntries(
        requiredSymbols.map(({ name, type }) => [name, type]),
      ),
      versionOutput,
    });
  }
  return manifest;
}

function assertFreshPatchedCheckout(sourceRoot, lock) {
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot });
  assert(
    head === lock.upstream.commit,
    `fresh build checkout HEAD ${head} does not match ${lock.upstream.commit}`,
  );
  const expectedDiff = expectedPatchedDiff(sourceRoot, lock);
  const actualDiff = actualWorkingTreeDiff(sourceRoot, lock);
  assert(
    actualDiff === expectedDiff,
    'fresh build checkout does not exactly match the pinned downstream patch queue',
  );
  run('git', ['diff', '--check'], { cwd: sourceRoot });
}

function verifyOpenSslSource(sourceRoot, lock) {
  const dependency = lock.buildDependencies.openssl;
  const dependencyRoot = join(sourceRoot, 'opt', 'git', 'openssl');
  assert(
    existsSync(dependencyRoot),
    'the pinned OpenSSL source is missing; run ./deps.sh fetch first',
  );
  const metadata = lstatSync(dependencyRoot);
  assert(
    metadata.isDirectory() && !metadata.isSymbolicLink(),
    'the pinned OpenSSL source must be a real directory',
  );
  const resolvedSourceRoot = realpathSync(sourceRoot);
  const resolvedDependencyRoot = realpathSync(dependencyRoot);
  assert(
    resolvedDependencyRoot.startsWith(`${resolvedSourceRoot}${sep}`),
    'the pinned OpenSSL source escapes the supplied checkout',
  );
  assert(
    existsSync(join(resolvedDependencyRoot, '.git')),
    'the OpenSSL source is not a Git checkout',
  );
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: resolvedDependencyRoot });
  assert(
    head === dependency.commit,
    `OpenSSL source HEAD ${head} does not match ${dependency.commit}`,
  );
  const origin = run('git', ['remote', 'get-url', 'origin'], { cwd: resolvedDependencyRoot });
  assert(
    origin === dependency.repository,
    `OpenSSL source origin ${origin} is not pinned upstream`,
  );
  const resolvedTag = run('git', ['rev-list', '-n', '1', dependency.tag], {
    cwd: resolvedDependencyRoot,
  });
  assert(
    resolvedTag === dependency.commit,
    `OpenSSL tag ${dependency.tag} does not resolve to ${dependency.commit}`,
  );
  const dependencyLine = `checkout_repo openssl   ${dependency.repository}          "${dependency.tag}"`;
  assert(
    readFileSync(join(sourceRoot, 'deps.sh'), 'utf8').includes(dependencyLine),
    'Firedancer deps.sh no longer matches the pinned OpenSSL source',
  );
  return { dependency, resolvedDependencyRoot };
}

function installFreshOpenSsl(freshSourceRoot, dependencySource) {
  const freshDependencyParent = join(freshSourceRoot, 'opt', 'git');
  mkdirSync(freshDependencyParent, { recursive: true });
  const freshDependencyRoot = join(freshDependencyParent, 'openssl');
  run(
    'git',
    [
      'clone',
      '--local',
      '--no-hardlinks',
      '--no-checkout',
      '--',
      dependencySource.resolvedDependencyRoot,
      freshDependencyRoot,
    ],
    { cwd: freshDependencyParent },
  );
  run('git', ['checkout', '--detach', dependencySource.dependency.commit], {
    cwd: freshDependencyRoot,
  });
  assert(
    run('git', ['rev-parse', 'HEAD'], { cwd: freshDependencyRoot }) ===
      dependencySource.dependency.commit,
    'fresh OpenSSL checkout is not at the pinned commit',
  );
  assert(
    run('git', ['diff', '--binary', '--full-index', '--no-ext-diff', 'HEAD', '--'], {
      cwd: freshDependencyRoot,
    }) === '',
    'fresh OpenSSL checkout contains tracked changes before its build',
  );
  assert(
    run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: freshDependencyRoot }) === '',
    'fresh OpenSSL checkout contains untracked files before its build',
  );
  run('bash', ['./deps.sh', 'install'], { cwd: freshSourceRoot, stdio: 'inherit' });

  const includePath = join(freshSourceRoot, 'opt', 'include', 'openssl', 'opensslv.h');
  const cryptoPath = join(freshSourceRoot, 'opt', 'lib', 'libcrypto.a');
  const sslPath = join(freshSourceRoot, 'opt', 'lib', 'libssl.a');
  for (const artifactPath of [includePath, cryptoPath, sslPath]) {
    assert(existsSync(artifactPath), `fresh OpenSSL install is missing ${artifactPath}`);
    const metadata = lstatSync(artifactPath);
    assert(
      metadata.isFile() && !metadata.isSymbolicLink(),
      `fresh OpenSSL artifact ${artifactPath} is not a regular file`,
    );
    assert(
      realpathSync(artifactPath).startsWith(`${realpathSync(freshSourceRoot)}${sep}`),
      `fresh OpenSSL artifact ${artifactPath} escaped the attestation checkout`,
    );
  }
  const versionHeader = readFileSync(includePath, 'utf8');
  assert(
    versionHeader.includes(`"OpenSSL ${dependencySource.dependency.tag.replace('openssl-', '')} `),
    'fresh OpenSSL headers do not contain the pinned release version',
  );
  for (const archivePath of [cryptoPath, sslPath]) {
    assert(
      run('file', ['--brief', archivePath]).includes('ar archive') &&
        run('ar', ['t', archivePath]).length > 0,
      `fresh OpenSSL static library ${archivePath} is invalid`,
    );
  }
  assert(
    run('git', ['diff', '--binary', '--full-index', '--no-ext-diff', 'HEAD', '--'], {
      cwd: freshDependencyRoot,
    }) === '',
    'the OpenSSL build modified pinned tracked dependency source',
  );
  return {
    name: 'OpenSSL',
    repository: dependencySource.dependency.repository,
    tag: dependencySource.dependency.tag,
    commit: dependencySource.dependency.commit,
    versionHeaderSha256: sha256(includePath),
    libcryptoSha256: sha256(cryptoPath),
    libsslSha256: sha256(sslPath),
  };
}

function checkBinaries(sourceRoot) {
  const { lock } = loadPolicy();
  checkSource(sourceRoot);
  assert(
    process.platform === 'linux' && process.arch === 'x64',
    'native binary attestation requires the supported Linux x64 build host',
  );
  const attestationUser = run('id', ['-un']);
  assert(
    run('id', ['-u']) !== '0' && run('id', ['-g']) !== '0',
    'native binary attestation must run as a non-root user and group',
  );

  const suppliedSourceRoot = realpathSync(sourceRoot);
  const dependencySource = verifyOpenSslSource(suppliedSourceRoot, lock);

  const attestationRoot = mkdtempSync(
    join(trustedTemporaryRoot, 'wokenet-firedancer-attestation-'),
  );
  const resolvedAttestationRoot = realpathSync(attestationRoot);
  assert(
    dirname(resolvedAttestationRoot) === realpathSync(trustedTemporaryRoot) &&
      basename(resolvedAttestationRoot).startsWith('wokenet-firedancer-attestation-'),
    'fresh attestation checkout escaped the temporary directory',
  );
  try {
    const freshSourceRoot = join(resolvedAttestationRoot, 'source');
    run(
      'git',
      [
        'clone',
        '--local',
        '--no-hardlinks',
        '--no-checkout',
        '--',
        suppliedSourceRoot,
        freshSourceRoot,
      ],
      { cwd: resolvedAttestationRoot },
    );
    run('git', ['checkout', '--detach', lock.upstream.commit], { cwd: freshSourceRoot });
    for (const patch of lock.downstream.patches) {
      run('git', ['apply', resolvePatch(patch.path)], { cwd: freshSourceRoot });
    }
    assertFreshPatchedCheckout(freshSourceRoot, lock);
    const openssl = installFreshOpenSsl(freshSourceRoot, dependencySource);

    const buildParent = join(freshSourceRoot, 'build');
    assert(!existsSync(buildParent), 'fresh attestation checkout unexpectedly contains build/');
    mkdirSync(buildParent);
    const buildParentMetadata = lstatSync(buildParent);
    assert(
      buildParentMetadata.isDirectory() && !buildParentMetadata.isSymbolicLink(),
      'fresh attestation build parent must be a real directory',
    );
    assert(
      realpathSync(buildParent) === buildParent,
      'fresh attestation build parent escaped its checkout',
    );
    const buildRoot = mkdtempSync(join(buildParent, 'wokenet-attestation-'));
    assert(
      realpathSync(buildRoot).startsWith(`${realpathSync(freshSourceRoot)}${sep}`),
      'fresh attestation object directory escaped its checkout',
    );
    const buildDirectory = basename(buildRoot);
    assert(
      run('git', ['check-ignore', '--quiet', buildRoot], { cwd: freshSourceRoot }) === '',
      'isolated attestation build directory must be ignored by Git',
    );
    const parallelism = String(Math.max(1, Math.min(availableParallelism(), 16)));
    const objectRootValue = run(
      'bash',
      [
        '-c',
        'source ./activate "BUILDDIR=$1" CC=gcc >/dev/null && printf "%s" "$OBJDIR"',
        '--',
        buildDirectory,
      ],
      { cwd: freshSourceRoot },
    );
    const objectRoot = resolve(freshSourceRoot, objectRootValue);
    assert(
      realpathSync(objectRoot) === realpathSync(buildRoot),
      'Firedancer build output escaped the fresh attestation directory',
    );
    const testInvocations = [
      { name: 'test_genesis_create', arguments: [] },
      { name: 'test_accdb', arguments: [] },
      { name: 'test_sigstatuscache', arguments: [] },
      { name: 'test_slot_delta_parser', arguments: [] },
      { name: 'test_rpc_tile', arguments: [] },
      { name: 'test_config_parse', arguments: [] },
      {
        name: 'test_tower_tile',
        arguments: ['--page-sz', 'normal', '--page-cnt', '1048576'],
        rlimitNofileSoft: 200_000,
      },
      { name: 'test_sched', arguments: [] },
      {
        name: 'test_execrp_tile',
        arguments: ['--page-sz', 'normal', '--page-cnt', '1572864'],
        rlimitNofileSoft: 1_048_576,
      },
      {
        name: 'test_replay_tile',
        arguments: ['--page-sz', 'normal', '--page-cnt', '1048576'],
        rlimitNofileSoft: 1_048_576,
      },
    ];
    const buildTargets = [
      lock.downstream.validatorBinary,
      lock.downstream.developmentBinary,
      ...testInvocations.map(({ name }) => name),
    ];
    assert(
      testInvocations.length === 10 &&
        new Set(testInvocations.map(({ name }) => name)).size === testInvocations.length &&
        new Set(buildTargets).size === buildTargets.length,
      'native attestation targets must contain exactly ten unique focused tests',
    );
    run(
      'bash',
      [
        '-c',
        [
          'source ./activate "BUILDDIR=$1" CC=gcc >/dev/null',
          'parallelism="$2"',
          'shift 2',
          'make "-j$parallelism" "$@"',
        ].join(' && '),
        '--',
        buildDirectory,
        parallelism,
        ...buildTargets,
      ],
      { cwd: freshSourceRoot, stdio: 'inherit' },
    );

    const unitTestEvidence = [];
    for (const testInvocation of testInvocations) {
      const testPath = join(objectRoot, 'unit-test', testInvocation.name);
      assert(existsSync(testPath), `missing freshly built test executable ${testPath}`);
      assert(
        realpathSync(testPath) === testPath,
        `${testInvocation.name} must be a regular in-tree build output, not a symlink`,
      );
      const testMetadata = lstatSync(testPath);
      assert(
        testMetadata.isFile() &&
          !testMetadata.isSymbolicLink() &&
          (testMetadata.mode & 0o111) !== 0,
        `${testInvocation.name} is not a regular executable`,
      );
      if (testInvocation.rlimitNofileSoft !== undefined) {
        run(
          'bash',
          [
            '-c',
            [
              'requested_nofile="$1"',
              'shift',
              'ulimit -Sn "$requested_nofile"',
              'effective_nofile="$(ulimit -Sn)"',
              'test "$effective_nofile" -ge "$requested_nofile"',
              'exec "$@"',
            ].join(' && '),
            '--',
            String(testInvocation.rlimitNofileSoft),
            testPath,
            ...testInvocation.arguments,
          ],
          { cwd: freshSourceRoot, stdio: 'inherit' },
        );
      } else {
        run(testPath, testInvocation.arguments, {
          cwd: freshSourceRoot,
          stdio: 'inherit',
        });
      }
      unitTestEvidence.push({
        name: testInvocation.name,
        arguments: [...testInvocation.arguments],
        rlimitNofileSoft: testInvocation.rlimitNofileSoft ?? null,
        bytes: testMetadata.size,
        sha256: sha256(testPath),
      });
    }

    const manifest = inspectBinaries(freshSourceRoot, objectRoot, lock);
    const flamencoArchivePath = join(objectRoot, 'lib', 'libfd_flamenco.a');
    assert(existsSync(flamencoArchivePath), 'fresh build is missing libfd_flamenco.a');
    const flamencoArchiveMembers = run('ar', ['t', flamencoArchivePath]).split(/\r?\n/u);
    assert(
      flamencoArchiveMembers.includes('fd_sigstatuscache.o'),
      'libfd_flamenco.a is missing the standalone signature-status cache core',
    );
    const sigstatuscacheArchiveSymbols = run('nm', ['-g', '--defined-only', flamencoArchivePath])
      .split(/\r?\n/u)
      .filter((line) => /\bT fd_sigstatuscache_[0-9A-Za-z_]+$/u.test(line.trim()));
    assert(
      sigstatuscacheArchiveSymbols.length === 21,
      'libfd_flamenco.a must expose exactly 21 signature-status cache core functions',
    );
    manifest.libraryComponents = {
      signatureStatusCacheCore: {
        archive: relative(freshSourceRoot, flamencoArchivePath),
        member: 'fd_sigstatuscache.o',
        publicFunctionSymbols: sigstatuscacheArchiveSymbols.length,
        linkedIntoValidatorBinaries: false,
      },
    };
    const localnetTopologyBinary = join(objectRoot, 'bin', lock.downstream.developmentBinary);
    const memoryOutput = run(
      localnetTopologyBinary,
      ['--config', join(networkRoot, 'config', 'localnet.toml'), 'mem', '--json'],
      {
        cwd: freshSourceRoot,
        env: { LOGNAME: attestationUser, USER: attestationUser },
      },
    );
    let memoryPlan;
    try {
      memoryPlan = JSON.parse(memoryOutput);
    } catch {
      fail('freshly built Firedancer did not emit a JSON memory plan for localnet.toml');
    }
    assert(
      memoryPlan !== null &&
        typeof memoryPlan === 'object' &&
        !Array.isArray(memoryPlan) &&
        memoryPlan.summary !== null &&
        typeof memoryPlan.summary === 'object' &&
        Number.isInteger(memoryPlan.summary.tile_cnt) &&
        memoryPlan.summary.tile_cnt > 0 &&
        Array.isArray(memoryPlan.summary.agave_affinity) &&
        memoryPlan.summary.agave_affinity.length === 0 &&
        Array.isArray(memoryPlan.workspaces) &&
        memoryPlan.workspaces.length > 0 &&
        Array.isArray(memoryPlan.objects) &&
        memoryPlan.objects.length > 0 &&
        Array.isArray(memoryPlan.links) &&
        memoryPlan.links.length > 0 &&
        Array.isArray(memoryPlan.tiles) &&
        memoryPlan.tiles.length === memoryPlan.summary.tile_cnt,
      'freshly built Firedancer emitted an invalid localnet memory plan',
    );
    const topologyTileNames = memoryPlan.tiles.map((tile) => tile?.name);
    for (const nativeTile of ['replay', 'execrp', 'rpc']) {
      assert(
        topologyTileNames.includes(nativeTile),
        `freshly built Firedancer localnet topology is missing native ${nativeTile} tile`,
      );
    }
    assert(
      topologyTileNames.every(
        (name) => typeof name === 'string' && name.length > 0 && !name.includes('agave'),
      ),
      'freshly built Firedancer localnet topology contains an invalid or Agave tile',
    );
    const buildInfoPath = join(objectRoot, 'info');
    assert(existsSync(buildInfoPath), 'fresh attestation build is missing Firedancer build info');
    manifest.build = {
      isolated: true,
      disposableTrackedCheckout: true,
      dependenciesRebuiltFromPinnedSource: [openssl],
      hostToolchain: {
        gcc: run('gcc', ['--version']).split('\n')[0],
        linker: run('ld', ['--version']).split('\n')[0],
        make: run('make', ['--version']).split('\n')[0],
        kernel: run('uname', ['-srmo']),
      },
      buildInvocation: {
        program: 'make',
        activationEnvironment: {
          BUILDDIR: buildDirectory,
          CC: 'gcc',
        },
        arguments: [`-j${parallelism}`, ...buildTargets],
      },
      targets: buildTargets,
      unitTestsExecuted: testInvocations.map(({ name }) => name),
      unitTestArguments: Object.fromEntries(
        testInvocations.map(({ name, arguments: testArguments }) => [name, [...testArguments]]),
      ),
      unitTestResourceLimits: Object.fromEntries(
        testInvocations
          .filter(({ rlimitNofileSoft }) => rlimitNofileSoft !== undefined)
          .map(({ name, rlimitNofileSoft }) => [name, { rlimitNofileSoft }]),
      ),
      unitTestEvidence,
      localnetConfigParsed: true,
      localnetConfigParsedBy: lock.downstream.developmentBinary,
      nativeTopologyTilesVerified: ['replay', 'execrp', 'rpc'],
      agaveAffinityEmpty: true,
      buildInfoSha256: sha256(buildInfoPath),
    };
    assertFreshPatchedCheckout(freshSourceRoot, lock);
    checkSource(sourceRoot);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    assert(
      existsSync(resolvedAttestationRoot) &&
        lstatSync(resolvedAttestationRoot).isDirectory() &&
        !lstatSync(resolvedAttestationRoot).isSymbolicLink() &&
        realpathSync(resolvedAttestationRoot) === resolvedAttestationRoot,
      'refusing to remove an unsafe attestation checkout',
    );
    rmSync(resolvedAttestationRoot, { force: true, recursive: true });
  }
}

async function materialize(destinationArgument) {
  const { lock } = loadPolicy();
  const destination = resolve(
    destinationArgument ?? join(repositoryRoot, '.local', 'wokenet', 'firedancer'),
  );
  assert(destination !== repositoryRoot && destination !== '/', 'refusing unsafe destination');
  assert(!existsSync(destination), `destination already exists: ${destination}`);
  await mkdir(dirname(destination), { recursive: true });
  run('git', [
    'clone',
    '--filter=blob:none',
    '--no-checkout',
    lock.upstream.repository,
    destination,
  ]);
  run('git', ['checkout', '--detach', lock.upstream.commit], { cwd: destination });
  for (const patch of lock.downstream.patches) {
    run('git', ['apply', resolvePatch(patch.path)], { cwd: destination });
  }
  checkSource(destination);
  process.stdout.write(`Materialized native WokeNet Firedancer source at ${destination}.\n`);
}

const [command = 'check', ...rawCommandArguments] = process.argv.slice(2);
const commandArguments =
  rawCommandArguments[0] === '--' ? rawCommandArguments.slice(1) : rawCommandArguments;

try {
  if (command === 'check') {
    assert(commandArguments.length === 0, 'check does not accept positional arguments');
    checkStatic();
  } else if (command === 'check-source') {
    assert(commandArguments.length === 1, 'check-source requires exactly one checkout path');
    checkSource(resolve(commandArguments[0]));
  } else if (command === 'check-binaries') {
    assert(commandArguments.length === 1, 'check-binaries requires exactly one checkout path');
    checkBinaries(resolve(commandArguments[0]));
  } else if (command === 'materialize') {
    assert(commandArguments.length <= 1, 'materialize accepts at most one destination path');
    await materialize(commandArguments[0]);
  } else {
    fail(`unknown command ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

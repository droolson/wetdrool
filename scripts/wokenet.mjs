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
    'getProgramAccounts',
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
    'getSlot',
  ];
  assert(
    capabilities.nativeValidator?.binary === lock.downstream.validatorBinary &&
      capabilities.nativeValidator.usesAgaveRuntime === false &&
      capabilities.nativeValidator.upstreamReleaseAvailable === false,
    'native validator capability policy is incomplete or unsafe',
  );
  assert(
    capabilities.nativeRpc?.binary === lock.downstream.validatorBinary &&
      capabilities.nativeRpc.evidenceClassification === 'source-observation-not-conformance' &&
      JSON.stringify(capabilities.nativeRpc.directNativeCTestCoverage) ===
        JSON.stringify(['getMultipleAccounts']) &&
      JSON.stringify(capabilities.nativeRpc.implementedRequiredReads) ===
        JSON.stringify(observedRequiredReads) &&
      JSON.stringify(capabilities.nativeRpc.missingRequiredMethods) ===
        JSON.stringify(requiredMissingMethods),
    'native RPC capability sets or evidence classification are stale',
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
    Array.isArray(lock.downstream.patches) && lock.downstream.patches.length > 0,
    'no downstream patches are pinned',
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
    assertTomlValue(
      config,
      'consensus.expected_shred_version',
      'REPLACE_WITH_CEREMONY_SHRED_VERSION',
      template,
    );
    assertTomlValue(config, 'tiles.gui.enabled', false, template);
    assertTomlValue(config, 'tiles.rpc.enabled', rpcEnabled, template);
    if (rpcEnabled) {
      assertTomlValue(config, 'tiles.rpc.rpc_listen_address', '127.0.0.1', template);
    }
    assertTomlValue(config, 'development.no_agave', true, template);
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
    'getProgramAccounts',
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
  assert(nativeMain.includes('fd_main( argc, argv, 1,'), 'firedancer is not in native mode');
  assert(
    developmentMain.includes('fd_dev_main( argc, argv, 1,'),
    'firedancer-dev is not in native mode',
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

function checkSource(sourceRoot) {
  const { lock } = loadPolicy();
  sourceState(sourceRoot, lock);
  const expectedDiff = expectedPatchedDiff(sourceRoot, lock);
  const actualDiff = run(
    'git',
    ['diff', '--binary', '--full-index', '--no-ext-diff', lock.upstream.commit, '--'],
    { cwd: sourceRoot },
  );
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: sourceRoot,
  });
  assert(untracked.length === 0, `source contains unexpected untracked files:\n${untracked}`);

  const patched = actualDiff.length > 0;
  if (patched) {
    assert(
      actualDiff === expectedDiff,
      'tracked source changes do not exactly match the pinned downstream patch queue',
    );
  } else {
    for (const patch of lock.downstream.patches) {
      run('git', ['apply', '--check', resolvePatch(patch.path)], { cwd: sourceRoot });
    }
  }
  run('git', ['diff', '--check'], { cwd: sourceRoot });
  process.stdout.write(
    `WokeNet Firedancer source is ${patched ? 'patched' : 'patch-ready'} at ${lock.upstream.commit}.\n`,
  );
  return { patched };
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
  const commonNativeSymbols = ['fd_tile_replay', 'fd_tile_execrp', 'fd_tile_rpc'];
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
        ? ['fd_main']
        : ['fd_dev_main', 'firedancer_dev_dev_cmd_fn']),
    ];
    for (const symbol of requiredSymbols) {
      assert(
        symbols.some(
          (entry) =>
            entry.name === symbol &&
            entry.type === 'FUNC' &&
            entry.binding === 'GLOBAL' &&
            entry.sectionIndex !== 'UND',
        ),
        `${binary} is missing defined global native Firedancer function ${symbol}`,
      );
    }
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
      requiredNativeSymbols: requiredSymbols,
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
  const actualDiff = run(
    'git',
    ['diff', '--binary', '--full-index', '--no-ext-diff', lock.upstream.commit, '--'],
    { cwd: sourceRoot },
  );
  assert(
    actualDiff === expectedDiff,
    'fresh build checkout does not exactly match the pinned downstream patch queue',
  );
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: sourceRoot,
  });
  assert(untracked.length === 0, `fresh build checkout contains unexpected files:\n${untracked}`);
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
  const sourceCheck = checkSource(sourceRoot);
  assert(
    sourceCheck.patched,
    'binary verification requires the exact applied downstream patch queue',
  );
  assert(
    process.platform === 'linux' && process.arch === 'x64',
    'native binary attestation requires the supported Linux x64 build host',
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
    run(
      'bash',
      [
        '-c',
        [
          'source ./activate "BUILDDIR=$1" CC=gcc >/dev/null',
          'make -j"$2" firedancer firedancer-dev test_genesis_create test_rpc_tile',
        ].join(' && '),
        '--',
        buildDirectory,
        parallelism,
      ],
      { cwd: freshSourceRoot, stdio: 'inherit' },
    );

    for (const testBinary of ['test_genesis_create', 'test_rpc_tile']) {
      const testPath = join(objectRoot, 'unit-test', testBinary);
      assert(existsSync(testPath), `missing freshly built test executable ${testPath}`);
      assert(
        realpathSync(testPath) === testPath,
        `${testBinary} must be a regular in-tree build output, not a symlink`,
      );
      run(testPath, [], { cwd: freshSourceRoot, stdio: 'inherit' });
    }

    const manifest = inspectBinaries(freshSourceRoot, objectRoot, lock);
    const validatorPath = join(objectRoot, 'bin', lock.downstream.validatorBinary);
    const memoryOutput = run(
      validatorPath,
      ['--config', join(networkRoot, 'config', 'localnet.toml'), 'mem', '--json'],
      { cwd: freshSourceRoot },
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
      targets: ['firedancer', 'firedancer-dev', 'test_genesis_create', 'test_rpc_tile'],
      unitTestsExecuted: ['test_genesis_create', 'test_rpc_tile'],
      localnetConfigParsed: true,
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

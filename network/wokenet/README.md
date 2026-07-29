# WokeNet

WokeNet is the sovereign execution network for `woke.social`. It is a
downstream fork of the Solana protocol implemented with the fully native
Firedancer validator and RPC code. It is not a Solana-operated cluster and does
not use Agave as its validator, replay runtime, consensus implementation, or RPC
server.

The native currency is **WOKE** (`$WOKE`). WOKE pays network fees and rent,
secures validator voting/staking, and settles native creator payments. It is not
an SPL token and has no mint or token-contract address. For wire compatibility,
RPC/account fields retain the protocol term `lamports`; WokeNet defines
`1 WOKE = 1,000,000,000 lamports`.

## Honest implementation status

The downstream fork is reproducibly pinned and patchable, but it is not ready
to carry production traffic:

- upstream full Firedancer explicitly has no production release;
- upstream labels the full validator not ready for test or production use;
- the native RPC tile still returns `501` for transaction submission,
  simulation, confirmation-status, transaction-history, and address-history
  methods required by the application and indexer;
- the downstream `getProgramAccounts` implementation is a bounded native subset,
  not unrestricted or production-complete RPC conformance; and
- the upstream genesis creator labels itself development-only and not safe for
  production use.

Frankendancer is not an acceptable fallback. Its complete RPC, replay,
execution, and consensus paths use Agave, which violates the WokeNet
runtime requirement. Until the native gaps close and independent audits pass,
the flagship application must remain on its verified compatibility harness and
must not claim that a live WokeNet processed a transaction.

The upstream statements and source are available from
[Firedancer’s repository](https://github.com/firedancer-io/firedancer) and
[operator documentation](https://docs.firedancer.io/).

`NATIVE_RPC_CAPABILITIES.json` uses a mixed evidence classification. Most
implemented reads remain source observations, while the pinned native C targets
directly cover `getMultipleAccounts` and the bounded downstream
`getProgramAccounts` subset. The latter scans ownership through the native
account database on a referenced frozen fork, supports only the documented
filters and configurations, applies hard result/scan/data ceilings, and keeps
`productionComplete` false. Wider deterministic method-level and connected
conformance remains mandatory before activation.

The WokeNet
[`getSignatureStatuses` native design and test plan](firedancer/GET_SIGNATURE_STATUSES_DESIGN.md)
records why a replay-only RPC cache is not safe to promote. Patch 0006
preserves complete live execution-result metadata through replay, patch 0007
adds a standalone fork-aware live-cache core, and patch 0008 exposes complete
snapshot results from the streaming parser. The cache has no topology or
caller, snapin discards the typed result and Borsh chunks, and native tower
does not publish the cluster block-commitment confirmation count. Integration,
snapshot restoration, commitment, and RPC JSON remain open, so the method stays
missing and production remains fail-closed.

## Reproducible downstream fork

`firedancer/SOURCE.lock.json` pins the exact official upstream commit and every
downstream patch checksum. The first patch removes hidden/nondeterministic
genesis inputs by making the timestamp, faucet balance, validator-identity
balance, and well-known benchmark-account funding explicit. The second patch
adds the bounded native program-account owner scan plus direct account-database
and RPC C tests. The third patch adds the explicit
`consensus.wokenet_live_cluster` classification and direct config-policy tests.
The fourth patch adds a WokeNet-only native RPC observer role. An empty
`paths.vote_account` is accepted only when live WokeNet mode is enabled, block
production is disabled, native RPC is enabled, and no authorized-voter path is
configured. Every other missing-vote WokeNet role fails closed, while a supplied
vote account always remains a voting role. The observer keeps the native tower
for local fork choice and emits its reset/root signals, but skips its own vote
account reconciliation and cannot construct a vote transaction. Direct unit
evidence does not prove the tower-to-replay-to-RPC commitment path.
The fifth patch restores the shared `fdctl` default fields made mandatory by
the genesis patch and makes the direct tower test deterministic in
containerized x86-64 CI: it registers the captured voters, replays the one
additional slot needed to cross the root threshold, and uses an mmap-backed
unit workspace instead of NUMA policy syscalls.
The sixth patch,
`0006-wokenet-preserve-replay-execution-result-metadata.patch` (SHA-256
`674166cbe90ff0b6982cbdf8de19856cb776efea82a26bea76ad2520116de0d0`),
preserves slot/bank identity and the complete execution-error tuple from
execrp through scheduler metadata into the replay transaction event. It
hard-fails identity mismatches and resets reused scheduler entries. It does not
add a signature-status cache or implement any RPC method. The retained
[execution-result propagation evidence](firedancer/EXECUTION_RESULT_PROPAGATION_EVIDENCE.md)
records its exact provenance, focused native test matrix, layout measurements,
resident-memory impact, and explicit evidence gaps.

The seventh patch,
`0007-wokenet-live-signature-status-cache-core.patch` (SHA-256
`b329e8ebd33b45934487a03f4fb0bcf361bcc1f04ac53b5d41381b30a347f32c`),
adds an overflow-checked caller-sized cache core with exact fork ancestry,
compact-key ambiguity handling, dead-bank tombstones, deterministic 300-root
retention, sticky incompleteness, and bounded atomic readers. It is archived in
`libfd_flamenco.a` but deliberately has no validator caller or topology
allocation. The
[cache-core evidence](firedancer/SIGNATURE_STATUS_CACHE_CORE_EVIDENCE.md)
records the exact semantics, concurrency model, sizing, tests, and integration
limits.

The eighth patch,
`0008-wokenet-preserve-snapshot-transaction-result-metadata.patch` (SHA-256
`19c56956dfedd0471f131a9c0e4ea07ff462bea0c70fbb77eb217612b2694641`),
adds a parser-owned typed transaction-result view and streamed strict-UTF-8
`BorshIoError` chunks while keeping the 64-byte snapshot entry and 14,208-byte
parser footprint unchanged. Snapin explicitly discards this new metadata; it
is not snapshot-to-cache restoration. The
[parser evidence](firedancer/SNAPSHOT_RESULT_PARSER_EVIDENCE.md) records the
complete enum matrix, regression coverage, memory measurements, and remaining
storage/integration work.

Patch 0006 changes internal tile layouts: the execrp completion message
grows by 16 bytes and crosses its dcache slot from 384 to 512 bytes, scheduler
transaction metadata grows by 40 bytes, and the replay event grows by 64 bytes
to 2,304 bytes. Default resident memory grows by 22.5 MiB. A full validator
rebuild and restart is required, and mixed tile versions are forbidden.
Any non-local, non-development `FD_CLUSTER_UNKNOWN` configuration must enable
that mode; omitting its one-bit switch fails closed. Local/development and
recognized built-in clusters may retain upstream classification. Enabled mode
requires the exact ceremony genesis hash, native-only production execution, a
non-zero shred version, genesis validation, an identity, sandboxing,
multiprocess isolation, and production benchmark limits.

Run:

```sh
pnpm wokenet:check
pnpm wokenet:materialize -- /absolute/path/to/wokenet-firedancer
pnpm wokenet:source-check -- /absolute/path/to/wokenet-firedancer
# After a supported Linux build:
pnpm wokenet:binary-check -- /absolute/path/to/wokenet-firedancer
```

The materializer refuses to overwrite an existing destination, checks out the
exact commit in detached mode, verifies every patch checksum, applies the patch
queue, requires the complete working-tree diff to exactly equal that queue, checks both native
binary build declarations, and verifies that the recorded missing RPC methods
still match source. The downstream patch brands both executables with a
source-locked version marker. On Linux x64, the binary check requires the patch
to be applied, clones the pinned commit without hardlinks into a disposable
temporary checkout, reapplies only the pinned patch queue, clones the separately
pinned dependency source at its exact commit, rebuilds the required static
OpenSSL artifacts inside that checkout, and creates the object directory there.
It never builds from pre-existing ignored source, dependency artifacts, or
`build/` files. It builds the two native binaries and ten pinned unit-test
targets, executes the tests, parses the WokeNet localnet configuration through
the freshly linked `firedancer-dev mem --json` path, verifies the ELF target and
native symbols,
exact-matches each ELF’s downstream marker, upstream commit, and
source-declared version, rejects identical validator/development digests and
forbidden dynamic runtime dependencies, then records dependency/toolchain,
build-info, topology, format, byte size, version, and SHA-256 evidence before
removing the entire temporary checkout. If upstream implements a recorded
missing method, the source check intentionally fails so the capability gate
must be reviewed rather than silently becoming stale.

## Native-only build and local cluster

Firedancer currently supports Linux only and requires the kernel, huge pages,
CPU isolation, NIC, memory, and storage described by upstream. On a dedicated
Linux development host:

```sh
pnpm wokenet:materialize -- /opt/wokenet-firedancer
cd /opt/wokenet-firedancer
./deps.sh
source activate
make -j"$(nproc)" firedancer firedancer-dev test_genesis_create test_accdb test_sigstatuscache test_slot_delta_parser test_rpc_tile test_config_parse test_tower_tile test_sched test_execrp_tile test_replay_tile
test_genesis_create
test_accdb
test_sigstatuscache
test_slot_delta_parser
test_rpc_tile
test_config_parse
ulimit -n 1048576
test_tower_tile --page-sz normal --page-cnt 1048576
test_sched
test_execrp_tile --page-sz normal --page-cnt 1572864
test_replay_tile --page-sz normal --page-cnt 1048576
pnpm --dir /path/to/repository wokenet:binary-check -- /opt/wokenet-firedancer
sudo ./build/native/gcc/bin/firedancer-dev \
  --config /path/to/repository/network/wokenet/config/localnet.toml \
  dev --no-agave
```

`firedancer-dev`, not `fddev`, creates the native development cluster.
`firedancer`, not `fdctl`, is the intended native operator binary. Running
Firedancer performs privileged and persistent host configuration; use a
dedicated machine and review the upstream initialization instructions first.
The repository’s manual `WokeNet native Firedancer` workflow repeats the
policy and materialization checks, installs upstream dependencies, then lets
the attestation command own the disposable tracked checkout, pinned OpenSSL
source rebuild, isolated object directory, ten direct test executables, native
TOML topology parse, ELF/symbol/hash, forbidden-process, and exact-source checks
on a labeled Linux x64 runner. A green workflow is build evidence, not a
production-readiness claim or a substitute for the connected and
multi-validator activation gates below. The workflow explicitly sets upstream
`FD_AUTO_INSTALL_PACKAGES=1`; its self-hosted label must therefore resolve only
to a disposable or dedicated runner whose owner has authorized system-package
installation.

The checked-in localnet configuration is disposable. It:

- disables upstream telemetry;
- prohibits the Agave subprocess;
- disables arbitrary gossip snapshot sources;
- pins the genesis timestamp;
- funds no well-known deterministic benchmark keys;
- creates explicit local faucet, bootstrap identity, and stake allocations; and
- exposes native RPC only on loopback.

Those local allocations are test fixtures, not production tokenomics. Genesis
also creates protocol-required rent-exempt state, so the local values must not be
quoted as a production total supply.

## Genesis and network identity

After a native Firedancer ceremony produces `genesis.bin`, record and verify its
canonical SHA-256/base58 genesis hash:

```sh
pnpm wokenet:verify-genesis -- \
  /absolute/path/to/genesis.bin EXPECTED_BASE58_HASH
```

This command opens one non-symlink file handle, enforces the byte bound while
reading, and requires an exact SHA-256/base58 hash match. It is a byte-identity
check only: it does not parse genesis semantics or prove supply, allocation,
feature, authority, or shred-version policy. The ceremony must independently
recreate and reconcile those values before using the resulting network ID.

The canonical protocol namespace is:

```text
wokenet:v1:<genesis-hash>:<social-protocol-program-id>
```

The genesis hash, shred version, program ID, validator identities, vote/stake
accounts, allocations, feature set, build digest, patch digest, and ceremony
signatures must be published together. A node must fail closed on a mismatched
genesis hash, shred version, program ID, or snapshot source.

The two production TOML files are review templates only. Their placeholder
genesis hash and numeric zero shred version make them deliberately unlaunchable
until a ceremony has occurred. Voting validators keep RPC and GUI disabled.
The RPC template disables block production and binds RPC to loopback for a
separately hardened gateway. The downstream source now recognizes that exact
template shape as a non-voting observer without inventing a dummy vote account:
it retains the tower’s virtual fork-choice/root/reset work, skips lookup of an
own vote account, and hard-disables vote-transaction construction. Direct
`test_config_parse` and `test_tower_tile` cases cover the role matrix, vote
suppression, reconciliation skip, virtual-root advancement, and pre-root
tower/ghost pruning. This is source and native C unit evidence only; no
connected native observer boot has been demonstrated.

The reviewed execution-result propagation evidence covers
execution-before-signature-success, execution-before-signature-failure, and
signature-failure-before-execution in `test_sched`, `test_execrp_tile`, and
`test_replay_tile`. It does not cover
signature-success-before-execution, live `Custom(0)`, or a fatal
identity-mismatch death test. Separate tests cover the standalone cache core and
snapshot-result parser, but no cache topology/replay wiring,
snapshot-to-cache restoration, commitment, RPC JSON, full-validator,
connected-cluster, or RPC-endpoint result is inferred from those focused tests.

The complete repository binary/topology gate also passed from a fresh exact
eight-patch checkout under Linux/x86-64 Docker emulation. It rebuilt pinned
OpenSSL, built both branded ELF binaries, ran all ten declared native tests,
verified exact symbol types and memory JSON, and confirmed native
replay/execrp/RPC topology with an empty Agave affinity. It ran as an
unprivileged user against a synthetic 128-CPU/one-NUMA-node sysfs fixture while
retaining `layout.affinity=auto`, so it is not native-hardware, performance,
signed-release, full-validator, or connected-cluster evidence.

The pinned tower code opens checkpoint/restore file descriptors but this source
audit found no implemented tower serialization or restore path. A non-voting
observer therefore cannot emit conflicting cluster votes after restart, but its
local confirmed/finalized commitment continuity may rebuild or regress until it
catches up. Restart behavior and health gating must be demonstrated on a
connected cluster before activation. After the ceremony, replace the genesis
placeholder and numeric zero with the published canonical base58 genesis hash
and non-zero numeric shred version; do not disable
`consensus.wokenet_live_cluster`. Omitting that mode on any unknown non-local,
non-development cluster fails closed. The downstream policy rejects empty,
malformed, noncanonical, all-zero, or built-in Solana/Pyth hashes and rejects
the mode under `firedancer-dev`, local-cluster, Frankendancer, or Agave-backed
execution. The same `consensus.expected_genesis_hash` is passed to the native
genesi tile, which verifies the loaded or downloaded genesis bytes exactly.
This safety classification closes the upstream `FD_CLUSTER_UNKNOWN` protection
gap, but it does not approve a production genesis or override any activation
gate below.

## Production activation gates

No public WokeNet genesis or production launch is authorized until all of
these are true:

1. Native Firedancer has a supported release and reproducible build provenance.
2. Native RPC implements and passes conformance for the five still-missing
   methods—`sendTransaction`, `simulateTransaction`, `getSignatureStatuses`,
   `getTransaction`, and `getSignaturesForAddress`—and the bounded
   `getProgramAccounts` subset passes the wider semantics, performance, and
   connected-cluster gates required for production.
3. Program deployment, upgrade authority, indexer replay, finality, snapshots,
   restart, repair, and multi-validator consensus pass on native Firedancer
   without an Agave process.
4. At least three independently administered validators and two independent RPC
   operators complete a byzantine/failover rehearsal.
5. The Firedancer downstream patch, genesis builder, runtime, social program,
   RPC gateway, bridge assumptions (if any), and economic design receive
   independent security review.
6. Supply, inflation, validator rewards, fee policy, allocations, sanctions,
   tax, money-transmission, consumer-protection, and launch disclosures receive
   qualified legal/economic review.
7. No public sale, exchange, lending, yield, bridge, or main-network funding is
   enabled merely to market decentralization.

`firedancer/NATIVE_RPC_CAPABILITIES.json` is the machine-readable activation
gate. It intentionally records production as disabled.

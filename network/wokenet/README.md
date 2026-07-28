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
  simulation, confirmation-status, transaction-history, address-history, and
  program-account methods required by the application and indexer; and
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

`NATIVE_RPC_CAPABILITIES.json` classifies its implemented-read list as source
observation, not conformance evidence. The pinned native C RPC target directly
covers only `getMultipleAccounts`; every required read/write method still needs
deterministic method-level conformance testing before activation.

The WokeNet
[`getSignatureStatuses` native design and test plan](firedancer/GET_SIGNATURE_STATUSES_DESIGN.md)
records why a replay-only RPC cache is not safe to promote: snapshot restore
currently loses the complete transaction result needed by RPC and native tower
does not publish the cluster block-commitment confirmation count. The plan
keeps the capability false and production fail-closed while specifying the
shared snapshot/live cache, execution-event, commitment, fork, and direct C
test work required for a correct implementation.

## Reproducible downstream fork

`firedancer/SOURCE.lock.json` pins the exact official upstream commit and every
downstream patch checksum. The first patch removes hidden/nondeterministic
genesis inputs by making the timestamp, faucet balance, validator-identity
balance, and well-known benchmark-account funding explicit.

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
queue, requires the tracked diff to exactly equal that queue, checks both native
binary build declarations, and verifies that the recorded missing RPC methods
still match source. The downstream patch brands both executables with a
source-locked version marker. On Linux x64, the binary check requires the patch
to be applied, clones the pinned commit without hardlinks into a disposable
temporary checkout, reapplies only the pinned patch queue, clones the separately
pinned dependency source at its exact commit, rebuilds the required static
OpenSSL artifacts inside that checkout, and creates the object directory there.
It never builds from pre-existing ignored source, dependency artifacts, or
`build/` files. It builds the two native binaries and two pinned unit-test
targets, executes the tests, parses the WokeNet localnet configuration through the
freshly linked validator, verifies the ELF target and native symbols,
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
make -j"$(nproc)" firedancer firedancer-dev test_genesis_create test_rpc_tile
test_genesis_create
test_rpc_tile
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
source rebuild, isolated object directory, two direct test executables, native
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

The two production TOML files are review templates only. Their
`REPLACE_WITH_...` values make them deliberately unlaunchable until a ceremony
has occurred. Voting validators keep RPC and GUI disabled. RPC nodes are
non-voting and bind RPC to loopback for a separately hardened gateway.

## Production activation gates

No public WokeNet genesis or production launch is authorized until all of
these are true:

1. Native Firedancer has a supported release and reproducible build provenance.
2. Native RPC implements and passes conformance for `sendTransaction`,
   `simulateTransaction`, `getSignatureStatuses`, `getTransaction`,
   `getSignaturesForAddress`, and `getProgramAccounts`.
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

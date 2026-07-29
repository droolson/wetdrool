# Native `getSignatureStatuses` design for WokeNet

Status: **blocked at integration, snapshot restoration, commitment, and RPC;
live propagation, a standalone live-cache core, and parser substrate are
implemented**

Audited upstream:

- repository: `https://github.com/firedancer-io/firedancer.git`
- commit: `60c3d2e381a6607f63adc818481e2f31472ae681`
- native validator/RPC binary: `firedancer`
- forbidden substitutes: Agave, Frankendancer, `agave-validator`, `fdctl`,
  `fddev`, and `solana-test-validator`

This document is an implementation and test plan with three implemented but
unconnected substrates, not passing RPC conformance evidence:

- patch 0006 preserves the live execution result through replay;
- patch 0007 adds a caller-sized, fork-aware live signature-status cache core;
  and
- patch 0008 exposes complete snapshot transaction-result metadata from the
  streaming slot-delta parser.

The cache has no topology allocation or caller. Snapin deliberately discards
the parser's typed result and borrowed Borsh chunks. No patch implements native
block-commitment counts or RPC JSON.

`NATIVE_RPC_CAPABILITIES.json` must continue to list
`getSignatureStatuses` as missing, and production traffic must remain disabled,
until every acceptance gate below passes on the exact pinned native source plus
the checksum-pinned downstream patch queue.

## Decision

Do not add a bounded transaction-status map only to
`src/discof/rpc/fd_rpc_tile.c`, and do not promote a method that:

- starts empty after snapshot restore;
- returns `null` for snapshot-restored recent signatures;
- substitutes `0`, slot distance, or local tower lockout depth for the cluster
  block-commitment confirmation count;
- drops entries silently under memory pressure;
- treats slot number or reusable `bank_idx` as a fork identity;
- loses instruction index, custom error, or Borsh error data; or
- claims `searchTransactionHistory: true` without a native history store.

Those shortcuts can return plausible but incorrect finality and transaction
results. An explicit `501` remains safer until the native data path is complete.

## Implemented live-propagation substrate

Patch 0006 completes only steps 1–4 of the live propagation path in
[section 3](#3-enrich-the-live-execution-to-replay-event). It carries
`slot`, `bank_idx`, `bank_seq`, `txn_err`, `exec_err`, `exec_err_kind`,
`exec_err_idx`, and `custom_err` through execrp completion, scheduler metadata,
and `REPLAY_SIG_TXN_EXECUTED`. It also:

- hard-fails completion, scheduler, and live-bank identity mismatches;
- resets identity, result, flag, and timing fields when scheduler pool entries
  are reused;
- makes signature failure authoritative in either covered completion order; and
- normalizes nested execution fields for signature and non-instruction
  failures.

The focused Linux/x86-64 evidence builds and passes `test_sched`,
`test_execrp_tile`, and `test_replay_tile`. It covers execution followed by
successful signature verification, execution followed by failed signature
verification, and failed signature verification followed by execution. It also
covers exact custom-error propagation at the `UINT_MAX` boundary. This is not a full
ordering cross-product: successful signature verification followed by
execution, a live `Custom(0)` case, and a fatal identity-mismatch death test are
not covered.

Patch 0006 changes internal tile layouts:

- the execrp completion message grows by 16 bytes, crossing the completion
  dcache slot from 384 to 512 bytes;
- scheduler transaction metadata grows by 40 bytes;
- the replay transaction event grows by 64 bytes, from 2,240 to 2,304 bytes;
  and
- default resident memory grows by 22.5 MiB: 20 MiB across ten execrp
  completion rings and 2.5 MiB at the default scheduler depth.

These are internal tile ABI/layout changes, not a wire or RPC ABI. Integrating
the patch requires a full validator rebuild and restart; mixed tile versions
must not be operated.

## Implemented standalone live-cache core

Patch 0007 adds `fd_sigstatuscache` to `libfd_flamenco.a`. The caller-sized
shared object implements:

- exact `(bank_idx, bank_seq)` ancestry and sibling-fork isolation;
- coexisting reused bank indices;
- the lossless patch-0006 live result tuple;
- 20-byte compact keys with offsets 0 through 11;
- ambiguous results instead of false positives on compact-key collisions;
- dead-bank descendant removal and non-resurrectable tombstones;
- deterministic canonical-root pruning with 300-root retention;
- sticky fail-closed incompleteness on capacity or invariant failure; and
- one writer with bounded, read-only atomic readers.

The object is library-only. No topology allocates it, no replay/root/dead-bank
event calls it, and no RPC tile queries it. Consequently, neither validator
binary links its symbols yet. This is a deliberate integration boundary, not
evidence of a working cache service.

Patch 0007 does not accept snapshot roots. Snapshot slot deltas lack the exact
live bank identity expected by its V1 ABI and can carry richer Borsh payloads.
Rooted snapshot visibility requires a separately versioned ABI.

## Implemented snapshot-result parser substrate

Patch 0008 keeps the 64-byte duplicate-detection entry unchanged and returns a
separate parser-owned typed result with each `ENTRY`. It preserves every
supported transaction and instruction error discriminant, instruction index,
all three transaction-error `u8` payloads, `Custom(u32)`, and streamed
`BorshIoError(String)` metadata.

Borsh string bytes are borrowed from the input with offset and total length and
strict incremental UTF-8 validation. There is no arbitrary parser-local string
cap. A retaining consumer must provide configured bounded storage and fail
closed on overflow.

Snapin processes the new parser events but still stages only the compact
identity for `fd_txncache`. It explicitly discards the typed result and Borsh
chunks because no snapshot-result store is connected. Thus immediate
post-snapshot RPC lookup remains blocked.

## Pinned-source findings

### The live replay stream is necessary but insufficient

`src/discof/replay/fd_replay_tile.c::publish_txn_executed` already publishes
`REPLAY_SIG_TXN_EXECUTED` for every replayed transaction. The message type is
`fd_replay_txn_executed_t` in
`src/discof/replay/fd_replay_tile.h`.

Before downstream patch 0006, the pinned upstream message carries the parsed
transaction, `is_committable`, `is_fees_only`, and a flattened `txn_err`. It
does not carry:

- `slot`, `bank_idx`, and the non-reusable `bank_seq` together;
- `exec_err`, `exec_err_kind`, `exec_err_idx`, or `custom_err`; or
- a durable status-cache identity that survives bank-pool reuse.

The richer execution result exists earlier in the native path:

- `src/flamenco/runtime/fd_runtime.h::fd_txn_out_t.err`
- `src/discof/execrp/fd_execrp_tile.c::publish_txn_finalized_msg`
- `src/discof/replay/fd_execrp.h::fd_execrp_txn_exec_done_msg_t`

On the pinned upstream,
`fd_execrp_txn_exec_done_msg_t` carries `slot` and `bank_seq`, but flattens the
error before replay publishes the transaction event. Patch 0006 closes this
specific live-transport gap. Patch 0007 provides a standalone cache core, but
the live event is not inserted into it and dead-bank/root events are not wired.
Snapshot restoration, commitment, and RPC gaps remain.

### Snapshot restore is a hard correctness blocker

Solana status-cache snapshots can contain up to 300 rooted slot deltas. Native
Firedancer parses them in:

- `src/discof/restore/utils/fd_slot_delta_parser.h`
- `src/discof/restore/utils/fd_slot_delta_parser.c`
- `src/discof/restore/fd_snapin_tile.c`

The compact snapshot entry remains:

```c
struct fd_sstxncache_entry {
  ulong slot;
  uchar blockhash[ 32UL ];
  uchar txnhash[ 20UL ];
  uchar result;
};
```

Before patch 0008, the parser reduced the result to one byte. Patch 0008 now
returns a separate 32-byte typed result that preserves the complete supported
enum and scalar payloads. `BorshIoError` bytes are validated and streamed as
borrowed chunks. The compact entry stays 64 bytes, and the parser footprint
stays 14,208 bytes.

`fd_snapin_tile.c::populate_txncache` then loads only the recent blockhash
duplicate-prevention data into `fd_txncache`. That structure is intentionally a
message-hash set for consensus/runtime duplicate detection. It is not an RPC
signature-status store, excludes live nonce transactions from normal insertion,
and has no complete result payload. Snapin explicitly discards patch 0008's
typed result and Borsh chunks, so the restoration blocker moves from decoding
to bounded storage, snapshot-root identity, and cache population.

Consequently, an RPC-local cache populated only from new replay events would
return false `null` values for valid recent signatures after every
snapshot-based restart. Waiting for new traffic does not repair those missing
300 rooted slot deltas. Returning an RPC error during a fixed warm-up interval
would avoid false data, but it is degraded behavior and does not satisfy the
required native method.

### Confirmation counts are a separate hard correctness blocker

The RPC response requires both:

- `confirmationStatus`: `processed`, `confirmed`, or `finalized`; and
- `confirmations`: a numeric cluster block-commitment count, or `null` when
  finalized.

Native RPC can derive status thresholds from:

- `REPLAY_SIG_OC_ADVANCED`
- `REPLAY_SIG_ROOT_ADVANCED`
- `fd_tower_slot_confirmed_t`

However, `fd_tower_slot_confirmed_t` in
`src/discof/tower/fd_tower_tile.h` carries only confirmation level, forward
flag, slot, and block ID. It does not carry the per-slot block-commitment
confirmation count used by Solana RPC. Slot distance and this validator's local
tower vote lockout are different quantities and must not be substituted.

### Fork identity must include `bank_seq`

`bank_idx` is a reusable bank-pool index. The durable discriminator is
`(bank_idx, bank_seq)`. `fd_replay_slot_completed_t`,
`fd_replay_oc_advanced_t`, and `fd_replay_root_advanced_t` already expose
`bank_seq`; RPC's current `bank_info_t` does not retain complete parent
`(bank_idx, bank_seq)` ancestry.

Equivocating blocks can also share a slot number. A correct query must select a
status only when its bank is an ancestor of the current processed bank, or when
the status has been rooted on the canonical fork.

## Required native implementation

### 1. Connect and extend the shared signature-status cache

Patch 0007 establishes the dedicated native cache boundary:

- `src/flamenco/runtime/fd_sigstatuscache.h`
- `src/flamenco/runtime/fd_sigstatuscache.c`
- focused tests beside those files

Complete in the V1 live core:

- live unrooted forks up to the configured bank/fork bounds;
- lookup by transaction signature;
- fork-aware lookup against processed-bank ancestry;
- the exact patch-0006 live result tuple;
- `(bank_idx, bank_seq)` identities and parent identities;
- equivocation at the same slot;
- root advancement and deterministic pruning;
- bounded sizing derived from explicit configuration;
- no silent eviction inside the promised recent-status window; and
- a fail-closed completeness state if capacity or input invariants are ever
  violated.

Still required:

- topology/workspace allocation and a connected writer/reader;
- replay insertion, dead-bank events, and root events;
- snapshot-root visibility for the 300 restored deltas;
- richer snapshot/Borsh result storage in a separately versioned ABI;
- nonce-transaction coverage at the connected insertion boundary; and
- Agave-generated compact-key differential fixtures.

The V1 core uses a 20-byte compact key and returns `AMBIGUOUS` on collisions.
Its deterministic seed-plus-blockhash offset selects within the Agave-compatible
0-through-11 range but differs from Agave v3.1.8's runtime RNG selection.

### 2. Retain and restore complete snapshot status results

Complete in patch 0008's parser-owned typed view:

- transaction error discriminant;
- instruction index for `InstructionError`;
- instruction error discriminant;
- `Custom(u32)` value; and
- streamed, strictly validated Borsh I/O error data.

Still required: provide configured bounded storage for retained Borsh bytes and
make `fd_snapin_tile.c` load all supported rooted slot deltas into a
snapshot-capable shared cache before RPC becomes available. Capacity overflow
must fail closed; it must not truncate and continue.

The existing `fd_txncache` duplicate-prevention behavior must remain
consensus-equivalent and separate from RPC status retention.

### 3. Enrich the live execution-to-replay event

Propagate these fields without flattening:

```text
slot
bank_idx
bank_seq
is_committable
is_fees_only
txn_err
exec_err
exec_err_kind
exec_err_idx
custom_err
```

Required edit path:

1. **Complete in patch 0006:** populate the fields from `fd_txn_out_t.err` in
   `src/discof/execrp/fd_execrp_tile.c::publish_txn_finalized_msg`.
2. **Complete in patch 0006:** extend `fd_execrp_txn_exec_done_msg_t` in
   `src/discof/replay/fd_execrp.h`.
3. **Complete in patch 0006:** preserve the fields in `fd_sched_txn_info_t` in
   `src/discof/replay/fd_sched.h` and its initialization/completion paths in
   `fd_sched.c` and `fd_replay_tile.c`.
4. **Complete in patch 0006:** extend `fd_replay_txn_executed_t` and populate it
   in
   `fd_replay_tile.c::publish_txn_executed`.
5. **Open:** insert only committable transactions into the signature-status
   cache.
   Transactions from a bank that later dies must never become queryable.

Also open: extend the dead-bank notification with `(bank_idx, bank_seq)` or
another equally durable fork identity. Slot alone is not sufficient under
equivocation.

### 4. Add native block-commitment counts

Implement a native equivalent of the block-commitment count used by
`getSignatureStatuses`, using cluster vote stake and lockout depth. The
calculation belongs with native tower/commitment state, not in the HTTP parser.

Publish an exact per-bank or per-block count to RPC with a durable block
identity. Extending `fd_tower_slot_confirmed_t` is acceptable only if:

- the value is calculated from cluster commitment, not local tower depth;
- forward confirmations cannot be attached to the wrong equivocation;
- root advancement produces `confirmations: null`; and
- skipped slots and fork switches match the Solana-compatible semantics.

### 5. Implement the RPC method last

Only after the shared cache and commitment data are available should
`UNIMPLEMENTED(getSignatureStatuses)` be replaced in
`src/discof/rpc/fd_rpc_tile.c`.

The handler must:

- accept one to 256 base58 transaction signatures;
- reject malformed configuration and wrong-size signatures;
- preserve request order and duplicate inputs;
- query against the current processed bank;
- return the processed context slot;
- emit exact `err` and legacy `status` JSON from the same normalized result;
- emit the native cluster `confirmations` count;
- derive `confirmationStatus` from processed ancestry, optimistic confirmation,
  and root state;
- return `-32011` for `searchTransactionHistory: true` until a separate native
  transaction-history store is enabled; and
- fail closed if the shared cache reports incomplete state.

`searchTransactionHistory: true` is not solved by the recent status cache. It
must use the same durable native history subsystem eventually required by
`getTransaction` and `getSignaturesForAddress`.

## Direct C test matrix

No capability promotion is allowed from source inspection alone.

### Snapshot parser and bootstrap

Patch 0008's direct parser fixtures cover:

- success and every supported transaction-error variant;
- `InstructionError` with a nonzero instruction index;
- `InstructionError::Custom(0)` and `Custom(UINT_MAX)`;
- streamed Borsh I/O error data and varied chunk boundaries;
- malformed discriminants and lengths;
- invalid 20-byte key offsets;
- multiple slots/groups, empty groups, duplicate slots, and non-root slots; and
- exactly 300 rooted slot deltas and 301 rejection.

Still add:

- an Agave-generated golden or differential fixture;
- explicit duplicate blockhash-group policy coverage;
- configured Borsh retention-capacity rejection;
- snapin-to-cache restoration; and
- snapshot load followed by an immediate successful signature lookup before
  any new replayed transaction.

### Live propagation

The current `test_sched`, `test_execrp_tile`, and `test_replay_tile` coverage
asserts the live metadata substrate through `REPLAY_SIG_TXN_EXECUTED`. Covered
orderings are execution-before-signature-success,
execution-before-signature-failure, and
signature-failure-before-execution.

Still add successful-signature-before-execution coverage, a live
`InstructionError::Custom(0)` case, and a fatal identity-mismatch death test.
Those gaps mean the current evidence is not the full completion-order
cross-product.

### Cache and forks

Patch 0007's direct core tests cover:

- success and failure lookup;
- parent/child ancestry;
- two equivocations at the same slot;
- reusable `bank_idx` with different `bank_seq`;
- dead-bank removal, descendant removal, and non-resurrectable tombstones;
- root advancement and canonicalization;
- retention of exactly 300 rooted entries and deterministic pruning of the
  301st;
- configured capacity boundary; and
- an explicit incomplete/error state instead of a false miss on overflow.

Still add connected tests for:

- replay insertion before and after dead-bank notifications;
- processed fork switches driven by real replay events;
- optimistic confirmation on only one equivocation;
- nonce transactions;
- snapshot entries plus live entries in one cache; and
- duplicate RPC request signatures.

### Commitment counts

Tower tests must compare native counts against fixed vote-stake/lockout vectors
for:

- zero through maximum confirmation depth;
- skipped slots;
- vote expiration;
- fork switches;
- duplicate and optimistic confirmation;
- forward-confirmed blocks;
- equivocation; and
- root advancement.

### RPC JSON

Extend `src/discof/rpc/test_rpc_tile.c` with exact JSON tests for:

- missing params, wrong types, zero signatures, 256 signatures, and 257
  rejection;
- invalid base58 and valid base58 with the wrong decoded length;
- ordered mixtures of hit, miss, success, and failure;
- `{"Ok":null}` and `{"Err":...}` legacy status values;
- `err: null` and every supported normalized error shape;
- `processed`, `confirmed`, and `finalized`;
- numeric confirmations and finalized `null`;
- fork isolation and bank-index reuse;
- immediate post-snapshot lookup;
- `searchTransactionHistory: true` returning `-32011` while native history is
  disabled; and
- incomplete-cache fail-closed behavior.

The RPC fuzzer must seed a valid shared cache and exercise the new handler.

## Acceptance gates

Keep `getSignatureStatuses` in `missingRequiredMethods` until all are true:

1. The exact pinned patch queue applies cleanly and the source-policy checker
   recognizes the method as implemented rather than silently changing its
   classification.
2. Direct native C parser, cache, replay, tower, and RPC tests pass on the
   supported Linux x64 build host.
3. Differential JSON fixtures match the documented Solana-compatible method,
   including error variants and confirmation counts.
4. A native Firedancer node started from a snapshot returns recent rooted
   statuses before new replay traffic.
5. Fork, equivocation, dead-slot, restart, root-retention, and capacity tests
   return no false positive or false `null`.
6. The binary attestation still proves the native `firedancer` runtime and no
   forbidden Agave/Frankendancer dependency or process.
7. `NATIVE_RPC_CAPABILITIES.json` is updated only with the resulting direct C
   and connected native evidence.

Until then, WokeNet production activation remains fail-closed.

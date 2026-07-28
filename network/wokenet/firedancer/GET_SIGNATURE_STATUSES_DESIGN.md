# Native `getSignatureStatuses` design for WokeNet

Status: **blocked; do not implement as an RPC-tile-only cache**

Audited upstream:

- repository: `https://github.com/firedancer-io/firedancer.git`
- commit: `60c3d2e381a6607f63adc818481e2f31472ae681`
- native validator/RPC binary: `firedancer`
- forbidden substitutes: Agave, Frankendancer, `agave-validator`, `fdctl`,
  `fddev`, and `solana-test-validator`

This document is an implementation and test plan, not passing native
conformance evidence. `NATIVE_RPC_CAPABILITIES.json` must continue to list
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

## Pinned-source findings

### The live replay stream is necessary but insufficient

`src/discof/replay/fd_replay_tile.c::publish_txn_executed` already publishes
`REPLAY_SIG_TXN_EXECUTED` for every replayed transaction. The message type is
`fd_replay_txn_executed_t` in
`src/discof/replay/fd_replay_tile.h`.

The current message carries the parsed transaction, `is_committable`,
`is_fees_only`, and a flattened `txn_err`. It does not carry:

- `slot`, `bank_idx`, and the non-reusable `bank_seq` together;
- `exec_err`, `exec_err_kind`, `exec_err_idx`, or `custom_err`; or
- a durable status-cache identity that survives bank-pool reuse.

The richer execution result exists earlier in the native path:

- `src/flamenco/runtime/fd_runtime.h::fd_txn_out_t.err`
- `src/discof/execrp/fd_execrp_tile.c::publish_txn_finalized_msg`
- `src/discof/replay/fd_execrp.h::fd_execrp_txn_exec_done_msg_t`

`fd_execrp_txn_exec_done_msg_t` already carries `slot` and `bank_seq`, but it
currently flattens the error before replay publishes the transaction event.

### Snapshot restore is a hard correctness blocker

Solana status-cache snapshots can contain up to 300 rooted slot deltas. Native
Firedancer parses them in:

- `src/discof/restore/utils/fd_slot_delta_parser.h`
- `src/discof/restore/utils/fd_slot_delta_parser.c`
- `src/discof/restore/fd_snapin_tile.c`

The current snapshot entry type is:

```c
struct fd_sstxncache_entry {
  ulong slot;
  uchar blockhash[ 32UL ];
  uchar txnhash[ 20UL ];
  uchar result;
};
```

The parser consumes transaction and instruction error variants, but reduces the
result to one byte. It does not preserve the instruction index, custom error
value, or Borsh error payload needed for the JSON `TransactionError`.

`fd_snapin_tile.c::populate_txncache` then loads only the recent blockhash
duplicate-prevention data into `fd_txncache`. That structure is intentionally a
message-hash set for consensus/runtime duplicate detection. It is not an RPC
signature-status store, excludes live nonce transactions from normal insertion,
and has no complete result payload.

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

### 1. Add a shared signature-status cache

Add a dedicated native cache object rather than putting the authoritative data
in the HTTP tile. Suggested source boundary:

- `src/flamenco/runtime/fd_sigstatuscache_shmem.h`
- `src/flamenco/runtime/fd_sigstatuscache.h`
- `src/flamenco/runtime/fd_sigstatuscache.c`
- focused tests beside those files

The shared object must support:

- the 300 rooted status-cache slot deltas required at snapshot restore;
- live unrooted forks up to the configured bank/fork bounds;
- lookup by transaction signature;
- fork-aware lookup against processed-bank ancestry;
- the exact transaction-error payload required by JSON;
- `(bank_idx, bank_seq)` identities and parent identities;
- equivocation at the same slot;
- root advancement and deterministic pruning;
- nonce transactions;
- bounded sizing derived from explicit configuration;
- no silent eviction inside the promised recent-status window; and
- a fail-closed completeness state if capacity or input invariants are ever
  violated.

The cache must document whether it uses full 64-byte signatures or the
snapshot's compatible 20-byte key slices. If truncated snapshot keys are used,
the hash offset and collision behavior must match the snapshot format and be
covered by differential fixtures.

### 2. Preserve complete snapshot status results

Extend `fd_sstxncache_entry_t` and the state machine in
`fd_slot_delta_parser.c` so it preserves the complete serializable result:

- transaction error discriminant;
- instruction index for `InstructionError`;
- instruction error discriminant;
- `Custom(u32)` value; and
- bounded Borsh I/O error data when that variant carries a string.

`fd_snapin_tile.c` must load all supported rooted slot deltas into the shared
signature-status cache before RPC becomes available. Snapshot validation must
reject malformed lengths, unknown unsupported variants, duplicate groups,
invalid key offsets, and capacity overflow; it must not truncate and continue.

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

1. Populate the fields from `fd_txn_out_t.err` in
   `src/discof/execrp/fd_execrp_tile.c::publish_txn_finalized_msg`.
2. Extend `fd_execrp_txn_exec_done_msg_t` in
   `src/discof/replay/fd_execrp.h`.
3. Preserve the fields in `fd_sched_txn_info_t` in
   `src/discof/replay/fd_sched.h` and its initialization/completion paths in
   `fd_sched.c` and `fd_replay_tile.c`.
4. Extend `fd_replay_txn_executed_t` and populate it in
   `fd_replay_tile.c::publish_txn_executed`.
5. Insert only committable transactions into the signature-status cache.
   Transactions from a bank that later dies must never become queryable.

Extend the dead-bank notification with `(bank_idx, bank_seq)` or another
equally durable fork identity. Slot alone is not sufficient under equivocation.

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

Add direct C fixtures covering:

- success and every supported transaction-error variant;
- `InstructionError` with a nonzero instruction index;
- `InstructionError::Custom(0)` and `Custom(UINT_MAX)`;
- bounded Borsh I/O error data;
- all chunk boundaries in the streaming parser;
- malformed discriminants and lengths;
- invalid 20-byte key offsets;
- duplicate slot/blockhash groups;
- exactly 300 rooted slot deltas and 301 rejection; and
- snapshot load followed by an immediate successful signature lookup before
  any new replayed transaction.

### Live propagation

Extend `src/discof/execrp/test_execrp_tile.c` and replay/scheduler tests to
assert exact preservation of slot, bank index, bank sequence, transaction
error, instruction index, and custom error from `fd_txn_out_t` through
`REPLAY_SIG_TXN_EXECUTED`.

Cover both execution-before-signature-verification and
signature-verification-before-execution ordering.

### Cache and forks

Direct cache tests must cover:

- success and failure lookup;
- duplicate request signatures;
- parent/child ancestry;
- two equivocations at the same slot;
- reusable `bank_idx` with different `bank_seq`;
- dead-bank removal before and after execution events;
- processed fork switch;
- optimistic confirmation on only one equivocation;
- root advancement and canonicalization;
- retention of exactly 300 rooted entries and deterministic pruning of the
  301st;
- nonce transactions;
- snapshot entries plus live entries in one cache;
- configured capacity boundary; and
- an explicit incomplete/error state instead of a false miss on overflow.

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

1. The exact pinned patch applies cleanly and the source-policy checker
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

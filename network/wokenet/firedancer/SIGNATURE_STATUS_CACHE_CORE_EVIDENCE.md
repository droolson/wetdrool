# WokeNet patch 0007: live signature-status cache core audit

## Provenance and reproducibility

- Pinned Firedancer upstream: `60c3d2e381a6607f63adc818481e2f31472ae681`
- Materialized WokeNet 0001–0006 baseline:
  `6238caa328c4b7ed01925c4dfb46fcfac57fd9d0`
- Baseline tree: `280531fd8925193a6138a31d68066a5727be8508`
- Source commit: `f7759cf6765b6a0d1e64b731ffa277fd45d0e217`
- Source tree: `f78f85c50d7bcd48751fe3785e318395b479606d`
- Standalone patch:
  `0007-wokenet-live-signature-status-cache-core.patch`
- Patch SHA-256:
  `b329e8ebd33b45934487a03f4fb0bcf361bcc1f04ac53b5d41381b30a347f32c`
- Patch size: 110,619 bytes, 2,266 lines

The patch applies cleanly after 0006. It changes four files with 2,219
insertions:

1. `src/flamenco/runtime/Local.mk`
2. `src/flamenco/runtime/fd_sigstatuscache.c`
3. `src/flamenco/runtime/fd_sigstatuscache.h`
4. `src/flamenco/runtime/test_sigstatuscache.c`

`git diff --check` passed.

## Deliberately bounded scope

This patch adds a caller-sized shared-memory **live replay-result cache core**.
It does not allocate the object in validator topology, subscribe to replay,
dead-bank, or root events, restore snapshot status deltas, expose a native RPC
reader, or promote `getSignatureStatuses`.

The object is compiled into `libfd_flamenco.a`, but no validator code calls it.
The focused full `firedancer` link therefore extracts no cache object and has
zero `fd_sigstatuscache_*` symbols. The repository binary gate separately
checks both final binaries for the same dormant-library boundary.

## Implemented semantics

- Caller-supplied, overflow-checked `bank_max`, `group_max`, and `entry_max`.
- Exact bank identity is `(bank_idx, bank_seq)`; a reused `bank_idx` with a new
  `bank_seq` can coexist with a retained older identity.
- Parent/child ancestry determines live fork visibility.
- Same-slot sibling forks remain isolated.
- A dead bank removes its results and descendants but retains exact-ID
  tombstones until canonical root pruning. Late attach or insert cannot
  resurrect the dead identity.
- Root publication canonicalizes one path, prunes noncanonical branches, and
  retains at most 300 rooted banks.
- The stored live result tuple is the lossless normalized patch-0006 tuple:
  `txn_err`, `exec_err`, `exec_err_kind`, `exec_err_idx`, and `custom_err`.
  `Custom(0)` and `UINT_MAX` remain distinguishable values.
- Capacity exhaustion or an internal/input invariant failure sets a sticky
  incomplete state. Every otherwise valid query then returns `INCOMPLETE` with
  zeroed output, including a formerly known hit.
- Conflicting results for one compact key poison that key. Matching queries
  return `AMBIGUOUS`; they do not return a plausible false positive.
- No age-based eviction occurs except deterministic canonical-root retention.

## Compact-key compatibility boundary

The cache uses Agave-compatible 20-byte compact keys. One offset is shared by a
recent blockhash group, and the valid offset range is 0 through 11. Agave
v3.1.8 selects that offset with a runtime RNG. This core derives a reproducible
offset from the caller seed and blockhash. The key width and range are
compatible; the selection policy is intentionally different and documented.

This is not snapshot restoration. Rooted snapshot slot deltas do not contain
WokeNet's exact live `(bank_idx, bank_seq)` ancestry and can carry richer
`BorshIoError` data. Snapshot-root visibility therefore requires a separately
versioned cache ABI rather than fabricated live bank identities.

## Concurrency model

- Exactly one writer.
- Any number of read-only readers.
- Shared payload fields read concurrently are C lock-free atomics.
- A bounded seqlock-style publication protocol prevents partial mutations from
  becoming visible.
- Readers never block the writer or spin indefinitely; retry exhaustion
  returns `QUERY_AGAIN`.
- The unit suite maps the same object read/write and read-only, publishes from
  one thread, and queries from another.

## Direct Linux/x86-64 validation

The focused test ran under Linux/x86-64 Docker emulation:

- optimized `test_sigstatuscache`: pass;
- ASan, UBSan, and leak-detection run: pass; and
- full `firedancer` build: pass.

The archive contains `fd_sigstatuscache.o` and 21 public
`fd_sigstatuscache_*` functions. The focused final executable contains no
cache symbols because the patch intentionally has no caller.
The object/header build requires `FD_HAS_ATOMIC`; the hosted pthread/mmap unit
test additionally requires `FD_HAS_HOSTED`.

The unit suite covers:

- layout, lifecycle, bad magic, and footprint overflow;
- fork views, siblings, equivocation, and reusable bank indices;
- dead-bank descendants, tombstones, late-event rejection, and root pruning;
- compact-key offsets 0 and 11 and local/cross-group collisions;
- `Custom(0)`, `UINT_MAX`, and exact result tuples;
- retention of exactly 300 rooted banks;
- bank, group, and entry capacity failures;
- input-invariant fail-closed behavior;
- read-only mapping and atomic publication; and
- bad arguments, stale views, and rooted-bank death rejection.

The implementation also treats malformed internal references as
`INCOMPLETE`, but the unit suite does not deliberately fault-inject a corrupt
reference.

## Layout and sizing

Linux/x86-64 layout:

| Item            | Bytes |
| --------------- | ----: |
| Alignment       |   128 |
| Shared header   | 2,608 |
| Bank record     |    72 |
| Blockhash group |    56 |
| Status entry    |    80 |

For `P(x)` equal to the least power of two greater than or equal to `2*x`:

```text
F(B,G,E) =
  align_up(
    2608 + 8*(P(B)+P(G)+P(E)) + 72*B + 56*G + 80*E,
    128
  )
```

Verified samples:

| Banks | Groups |   Entries |     Footprint |
| ----: | -----: | --------: | ------------: |
|     1 |      1 |         1 |       2,944 B |
|    64 |     64 |     4,096 |     406,144 B |
|   512 |  1,024 | 2,000,000 | 193,675,904 B |
| 1,024 |  4,096 | 4,000,000 | 387,496,576 B |

No default capacity or resident-memory claim is made because no topology
allocates this object yet.

## Remaining production blockers

- topology/workspace allocation with an approved capacity budget;
- insertion of committable replay results;
- durable dead-bank and canonical-root event wiring;
- snapshot-root result restoration in a separately versioned ABI;
- native commitment-confirmation counts;
- native RPC query and exact JSON behavior; and
- connected validator, restart, fork-switch, and end-to-end tests.

`getSignatureStatuses` remains missing and production traffic remains disabled.

# WokeNet patch 0006: execution-result propagation audit

## Provenance and reproducibility

- Pinned Firedancer upstream: `60c3d2e381a6607f63adc818481e2f31472ae681`
- Materialized WokeNet 0001–0005 baseline: `c8313a5397e363c70ff75df7c68b7de1e36abcc0`
- Source commit for this patch: `bda474c29c4d434edd04fafd1adab7cc66efa3a5`
- Source tree: `280531fd8925193a6138a31d68066a5727be8508`
- Standalone patch: `0006-wokenet-preserve-replay-execution-result-metadata.patch`
- Patch SHA-256: `674166cbe90ff0b6982cbdf8de19856cb776efea82a26bea76ad2520116de0d0`
- Patch size: 38,251 bytes, 837 lines
- `git apply --check` succeeded against the exact 0001–0005 baseline.
- `git am` succeeded against the exact baseline and produced tree
  `280531fd8925193a6138a31d68066a5727be8508`, byte-identical to the source tree.

## Changed files

1. `src/discof/execrp/fd_execrp_tile.c`
2. `src/discof/execrp/test_execrp_tile.c`
3. `src/discof/replay/fd_execrp.h`
4. `src/discof/replay/fd_replay_tile.c`
5. `src/discof/replay/fd_replay_tile.h`
6. `src/discof/replay/fd_sched.c`
7. `src/discof/replay/fd_sched.h`
8. `src/discof/replay/test_replay_tile.c`
9. `src/discof/replay/test_sched.c`

Diffstat: 557 insertions, 40 deletions. `git diff --check` passed. No RPC,
configuration, capability, or patch-queue file changed.

## Behavior covered

- Propagates `slot`, `bank_idx`, and `bank_seq` through both transaction
  execution and signature-verification completions.
- Propagates `txn_err`, `exec_err`, `exec_err_kind`, `exec_err_idx`, and
  `custom_err` into scheduler metadata and the replay transaction event.
- Hard-fails completion/live-bank/scheduler identity mismatches.
- Resets every identity, result, flag, and timing field when a scheduler
  transaction-pool entry is reused.
- Canonical non-instruction and signature-failure nested values:
  `exec_err=0`, `exec_err_kind=0`, `exec_err_idx=UINT_MAX`, `custom_err=0`.
- Signature failure is authoritative in both tested failure orderings—execution
  before signature failure and signature failure before execution—and clears
  committable/fees-only flags.
- Keeps RPC capability limits and RPC implementation unchanged.

## Linux/x86-64 build and tests

Environment:

- Image: `node:22-bookworm`
- Docker platform: `linux/amd64`
- Kernel reported by the container: `Linux 7.0.11-orbstack-00360-gc9bc4d96ac70 x86_64`
- Compiler: GCC through Firedancer's `activate` build environment
- Build directory: `build/wokenet-exec-meta-tests`
- Warnings are errors in this build.

Build:

```text
source ./activate "BUILDDIR=wokenet-exec-meta-tests" CC=gcc
make -j4 test_sched test_execrp_tile test_replay_tile
```

Result: pass. The final rebuild compiled the changed execrp, scheduler, replay,
GUI consumer, and all three test objects, then linked all three tests.

Final test invocations used Docker's file-descriptor ceiling above the
well-known accounts-database descriptor (`FD_ACCDB_FD_RW=123461`):

```text
test_sched
test_execrp_tile --page-sz normal --page-cnt 1572864
test_replay_tile --page-sz normal --page-cnt 1048576
```

Results:

- `test_sched`: exit 0; `test_sched.c(336): pass`
- `test_execrp_tile`: exit 0; ran seccomp, metrics, result-metadata,
  sigverify, PoH, success, fee-payer failure, execution error, and fees-only
  cases; `test_execrp_tile.c(661): pass`
- `test_replay_tile`: exit 0; `pass: test_txn_result_propagation`, followed
  by every pre-existing replay/fork/equivocation/eviction test passing through
  `pass: test_eqvoc_child_confirm`

The replay propagation test covers exact custom-error mapping (including
`UINT_MAX`), every identity component, execution-before-signature-success,
execution-before-signature-failure, signature-failure-before-execution, final
event mapping, and normalization of malformed nested values for a
non-instruction transaction error.

This is not the full completion-order cross-product. The focused tests do not
cover signature-success-before-execution, a live `Custom(0)` result, or a fatal
identity-mismatch death test. They also do not cover runtime cache integration,
snapshot restore, dead-fork event wiring, commitment counts, RPC JSON, a full
validator, or a connected cluster. Later patches add separately tested
standalone cache and parser substrates without connecting those paths.

## Complete repository binary/topology gate

On 2026-07-29, the repository's complete `check-binaries` gate passed from a
fresh disposable checkout at the pinned upstream commit with all eight exact
WokeNet patches applied. The gate ran as the unprivileged `node` user under
Linux/x86-64 Docker emulation and a synthetic 128-CPU/one-NUMA-node sysfs
fixture while retaining `layout.affinity=auto`.

The gate:

- rebuilt OpenSSL 3.6.2 from the source commit pinned by Firedancer;
- built both branded ELF64 x86-64 binaries, `firedancer` and
  `firedancer-dev`, at the exact pinned upstream commit;
- ran `test_genesis_create`, `test_accdb`, `test_sigstatuscache`,
  `test_slot_delta_parser`, `test_rpc_tile`, `test_config_parse`,
  `test_tower_tile`, `test_sched`, `test_execrp_tile`, and `test_replay_tile`,
  all with exit status zero;
- verified the exact ELF symbol types for tile descriptors and binary-specific
  entry points;
- verified the emitted memory-layout JSON and native replay, execrp, and RPC
  topology with an empty Agave affinity; and
- emitted the binary-attestation manifest before removing its disposable
  attestation checkout.

This pass resolves the repository binary/topology gate only. The synthetic
fixture is not native validator hardware, and the manifest is not signed
release provenance. No full validator process, connected or multi-validator
cluster, benchmark, performance claim, connected cache/restoration path,
commitment pipeline, or RPC endpoint was exercised.

## Layout and resident-memory impact

Measured by compiling the same C layout probe at `-O2` against the baseline
and patched trees under Linux/x86-64:

| Type or constant                | 0001–0005 |    0006 | Delta |
| ------------------------------- | --------: | ------: | ----: |
| `fd_execrp_txn_exec_done_msg_t` |     376 B |   392 B | +16 B |
| `fd_execrp_task_done_msg_t`     |     384 B |   400 B | +16 B |
| `fd_execrp_task_msg_t`          |   2,304 B | 2,304 B |     0 |
| `fd_sched_txn_info_t`           |      64 B |   104 B | +40 B |
| `fd_replay_txn_executed_t`      |   2,240 B | 2,304 B | +64 B |
| `fd_replay_message_t`           |   2,240 B | 2,304 B | +64 B |
| `FD_TPU_PARSED_MTU`             |   2,168 B | 2,168 B |     0 |

Ring accounting:

- The 16K `execrp_replay` link crosses a 128-byte slot boundary:
  384 B to 512 B per slot. Its complete dcache footprint changes from
  6,299,648 B to 8,396,800 B, exactly +2,097,152 B (+2 MiB) per execrp
  completion link.
- Default configuration has 10 execrp tiles, for +20 MiB across those links.
- The 64K `replay_out` event grows from 2,240 B to 2,304 B, but both occupy
  the same 2,304-byte dcache slot. Its complete dcache footprint remains
  151,007,232 B: no resident ring increase.
- The default scheduler depth is 65,536. Its transaction-info pool increases
  by `40 * 65536 = 2,621,440` B (+2.5 MiB).
- Total default resident increase attributable to this patch is therefore
  +22.5 MiB (+23,592,960 B): 20 MiB in ten completion rings and 2.5 MiB in
  the scheduler metadata pool.
- At another configured scheduler depth, the pool delta is exactly
  `40 * depth` bytes before any final allocator alignment.

## Limitations

- Tests ran under OrbStack's x86-64 emulation, not native x86-64 validator
  hardware.
- No full validator, live cluster, benchmark, or end-to-end RPC run was
  performed.
- QEMU did not implement the NUMA policy syscall used by anonymous Firedancer
  workspaces. The replay test uses the same mmap-backed test-only workspace
  strategy introduced for the tower tests in WokeNet patch 0005.
- `test_execrp_tile` reported that the requested workspace was smaller than
  its approximately 10 GiB requirement and intentionally fell back to lazy
  anonymous memory; all cases passed.
- The focused patch-author build image lacked OpenSSL and the Agave submodule,
  producing the build system's normal optional-component warnings. Neither was
  required by those three native test targets. The later complete repository
  gate rebuilt pinned OpenSSL and is recorded separately above.
- A preliminary execrp test launch with Docker's default `RLIMIT_NOFILE`
  stopped in fixture setup at `dup2(..., FD_ACCDB_FD_RW)` before exercising
  test logic. The final audited runs explicitly set the descriptor ceiling
  to 1,048,576 and all tests passed.

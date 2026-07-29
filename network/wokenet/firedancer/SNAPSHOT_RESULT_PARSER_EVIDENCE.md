# WokeNet patch 0008: snapshot transaction-result parser audit

## Provenance and reproducibility

- Pinned Firedancer upstream: `60c3d2e381a6607f63adc818481e2f31472ae681`
- Materialized WokeNet 0001–0006 baseline:
  `ceea52cf18ee5e8a5526594046b0e25470886b7a`
- Standalone source commit:
  `3266e0d76f2fa015194ace6369580572d2c941ff`
- Standalone source tree:
  `4abee3819d93c3341af24e128452bfa36ba3fde0`
- Applied after patch 0007 as commit:
  `2df45c7af238a74a1d1351a2a729e979da354f39`
- Combined 0001–0008 tree:
  `daba9ce42188effddc873d39605a362bc907d65b`
- Standalone patch:
  `0008-wokenet-preserve-snapshot-transaction-result-metadata.patch`
- Patch SHA-256:
  `19c56956dfedd0471f131a9c0e4ea07ff462bea0c70fbb77eb217612b2694641`
- Patch size: 86,788 bytes, 1,928 lines

The patch applies cleanly both to the 0001–0006 baseline and after 0007. It
changes five files with 1,035 insertions and 550 deletions:

1. `src/discof/restore/fd_snapin_tile.c`
2. `src/discof/restore/utils/fd_slot_delta_parser.c`
3. `src/discof/restore/utils/fd_slot_delta_parser.h`
4. `src/discof/restore/utils/fuzz_slot_delta_parser.c`
5. `src/discof/restore/utils/test_slot_delta_parser.c`

`git diff --check` passed.

## Implemented parser boundary

The existing 64-byte `fd_sstxncache_entry_t` remains unchanged for the
duplicate-detection `fd_txncache` staging path. Each `ENTRY` event now also
exposes a parser-owned 32-byte typed transaction-result view that remains valid
until the next parser call.

The parser preserves:

- outer `Result` tags `Ok` and `Err`;
- `TransactionError` discriminants 0 through 38;
- `InstructionError` at transaction variant 8;
- the instruction index;
- `InstructionError` discriminants 0 through 52;
- `Custom(u32)` at instruction variant 25;
- the `u8` payloads for transaction variants 30, 31, and 35; and
- `BorshIoError(String)` at instruction variant 44.

Unknown result or error discriminants fail closed. Fields not selected by the
active discriminants are reset to zero for every entry and parser reuse.

## Streamed `BorshIoError` handling

String bytes are returned as borrowed input chunks with exact offset and total
length. They are not copied into parser-local unbounded storage. UTF-8 is
validated incrementally across arbitrary input fragmentation, including:

- embedded NUL bytes;
- split two-, three-, and four-byte scalars;
- overlong encodings;
- surrogate ranges;
- code points beyond the Unicode maximum;
- truncated final scalars; and
- a zero-length string ending exactly at EOF.

There is intentionally no arbitrary parser-local string-length cap. A future
consumer that retains these bytes must use configured bounded storage and fail
closed on overflow.

## Direct Linux/x86-64 validation

Under Linux/x86-64 Docker emulation:

- `test_slot_delta_parser`: pass;
- `test_snap_roundtrip`: pass;
- `fuzz_slot_delta_parser`: builds; and
- a 256-run fuzzer smoke invocation exits successfully.

`test_snap_roundtrip` verifies the existing entry/group snapshot path; it does
not assert the new typed result. Typed-result and streamed-Borsh coverage lives
in `test_slot_delta_parser`.

The direct unit matrix covers:

- `Ok`, all supported transaction-error discriminants, and all supported
  instruction-error discriminants;
- `Custom(0)` and `Custom(UINT_MAX)`;
- all three transaction-error `u8` payload variants;
- valid fragmented UTF-8 with embedded NUL;
- malformed result tags, error discriminants, UTF-8, and EOF positions;
- rejection of the legacy invalid outer discriminant 42;
- result-field reset across multiple entries and parser reuse;
- multiple slots and groups, a slot with zero groups, and zero-entry groups;
- group blockhash and compact-key offset preservation;
- a positive Borsh string followed by another entry in the same input,
  including the zero-byte `ENTRY` transition;
- 300 rooted slot deltas and 301 rejection;
- duplicate slots, non-root slots, and invalid key offsets; and
- varied fragment sizes plus bounded terminal draining in the fuzz harness.

No Agave-generated golden or differential fixture is claimed. The enum mapping
was checked against Agave v3.1.8 source, while the test bytes are explicit
little-endian C builders.

## Layout and memory impact

Linux/x86-64 measurements:

| Item                 | Before 0008 | After 0008 |              Delta |
| -------------------- | ----------: | ---------: | -----------------: |
| Snapshot entry       |        64 B |       64 B |                  0 |
| Typed result         |           — |       32 B | +32 B parser-owned |
| Advance result       |           — |       48 B |           API view |
| Parser private state |       184 B |      208 B |              +24 B |
| Parser alignment     |       128 B |      128 B |                  0 |
| Parser footprint     |    14,208 B |   14,208 B |                  0 |

Existing alignment slack absorbs the private-state increase. Compiled
baseline and patched `fd_slot_delta_parser_footprint()` both return 14,208
bytes.

The snapin entry staging array remains:

```text
58,823,400 entries * 64 bytes = 3,764,697,600 bytes
```

The default complete snapin scratch footprint remains 3,766,767,616 bytes.
Retaining a separate 32-byte typed result for every maximum staging entry
would require another 1,882,348,800 bytes; this patch does not allocate that
storage.

## Deliberately incomplete integration

`fd_snapin_tile.c` continues to stage only the 64-byte compact identity used by
the consensus duplicate-detection cache. It processes the new events so parser
progress is correct, but explicitly discards:

- the typed result attached to `ENTRY`; and
- borrowed `BorshIoError` chunks.

Therefore this patch does **not** restore snapshot transaction results into the
standalone live cache core, make them visible to RPC, or fix post-restart
signature lookups. It is parser substrate only.

## Remaining production blockers

- approved bounded storage for retained Borsh strings;
- a separately versioned snapshot-root/cache ABI;
- snapin-to-cache population before RPC becomes available;
- Agave-generated golden or differential fixtures;
- immediate post-restore lookup tests;
- live and snapshot result convergence tests; and
- native commitment and RPC integration.

`getSignatureStatuses` remains missing and production traffic remains disabled.

# Testing strategy

Status: active implementation. Unit, native Rust, Agave local-validator
compatibility, PostgreSQL, Kubo, real WebSocket relay, browser E2E, automated
accessibility, and the compatibility validator-to-browser vertical slice have
passing evidence. Native WokeNet Firedancer/RPC integration, production
security/resilience suites, the manual accessibility matrix, and full
cross-language conformance remain incomplete.

WokeNet is the sovereign runtime, forked from Solana, with native WOKE at
9 decimals. `lamports` is retained only as the Solana-compatible wire/base-unit
identifier (`1 WOKE = 1,000,000,000 lamports`). Native validator and RPC results
must come from Firedancer. Agave/Solana tooling is an explicitly labeled
compatibility oracle and can never satisfy native or production evidence.
Native Firedancer/RPC is **Experimental**, and production activation remains
blocked until its build, RPC, genesis, connected-slice, resilience, and
independent-operator gates pass.

## Verified evidence snapshot

| Surface | Current verified evidence | Important limit |
| --- | --- | --- |
| Protocol objects | All 29 v1 object families, deterministic RFC 8785 bytes and IDs, exact canonical-envelope decoding, NFC rejection, Ed25519 verification, changed-payload rejection, authorization denial, and generated Draft 2020-12 schema drift | TypeScript fixtures only; no shared Rust/TypeScript golden corpus |
| Storage and SDK | Local CAS round-trip/deletion/corruption, permanence-consent gate, multi-provider quorum, Arweave-compatible receipt/readback validation, operation-scoped signed/recoverable publication, exact payment planning, seven IDL-aligned instruction builders, strict settlement-effect verification, and exact-byte version-0/legacy compile/sign/simulate/broadcast/finalize execution | No funded live Arweave uploader, production provider, complete generated account client, flagship wallet/passkey signer integration, executable-artifact attestation, or native Firedancer transaction path |
| WokeNet program compatibility | Twenty-one Rust sizing/validation/PDA/discriminator/sequence/allocation tests, a Solana-compatible SBF build, and 33 real Agave local-validator oracle cases including handles, root/delegated actions, delayed recovery, governance, native WOKE tips/subscriptions, adversarial authorization/substitution/replay, and transaction/compute/rent ceilings | Compatibility evidence only; native Firedancer, token assets, other governance models/execution, full fuzz/cross-language matrix, and public-network evidence remain open |
| Indexer/PostgreSQL | Finalized Solana-format sync against the Agave oracle, exact 32-event IDL decoding, manifest/CID/signature verification, social/community/security/recovery/payment projections, raw-event provenance, checkpoint rollback, retry/DLQ, eleven migrations, exact-network APIs, bounded indexed public search, and deterministic replay; 79 unit plus 13 PostgreSQL cases pass | No native Firedancer RPC, fork/reorg, independent-provider reconciliation, viewer-aware search, or production-scale evidence |
| Feed provider | 29 cases cover all seven modes, transparent scoring, bounded trending, provider provenance/checkpoints, cursor binding, third-party reconciliation, local safety filtering, and redirect-only-origin rejection | Production candidate collection and a curated discovery registry are operator/client integrations |
| Crypto/passkey wrapping | 12 vectors cover random/hash/HKDF/AES-GCM and credential-bound WebAuthn-PRF Ed25519-seed wrapping, including substitution and malformed inputs | Package-level vectors do not prove protocol onboarding, recovery, or external review |
| Authentication service | 24 unit/API cases, three isolated PostgreSQL cases, one auth-service browser integration, and two real-Chromium flagship lifecycle flows cover exact-origin/RP ceremonies, one-time challenges, atomic initial credential/wrapper/activation, atomic authentication/session issuance against revocation, same-root additional passkeys, step-up revocation, whole-account session invalidation, survivor authentication, revoked-credential rejection, cross-tab CSRF recovery, bounded retention, and fail-closed custody/recovery policy | Protocol-identity creation, WokeNet delegation/device-authority integration, recovery, load evidence, and external review remain open |
| Pairwise messaging | Thirteen real-WASM cases cover independent device keys, Olm session establishment, canonical sender-signed outer envelopes, relay-mutation rejection before state mutation, post-session loss/reordering, duplicate/corruption/wrong-device rejection, local and remote authorization/revocation, malformed Unicode, bounded dependency stalls, production volatile-storage rejection, plaintext zeroization/non-disclosure, fixed errors, private runtime construction, and absent group APIs | Volatile memory state only; persistent encrypted browser state, pre-key retransmission, attachments, safety UX, relay integration, and independent review remain open |
| Media worker | 57 adversarial unit cases, three real Sharp/FFmpeg/ffprobe integrations, and a real ClamAV 1.5.3 benign/EICAR container check cover resumability, hashes, MIME/container checks, filesystem races, bounds, metadata-free processing, HLS/waveforms, authorization, scanner protocol/freshness/provenance, and unsigned publication | Flagship browser upload, production multi-provider storage, codec sandbox/isolation evidence, load testing, and external review remain open |
| Kubo | Real local container publish, returned-CID verification, gateway retrieval, health, and unpin | No production provider or multi-gateway fault exercise |
| Connected compatibility slice | Fresh Agave validator oracle, signed local CAS, nine finalized Solana-format transactions, production sync/API, destructive projection replay with exact equivalence, production Next, desktop/mobile Chromium | Compatibility-only local core text-post/follow/tombstone journey; not native WokeNet, public-network, or full product breadth |
| Native WokeNet runtime | No passing connected evidence | Experimental native Firedancer validator/RPC build, WokeNet genesis, RPC conformance, connected slice, resilience, and independent-operator proof are required; production activation is blocked |
| Web | Production build, 79 unit cases, and 206 passing desktop/mobile Playwright cases covering the current route surface, 90 axe A/AA scans over 45 fixtures, semantic states, connected post detail, skip-link/navigation, high contrast, canonical-host redirects, bounded public search, local composer/preferences/hide/export, and two desktop passkey lifecycle flows; the duplicate mobile flows are intentionally skipped | Wallet/protocol-identity/transaction flows, WokeNet delegation lifecycle, post-detail axe coverage, and a manual WCAG conformance result remain open |
| Local web performance | `pnpm measure:performance` records three production-mode loopback samples for each of five representative routes, including TTFB, DOM-ready, load, LCP, and CLS | Unthrottled laboratory observation only; no INP, field Core Web Vitals, production dependencies, regional latency, load, or capacity evidence |

The connected-slice row is the cross-layer proof. Other rows remain
surface-specific and must not be used to imply untested product breadth.

`pnpm domain:probe` starts the already-built production Next.js server on an
ephemeral loopback port. It proves exact legacy `sociallywoke.com` and
`www.sociallywoke.com` `Host` values return a path/query-preserving `308` to
`https://woke.social` and proves the canonical, suffix-lookalike, and
trailing-dot hosts do not redirect. `pnpm verify` runs this probe after the
production build.

## Principles

- Test protocol invariants at the lowest reliable layer and critical user
  journeys end to end.
- Keep a fast deterministic suite, but do not replace native Firedancer,
  separately labeled Agave compatibility-oracle, PostgreSQL, browser, storage,
  and network-failure coverage with mocks.
- Treat signatures, hashes, authorization, payments, recovery, moderation, and
  encryption as adversarial surfaces.
- A UI success state must be backed by a confirmed operation or an explicit
  pending/offline state.
- Tests run from public interfaces where practical so a third-party client or
  operator can reuse the fixtures.

## Test layers

| Layer | Tools | Primary responsibility | Current state |
| --- | --- | --- | --- |
| Type and schema checks | TypeScript strict mode, Zod schema tests | Forward compatibility and invalid input | Implemented subset passes |
| TypeScript unit | Vitest | Serialization, signatures, storage, SDK, indexer, feed, relay, moderation, crypto, configuration, and web behavior | Implemented subsets pass; future product areas remain absent |
| Rust unit | `cargo test` | State transitions, sizing, checked arithmetic, helpers | Core-program subset passes |
| Program compatibility oracle | Anchor + real Agave local validator | Solana-format PDAs, signers, constraints, events, replay, and close behavior | Core success/selected rejection paths pass as compatibility evidence; full matrix incomplete |
| Native WokeNet integration | Native Firedancer validator/RPC | WokeNet genesis, program execution, finality, RPC conformance, WOKE fees, restart/replay, and failure behavior | Experimental; no passing native connected evidence |
| Service integration | Vitest + Docker Compose or real loopback transport | PostgreSQL migrations, replay, storage, authentication, relay, moderation, search, worker behavior | PostgreSQL 18.4, Kubo, authentication PostgreSQL/browser, 35 relay unit/real-WebSocket cases, 41 moderation unit plus 3 PostgreSQL cases, 79 indexer unit plus 13 PostgreSQL cases, public-search index/timeout/snapshot/parity/API/client cases, real media processors, and live ClamAV benign/EICAR checks pass; viewer-aware and production-scale search remain open |
| Protocol compatibility integration | Agave local validator + CAS + PostgreSQL + production services | Identity-to-feed vertical slice and projection rebuild | Connected local compatibility proof passes; native Firedancer and alternate-provider variants are absent |
| Browser E2E | Playwright | Consumer flows, failure states, mobile, keyboard, wallet/passkey UX | All current routes, local-state flows, search validation/degradation, keyboard, mobile, and themes pass; real Chromium authenticators prove initial registration, same-root second-passkey addition, first-passkey revocation/session invalidation, survivor authentication, and revoked-credential rejection. Wallet and protocol-identity transactions remain absent |
| Accessibility | Playwright + axe + manual matrix | WCAG 2.2 AA | Ninety automated A/AA scans pass over 45 route fixtures in desktop/mobile projects; post-detail axe coverage and the manual matrix are not executed |
| Performance | Production Next + headless Chromium | Local laboratory observation | Five representative routes have reproducible loopback TTFB/DOM/load/LCP/CLS output; field Core Web Vitals, INP, throttled/mobile-network, load, and production-service measurements are absent |
| Security | Static analysis and focused adversarial tests | Injection, traversal, XSS, CSRF, SSRF, malicious prompts, abuse | Narrow protocol/storage/authorization checks only |
| Resilience | Fault-injection scenarios | RPC, gateway, relay, indexer, queue, and database projection failure | Narrow corruption/recoverable-publication checks only |

## Determinism

- Local fixtures use fixed public test seeds that are clearly unusable for
  production.
- Time, random identifiers, and network responses are injected at unit
  boundaries.
- Shared canonical-byte and content-address fixtures must be committed as golden
  vectors. Current TypeScript tests generate deterministic fixtures in-process,
  so the cross-language gate remains open.
- Native Firedancer tests and Agave compatibility-oracle tests start from
  separate fresh ledgers unless a test explicitly covers restart or replay.
- The current database integration applies migrations, uses a unique synthetic
  network in the local projection database, and clears that network afterward.
  Future suites should use isolated databases or schemas.
- Connected E2E data is created through documented protocol instructions and
  signed storage interfaces, never by undocumented table editing.

## Required adversarial vectors

- Duplicate initialization, stale sequence, cross-identity account substitution,
  wrong owner, invalid signer, PDA collision, replay, unauthorized close,
  integer boundary, oversized input, and malformed UTF-8/URI data.
- Invalid canonical JSON, unknown critical schema fields, signature mismatch,
  author-key mismatch, CID/hash substitution, gateway corruption, and manifest
  downgrade.
- XSS payloads, dangerous URL schemes, tracking pixels, CSRF, SQL injection,
  SSRF, command injection, path traversal, decompression bombs, polyglot media,
  and log injection.
- Spam bursts, sponsor exhaustion, Sybil follows, report brigading, moderation
  conflicts, governance capture attempts, and metadata abuse.
- Recipient replacement, WOKE/`lamports` or decimal confusion, unsupported
  tokens, double payment, simulation mismatch, blockhash expiry, fee change, and
  false entitlement.
- Message replay, removed-device delivery, key rollback, corrupted attachment,
  safety-number change, relay reordering, and reporter over-disclosure.

## Compatibility vertical slice proof

The current integration milestone runs against an Agave local-validator
compatibility oracle and does the following:

1. Start a fresh Agave local validator and PostgreSQL projection.
2. Create two identities and an inclusive profile through the program.
3. Canonicalize and sign a text manifest.
4. Store and independently re-read the exact bytes by content address.
5. Anchor the address and hash onchain.
6. Index only finalized/eligible events and verify the manifest.
7. Follow the author and display the verified post in the web feed.
8. Clear every row in the selected network projection.
9. Rebuild it from program history and stored signed manifests.
10. Compare the rebuilt API response with the pre-rebuild response.

The connected harness checks exact object ID, CID, payload hash, finalized
anchor, tombstone suppression, following projection, zero replay dead letters,
and exact pre/post replay state. Adjacent protocol/indexer tests reject changed
bytes, invalid signatures, wrong authors, duplicates, and invalid manifests.
`pnpm test:vertical-slice` runs this proof and is included in `pnpm verify:all`
and the Solana-format compatibility CI lane. It does not prove native
Firedancer execution or WokeNet RPC behavior.

The native vertical-slice gate must repeat the flow against a fresh WokeNet
genesis using a native Firedancer validator and RPC, assert WOKE fee accounting
at 9 decimals, exercise restart/replay and provider failure, and publish
artifacts that identify the Firedancer build. Until then, native runtime and
production claims remain blocked.

## CI evidence

The repository has CI workflows for the implemented gates. The desired release
evidence contract is that every CI job records tool versions, immutable
dependency lockfiles, commit, command, duration, test counts, and artifacts.
Flaky retries may diagnose
infrastructure but cannot turn a failing product assertion green. Quarantined
tests remain visible and block the completion gate when they cover launch paths.

`FINAL_REPORT.md` must distinguish mocked, container-integrated, Agave
compatibility-oracle, native Firedancer, WokeNet public network, and manual
results.

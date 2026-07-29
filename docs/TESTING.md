# Testing strategy

Status: active implementation. Unit, Rust, Solana local-validator, PostgreSQL,
Kubo, real WebSocket relay, browser E2E, automated accessibility, and the local
validator-to-browser vertical slice have passing evidence. Public Solana
deployment, production security/resilience suites, the manual accessibility
matrix, release-grade Seeker Android/Mobile Wallet Adapter/signed-APK evidence, and
full cross-language conformance remain incomplete.

WokeNet is the WokeSocial protocol and smart-contract deployment layer on
Solana, not a chain or validator network. No `$WOKE` mint exists. The legacy
lamport payment ABI is quarantined and cannot execute or be unpaused; its tests
are regression evidence only.
No Firedancer/Agave validator topology is part of WokeNet.

## Verified evidence snapshot

| Surface | Current verified evidence | Important limit |
| --- | --- | --- |
| Protocol objects | All 29 current portable object families—schema v2 for profile/community/community-membership creation, schema v1 for the other families, and frozen v1 read compatibility for those three—plus deterministic RFC 8785 bytes and IDs, exact canonical-envelope decoding, NFC rejection, Ed25519 verification, action/state/role and author/transition checks, changed-payload rejection, authorization denial, and generated Draft 2020-12 schema drift | TypeScript fixtures only; no shared Rust/TypeScript golden corpus |
| Storage and SDK | Local CAS round-trip/deletion/corruption, permanence-consent gate, multi-provider quorum, Arweave-compatible receipt/readback validation, operation-scoped signed/recoverable publication, atomic identity+anonymous-name registration, current-sequence legacy migration, exact Agave multi-inner-group parsing, root-only schema-v2 community publication, exact member-bound membership PDA plus join/leave/remove/ban builders, landed-but-response-lost reconciliation, strict RPC parsing, and exact-byte compile/sign/simulate/broadcast/finalize execution | No funded live Arweave uploader, production provider, complete generated account client, flagship wallet/Mobile Wallet Adapter membership integration, executable-artifact attestation, or public-cluster transaction path |
| WokeNet program | Generated IDL with 43 instructions, 19 account layouts, and 33 events; passing Rust/SBF/local-validator gates cover member-authorized join/leave, creator-or-scoped-delegate remove/ban, terminal bans, sequence-safe governance snapshots, adversarial membership cases, and the broader program surface | Local scope only, with no devnet/mainnet-beta deployment, successful payment flow, `$WOKE` mint, replacement payment ABI, full fuzz/cross-language matrix, or independent audit |
| Indexer/PostgreSQL | Passing workspace/integration gates cover exact decoding/projection of all 33 IDL events; strict `.woke` name-to-stable-identity-to-current-root resolution with claim/identity checkpoint coverage; canonical profile-v2, community-v2, and membership-v2 verification; privacy-safe public/unlisted community projection and exact-address open-membership status; exact CID validation; accepted/pending/terminal disposition; bounded hydration; suppression-aware replay; one-way identity deactivation; 18 ordered migrations; the explicit `0018` predeployment rejection of incompatible community/membership/proposal history; exact-network APIs; deterministic pagination; and bounded `public-match-v2` search | The status route has no roster or identity-bearing fields. Migration `0018` requires fresh disposable PostgreSQL and local-validator state; it provides no in-place compatibility path. Fork/reorg behavior, independent-provider reconciliation, viewer-aware search, and production-scale rebuild evidence remain open |
| Feed provider | 38 cases cover all seven modes, transparent scoring, bounded trending, provider provenance/checkpoints, cursor binding, third-party reconciliation, local safety filtering, redirect-only-origin rejection, and fail-closed limiter startup ownership | Production candidate collection and a curated discovery registry are operator/client integrations |
| Crypto/passkey wrapping | 12 vectors cover random/hash/HKDF/AES-GCM and credential-bound WebAuthn-PRF Ed25519-seed wrapping, including substitution and malformed inputs | Package-level vectors do not prove protocol onboarding, recovery, or external review |
| Configuration | Unit cases plus real-TLS integration cover runtime-mode consistency, Solana cluster/RPC naming, origin/domain boundaries, verified database TLS and hostname/CA rejection, migration integrity, trusted proxies, secret isolation, service-specific parsers, shared Redis/HMAC admission configuration, and nonlocal fail-closed requirements | Configuration tests are guardrails, not production certificate, secret-manager, public-provider, or multi-replica evidence |
| Authentication service | 34 unit/API cases, four isolated PostgreSQL cases, one auth-service browser integration, and two real-Chromium flagship lifecycle flows cover exact-origin/RP ceremonies, one-time challenges, atomic initial credential/wrapper/activation, atomic authentication/session issuance against revocation, same-root additional passkeys, step-up revocation, whole-account session invalidation, survivor authentication, revoked-credential rejection, cross-tab CSRF recovery, bounded retention, readiness privilege/schema checks, and fail-closed custody/recovery policy | Protocol-identity creation, WokeNet delegation/device-authority integration, recovery, load evidence, and external review remain open |
| Pairwise messaging | Thirteen real-WASM cases cover independent device keys, Olm session establishment, canonical sender-signed outer envelopes, relay-mutation rejection before state mutation, post-session loss/reordering, duplicate/corruption/wrong-device rejection, local and remote authorization/revocation, malformed Unicode, bounded dependency stalls, production volatile-storage rejection, plaintext zeroization/non-disclosure, fixed errors, private runtime construction, and absent group APIs | Volatile memory state only; persistent encrypted browser state, pre-key retransmission, attachments, safety UX, relay integration, and independent review remain open |
| Shared admission limiting | 25 unit cases and six real-Redis integration cases cover atomic cross-client fixed windows, HMAC-derived private keys, namespace/service/deployment isolation, expiry, command/ACL readiness, bounded disconnects, no queued replay, partial-failure TTL safety, and explicit loopback-only memory mode | Relay replay nonces, connection/transport leases, sequence, retention/subscriptions, and fanout remain process-local; shared admission quotas alone do not make relay horizontally safe |
| Relay | 81 unit cases and 34 real-loopback WebSocket integration cases cover strict signed advisory envelopes, finalized key and expiring opaque-topic subscription authorization, topic/kind/audience scope enforcement, shared identity/IP admission quotas, fail-closed limiter outages, bounded replay/rate/backpressure state, pre-upgrade resource bounds, failover, reconnect, deduplication, and gap detection | Independent authorizer deployments, shared coordination for non-admission state, E2EE payload semantics, load evidence, and external review remain open |
| Moderation provider | 56 unit cases and four isolated PostgreSQL cases cover signed object verification, encrypted restricted evidence, append-only history, runtime-role delete denial, readiness privileges, legal holds, due/review/expiry transitions, and retention-safe maintenance | Production object authorizer, operator SSO, specialist workflows, and a separately credentialed reviewed retention executor remain open |
| Media worker | 70 adversarial unit cases, three real Sharp/FFmpeg/ffprobe integrations, and a real ClamAV 1.5.3 benign/EICAR container check cover resumability, hashes, MIME/container checks, filesystem races, bounds, metadata-free processing, HLS/waveforms, authorization, scanner protocol/freshness/provenance, and unsigned publication | Flagship browser upload, production multi-provider storage, codec sandbox/isolation evidence, load testing, and external review remain open |
| Kubo | Real local container publish, returned-CID verification, gateway retrieval, health, and unpin | No production provider or multi-gateway fault exercise |
| Connected local slice | A fresh validator and signed local CAS produced exactly 11 baseline finalized transactions, verified community and member-authored join manifests, privacy-safe exact-address membership status, 10-event destructive replay, production Next, and eight baseline browser checks. Real Chromium then atomically registered passkey identity + anonymous name, recovered one ambiguous post without rebroadcast, published a second post, strictly resolved the name, rebuilt all 14 events, and rendered both restored posts. Live sync proves the observed checkpoint; ledger replay separately proves coverage through the last durable event slot because later empty observation slots are not ledger events | Local identity/name/text-post/community/membership/follow/tombstone journey only; not devnet/mainnet-beta, Seeker Android, `$WOKE`, or full product breadth |
| Public Solana deployment | None | No WokeNet program is recorded on devnet or mainnet-beta |
| `$WOKE` replacement | Portable asset schema truthfully accepts SOL or exact SPL metadata and rejects `{ kind: "woke" }`; local program tests prove the legacy ABI fails closed without state/balance changes | No mint exists; legacy ABI cannot execute or be unpaused; mint-aware ABI/migration/audit absent |
| Seeker Android | Non-release Expo/React Native foundation with Mobile Wallet Adapter connection boundary, exact Solana deployment verification, read-only chronological feed/community discovery, honest failure states, focused unit tests, and Android export metadata | Membership mutation is absent; no verified Seeker-device run, program transaction flow, reproducible signed APK, signing provenance, secure update/rollback evidence, store submission, or publication |
| Web | Production build and passing unit/Playwright cases cover the current route surface, axe A/AA fixtures, semantic states, connected post detail, skip-link/navigation, high contrast, canonical-host redirects, bounded public search, local composer/preferences/hide/export, desktop passkey lifecycle, and the development-localnet atomic identity/name plus two-post transaction flow; duplicate mobile-viewport lifecycle flows are intentionally skipped | Public-cluster wallet transactions, cross-surface name UX, WokeNet delegation lifecycle, post-detail axe coverage, a manual WCAG conformance result, and native Android remain open |
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
- Keep a fast deterministic suite, but do not replace Solana local-validator
  and devnet, PostgreSQL, browser, native Android, storage, and network-failure
  coverage with mocks.
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
| Solana local-validator program | Anchor + disposable Solana local validator | PDAs, signers, constraints, events, replay, and close behavior | Core success/selected rejection paths pass locally; full matrix incomplete |
| Solana devnet rehearsal | Anchor/SBF artifact + public Solana RPC | Exact genesis/program/deployment binding, finalized execution/indexing, authority, restart/replay, and failure behavior | Not performed |
| Seeker Android | Android test stack + Seeker-compatible device/emulator + Mobile Wallet Adapter | Wallet intents/callbacks, permissions, signing UX, lifecycle, accessibility, reproducible signed APK, update/rollback | Non-release source, connection/deployment/feed boundary, focused unit tests, and export metadata exist; device/signing/release matrix not performed |
| Service integration | Vitest + Docker Compose or real loopback transport | PostgreSQL migrations, replay, storage, authentication, relay, moderation, search, worker behavior | PostgreSQL 18.4, Kubo, authentication PostgreSQL/browser, relay unit/real-WebSocket suites, moderation unit/PostgreSQL suites, indexer unit/PostgreSQL suites, public-search index/timeout/snapshot/parity/API/client cases, real media processors, and live ClamAV benign/EICAR checks pass; viewer-aware and production-scale search remain open |
| Connected local integration | Solana local validator + CAS + PostgreSQL + production services | Identity-to-feed vertical slice and projection rebuild | Connected local proof passes; devnet and alternate-provider variants are absent |
| Browser E2E | Playwright | Consumer flows, failure states, responsive viewports, keyboard, wallet/passkey UX | All current routes, local-state flows, search validation/degradation, keyboard, mobile viewport, and themes pass; real Chromium authenticators prove initial registration, same-root second-passkey addition, first-passkey revocation/session invalidation, survivor authentication, and revoked-credential rejection. Wallet and protocol-identity transactions remain absent |
| Accessibility | Playwright + axe + manual matrix | WCAG 2.2 AA | Automated A/AA scans pass over route fixtures in desktop and mobile-viewport web projects; post-detail axe coverage and the manual matrix are not executed |
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
- Solana local-validator and future devnet rehearsals use isolated deployment
  identities unless a test explicitly covers restart or replay.
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
  downgrade, including a legacy profile presented at/after the immutable
  profile-v2 activation slot, a schema-v2 community with a delegated or
  wrong-root signer, a signed nonce different from the PDA nonce, a mismatched
  governance commitment, and a rebuild attempted with a different cutoff.
  CID vectors include wrong case, length, fixed CID header, multicodec,
  multihash, and base32 padding; malformed references must become terminal
  before provider I/O.
- XSS payloads, dangerous URL schemes, tracking pixels, CSRF, SQL injection,
  SSRF, command injection, path traversal, decompression bombs, polyglot media,
  and log injection.
- Spam bursts, sponsor exhaustion, Sybil follows, report brigading, moderation
  conflicts, governance capture attempts, and metadata abuse.
- Recipient or token-account replacement, rejected `{ kind: "woke" }`,
  `$WOKE`/SOL/lamport confusion,
  unsupported mint/program/extension, duplicate payment, simulation mismatch,
  blockhash expiry, fee change, and false entitlement. The legacy ABI must
  reject bootstrap, execution, authority mutation, and unpause without changing
  state or balances.
- Message replay, removed-device delivery, key rollback, corrupted attachment,
  safety-number change, relay reordering, and reporter over-disclosure.

## Local Solana vertical-slice proof

The current completed integration milestone uses a disposable Solana local
validator for the following exact 11-transaction/10-event flow:

1. Start a fresh Solana local validator and PostgreSQL projection.
2. Create two identities and an inclusive profile through the program.
3. Canonicalize and sign text-post, schema-v2 public-community, and
   member-authored membership-join manifests.
4. Store and independently re-read the exact bytes by content address.
5. Anchor both references and the community PDA through finalized transactions.
6. Bind the community's signed nonce, creation root, and exact governance
   strategy to its finalized creation event.
7. Submit the viewer's member-authorized join against exact identity, state,
   membership-policy, and community-membership sequence snapshots.
8. Index only finalized/eligible events and verify all three manifests.
9. Assert exact-address privacy-safe membership status without a roster,
   member/actor identity, signer authority, moderation reason, or manifest
   location.
10. Follow the author and display the verified post and discoverable community
    in the production web application.
11. Clear every row in the selected network projection, rebuild exactly ten
    durable events, and recheck the feed, membership status, address-routed
    community detail, bounded directory, and exact-network public search.

The connected harness checks exact object ID, CID, payload hash, finalized
anchor, tombstone suppression, following projection, zero replay dead letters,
and exact pre/post replay state. Adjacent protocol/indexer tests reject changed
bytes, invalid signatures, wrong authors, duplicates, and invalid manifests.
`pnpm test:vertical-slice` passed this proof with zero dead letters, exact
pre/post replay state, and eight production-browser checks—four before replay
and four after. It is included in `pnpm verify:all` and the program integration
CI lane. It does not prove devnet/mainnet-beta, Seeker Android, Mobile Wallet
Adapter, signed-APK, or `$WOKE`-mint behavior.

The public-deployment gate must repeat the flow on Solana devnet with an exact
genesis/program/deployment-slot record, reviewed authority, finalized indexing,
restart/replay and provider-failure exercises, and a reproducible program
artifact. The mobile release gate is separate and requires native
Seeker/Mobile Wallet Adapter/device, reproducible signed-APK, signing,
update/rollback, and distribution evidence beyond the current foundation. The
payment gate is also separate and cannot begin by unpausing the legacy ABI.

## CI evidence

The repository has CI workflows for the implemented gates. The desired release
evidence contract is that every CI job records tool versions, immutable
dependency lockfiles, commit, command, duration, test counts, and artifacts.
Flaky retries may diagnose
infrastructure but cannot turn a failing product assertion green. Quarantined
tests remain visible and block the completion gate when they cover launch paths.

`FINAL_REPORT.md` must distinguish mocked, container-integrated, Solana
local-validator, devnet/mainnet-beta, native Android/device, token-mint, and
manual results.

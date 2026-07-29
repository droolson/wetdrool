# Final verification report

- Date: 2026-07-29
- Canonical public origin: `https://woke.social`
- Legacy redirect origins: `https://sociallywoke.com` and
  `https://www.sociallywoke.com`
- Network target: WokeNet, native currency `$WOKE`
- Repository identity: local directory and root package `wokenet`; no Git remote
  is configured

## Executive summary

This repository delivers a substantial, tested social-protocol foundation and
a reproducible **experimental** WokeNet/Firedancer downstream scaffold. It
does not deliver a production blockchain, a public WokeNet testnet/mainnet, or a
production deployment artifact. Repository inspection found no evidence of a
production social-network deployment; it cannot establish whether unrelated
external systems exist.

The following claims are supported by passing local evidence:

- `woke.social` is the only canonical public origin in application policy.
  Exact bare and `www` legacy hosts return permanent, path/query-preserving
  `308` redirects in the production Next.js server.
- The monorepo, protocol schemas, Anchor program, SDK, indexer, feed provider,
  relay, storage providers, authentication subset, moderation subset, media
  worker, pairwise messaging adapter, and complete route surface build and pass
  their documented tests.
- Deployed HTTP services and relay share a fail-closed Redis rate limiter with
  HMAC-only client keys, dependency-aware readiness, bounded commands, and
  explicit loopback-only memory mode. Two independent Redis clients with the
  same deployment/service identity consume one tested quota; service,
  deployment, namespace, and expiry isolation also pass. Relay replay,
  connection leases, sequence, retention/subscriptions, and fanout remain
  process-local, so the relay remains single-replica pending shared coordination
  and cross-replica pubsub.
- Native WOKE tip and weekly-subscription program primitives, receipts,
  entitlements, SDK instruction builders, allocation checks, simulation
  comparison, exact-byte transaction execution, and finalized-account proof
  verification pass against strict mock RPC and an Agave compatibility oracle.
- The flagship consumes a bounded, checkpointed public-search contract for
  verified public posts and current public profiles, with explicit empty,
  invalid, and unavailable states rather than fabricated results.
- Real Chromium WebAuthn ceremonies prove initial PRF-backed registration,
  same-root second-passkey enrollment, fresh step-up, selected-credential
  revocation with session invalidation, survivor authentication, and rejection
  of a genuine assertion from the revoked credential.
- A local compatibility slice creates signed content and finalized program
  state, syncs it into PostgreSQL, serves it through the production indexer and
  production Next.js build, destroys the projection, replays it, and obtains
  identical desktop/mobile results.
- WokeNet source policy is pinned to one exact official Firedancer commit,
  one exact ordered downstream patch queue, and one exact OpenSSL source commit.
  The materializer and supported-Linux binary-attestation command reject Agave,
  Frankendancer, `fdctl`, pre-existing build output, inherited build injection,
  source drift, dependency drift, and unbound binaries.
- The repository root, package name, package scope, platform IDs, chain IDs,
  environment-variable namespaces, and wire namespace pass an automated naming
  policy: WokeSocial/`wokesocial` is the application platform and
  WokeNet/`wokenet` is the chain and repository.

Production activation remains blocked. Upstream says full no-Agave Firedancer
has no release and is not ready for test or production use. The downstream adds
a bounded native `getProgramAccounts` subset with direct native C conformance
tests, but it is not unrestricted RPC conformance or connected-cluster
evidence. Five required RPC methods remain explicitly unimplemented. No native
WokeNet cluster has been built and launched end to end, no production genesis
or economic policy is approved, no native program deployment exists, and no
independent security or legal review has been completed. Agave is retained only
as a Solana-wire compatibility oracle and is forbidden as WokeNet runtime.

## Status vocabulary

| Status                                       | Meaning in this report                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Implemented and tested                       | Code exists and the stated local automated evidence passed                                                              |
| Implemented; external configuration required | Code exists, but a provider, account, secret, DNS record, or production operator must configure it                      |
| Experimental                                 | A real subset exists, but native execution, integration, review, or operational evidence is insufficient for production |
| Planned                                      | Documented design or task without a complete implementation                                                             |
| Not implemented                              | The repository does not provide the capability                                                                          |

## Architecture delivered

| Layer                | Delivered architecture                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status and boundary                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace            | Strict pnpm/Turborepo monorepo with 16 workspaces: seven apps and nine packages                                                                                                                                                                                                                                                                                                                                                                                                    | Implemented and tested                                                                                                                                                                                                                      |
| Web                  | Next.js App Router reference client with 46 page files, canonical-host proxy, provider settings, provider-backed public search, read-only/degraded states, device-local composer/preferences/export, and responsive themes                                                                                                                                                                                                                                                         | Implemented and tested subset; transactional product flows remain gated                                                                                                                                                                     |
| Portable protocol    | 29 versioned object families, RFC 8785 canonical bytes, SHA-256 object identifiers/CIDs, Ed25519 signatures, authorization transitions, and generated Draft 2020-12 JSON Schema                                                                                                                                                                                                                                                                                                    | Implemented and tested TypeScript subset; shared Rust/TypeScript golden corpus remains planned                                                                                                                                              |
| WokeSocial program   | Anchor/SBF program with configuration, identities/profiles, handles, root rotation, delegation, recovery, follows/blocks, communities, voting, posts/reactions/tombstones, WOKE tips, subscriptions, receipts, and entitlements                                                                                                                                                                                                                                                    | Implemented and tested only against the Agave compatibility oracle                                                                                                                                                                          |
| WOKE SDK             | Operation-scoped signed publication, eight IDL-aligned Anchor builders including one-way identity deactivation, PDA/allocation checks, strict simulation/finalized-proof verification, and an exact-byte version-0/legacy transaction executor                                                                                                                                                                                                                                     | Implemented and tested subset against strict mock RPC; wallet/passkey signer integration and native Firedancer execution remain open                                                                                                        |
| Indexer              | Solana-format finalized sync, exact decoding/projection of all 33 events, canonical CIDv1/base32-lower/raw/SHA-256 URI validation, onchain profile-v2 commitment plus immutable legacy cutoff, explicit accepted/pending/terminal manifest state, checkpoint-independent bounded hydration/retry/DLQ, detached non-gating tombstone metadata, suppression-aware exact-source replay, provenance, bounded public search, REST/OpenAPI, and sixteen PostgreSQL projection migrations | Implemented and tested with 185 unit cases across 20 files and 27 PostgreSQL cases across 11 files; native Firedancer RPC, fork/reorg, independent-provider reconciliation, and production-scale rebuilds above 50,000 events remain absent |
| Replaceable services | WebAuthn auth service, seven-mode feed service, signed WebSocket relay with bounded finalized key and expiring opaque-topic subscription authorization adapters, moderation service, hardened media worker, and shared fail-closed Redis admission                                                                                                                                                                                                                                 | Implemented and tested subsets; independent authorizer deployments, provider accounts, SSO, storage, and telemetry require configuration                                                                                                    |
| Storage              | Memory/local CAS, quorum provider, Kubo/IPFS adapter, and consent-gated Arweave-compatible adapter                                                                                                                                                                                                                                                                                                                                                                                 | Implemented and tested locally; funded/permanent production providers require external configuration                                                                                                                                        |
| Messaging            | Pairwise Olm adapter backed by Matrix Rust crypto WASM, signed routing envelope, authorization/revocation checks, and fail-closed production storage policy                                                                                                                                                                                                                                                                                                                        | Experimental; volatile state only, without browser persistence, attachments, safety UX, or group messaging                                                                                                                                  |
| WokeNet              | Pinned native Firedancer source/patch policy, native-only configs, WOKE genesis policy, capability record, materializer, source checker, genesis byte-hash verifier, and isolated Linux binary-attestation gate                                                                                                                                                                                                                                                                    | Experimental scaffold; no passing native connected cluster or production release                                                                                                                                                            |
| Operations           | Threat model, security, privacy, accessibility, deployment, incident, decentralization, legal-review, and nine ADR documents                                                                                                                                                                                                                                                                                                                                                       | Implemented documentation; production drills and independent reviews are open                                                                                                                                                               |

## WokeNet and `$WOKE`

### Implemented source and policy controls

- Official Firedancer upstream:
  `60c3d2e381a6607f63adc818481e2f31472ae681`.
- Downstream marker: `WokeNet Firedancer downstream-v1`.
- Downstream genesis patch:
  `0001-explicit-sovereign-genesis-allocations.patch`, SHA-256
  `7d1f6419c7325cdfbe777df740a0f5708f1de510d3b4e650a4e9483982767806`.
- Downstream bounded native program-account RPC patch:
  `0002-native-get-program-accounts.patch`, SHA-256
  `5027ea430dc2022847ed4fd9efbf5dfaddcc28f9b4cfc31a7a1854307b35d274`.
- Downstream fail-closed WokeNet live-cluster safety patch:
  `0003-wokenet-live-cluster-safety.patch`, SHA-256
  `77df8b7ab1a48674093c0935e3915c20eeaa1cbe956dee9226cd9a1960a9e454`.
- Downstream native non-voting RPC observer patch:
  `0004-native-non-voting-rpc-observer.patch`, SHA-256
  `1504fb4c382bd181a253edb807400b8824e7ee339f0f3b0c1d13cae18ba808b6`.
- Downstream native C-test execution fixes:
  `0005-native-c-test-execution-fixes.patch`, SHA-256
  `aea19cf90e32eaddfa95ed4fda0a0add68c818216308717ab327ca89015356ca`.
- Pinned OpenSSL dependency: tag `openssl-3.6.2`, commit
  `fe686e15d84334b284f883118ed92f64b409b3aa`.
- Native binaries: `firedancer` for public validator/RPC roles and
  `firedancer-dev --no-agave` for local development.
- Forbidden runtime binaries: `agave-validator`, `fdctl`, `fddev`, and
  `solana-test-validator`.
- Currency policy: native WOKE, ticker `WOKE`, nine decimals,
  `1 WOKE = 1,000,000,000` base units. `lamport` remains only the compatible
  wire/base-unit name. WOKE is not an SPL token and has no mint address.
- Production traffic and production genesis flags are fail-closed.
- The genesis verifier proves an exact SHA-256/Base58 byte-hash match only. It
  deliberately reports `semanticGenesisValidation: false`; it does not prove
  supply, allocations, authorities, features, rewards, inflation, or shred
  version.

The isolated binary checker creates fresh fixed-`/tmp` source and build roots,
reapplies only the pinned patch queue, clones and rebuilds the pinned OpenSSL
source, runs `test_genesis_create`, `test_accdb`, `test_rpc_tile`,
`test_config_parse`, and `test_tower_tile`; checks
ELF64 little-endian x86-64 executables, requires defined global native function
symbols, verifies exact version/commit branding, rejects forbidden dynamic
dependencies, parses native tile topology, hashes evidence, and removes the
disposable checkout.

### Native RPC status

The capability record intentionally distinguishes source observation from
direct native C unit conformance. Neither classification is connected-cluster,
full Solana-RPC, performance, or production evidence.

| Required native read                                                              | Recorded evidence and boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getAccountInfo`, `getBalance`, `getGenesisHash`, `getLatestBlockhash`, `getSlot` | Method-body source observation only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `getMultipleAccounts`                                                             | Direct native C unit-test coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `getProgramAccounts`                                                              | Downstream native account-database owner scan on a referenced frozen fork, with direct `test_accdb` and `test_rpc_tile` C coverage. The bounded subset supports `dataSize` and byte-comparison filters, binary/base58/base64/base64+zstd encodings, data slicing, minimum-context-slot checks, optional context, and result sorting. It rejects `tokenAccountState` and `jsonParsed`, and caps requests at four filters, 1,024 results, 4,000,000 scan work units, 64 MiB of owner-matched data read during scanning, and 32 MiB of filter-matched account data before slicing. `productionComplete` remains false. |

The five required methods still explicitly unimplemented in the pinned source
are `getSignaturesForAddress`, `getSignatureStatuses`, `getTransaction`,
`sendTransaction`, and `simulateTransaction`.

`getSignatureStatuses` is design-only: the checked-in design records the
required snapshot/live result cache, commitment, fork, and direct C-test work,
while the capability remains false and no implementation is claimed. The SDK
payment executor also requires
`getMinimumBalanceForRentExemption`; the current native capability record does
not claim or directly test that method. A disposable audit under Linux/x86-64
Docker emulation compiled and passed the downstream `test_accdb`,
`test_rpc_tile`, and `test_config_parse` cases.

The fourth downstream patch implements an exact WokeNet-only non-voting RPC
observer source role and direct C tests. It retains the virtual tower’s local
fork choice, reset, and root path while skipping own vote-account reconciliation
and preventing vote-transaction construction. The fifth patch repairs the
shared default-config validation fixture, registers the captured test voters,
crosses the 33-slot root threshold, and uses a container-safe mmap-backed unit
workspace. The exact queue’s `test_config_parse` and `test_tower_tile`
executables pass under disposable Linux/x86-64 Docker emulation. The RPC
template still has no connected native boot evidence, and the emitted tower
reset/root path has not been integrated through replay into RPC
finalized-commitment publication or cache pruning. The pinned source opens tower
checkpoint/restore descriptors but has no observed serialization/restore
implementation, so observer restart commitment continuity and health gating are
also unproven. The broader binary-attestation audit remains incomplete: its
synthetic sysfs fixture stopped before the complete topology phase. No retained
complete attestation artifact or native cluster claim exists.

## Features delivered

### Implemented and tested

- Canonical `woke.social` origin and permanent exact-host legacy redirects.
- Complete documented web route surface with explicit disabled/degraded states
  instead of fake mutation success.
- Portable signed object, storage, publication, indexer, replay, feed, relay,
  moderation, authentication, media-processing, and provider-selection
  subsets.
- Anchor program with 41 instructions, 19 account types, 33 events, 122 errors,
  and 92 IDL types.
- Root-authorized, sequence-guarded one-way identity deactivation with exact
  wrong-root, substitution, replay, and already-inactive validator coverage.
- Delayed guardian-threshold recovery primitive and one-active-member-one-vote
  governance primitive.
- Native WOKE tip and weekly-subscription compatibility primitives with
  permanent receipt/entitlement accounts and exact value conservation.
- Seven WOKE SDK instruction builders with one-to-three-recipient allocation,
  account-order/signer/writable checks, replay context, optional-account
  sentinels, simulation verification, and finalized proof verification.
- Exact-byte WokeNet transaction execution with explicit network/program
  context, locally verified detached signatures, strict simulation-effect
  decoding, deterministic same-byte rebroadcast, blockhash-expiry handling, and
  bounded finalized confirmation.
- Operation-scoped SDK publication signing with a canonical payload snapshot and
  pre-storage rejection of signer payload, identity, key, or signature
  substitution.
- Sixteen indexer, five auth, and three moderation SQL migrations.
- A per-network immutable `INDEXER_PROFILE_V2_ACTIVATION_SLOT`: legacy profile
  v1 remains readable only for legacy-prefix events before the cutoff, current
  root and delegated updates commit schema version 2 onchain, explicit
  non-v2 commitments fail, and exact-source rebuild applies the same gate.
- Durable accepted/pending/terminal manifest ingestion: transient storage
  failure advances checkpoints without exposing unverified content, exact
  fingerprint promotion cannot advance identity sequence twice, deterministic
  failures are terminally quarantined, and the runtime role cannot update or
  delete the raw ledger.
- Pending hydration is checkpoint-independent and batch-bounded: every sync
  poll drains due work even when no new signature or checkpoint movement
  occurs. A profile verified only after identity deactivation is retained as
  historical state without restoring public person discovery.
- Manifest references use exact CIDv1/base32-lowercase `raw`/SHA-256 IDs in the
  shared IPFS, local, Arweave-transaction/CID, or credential-free HTTPS/CID
  grammar. Malformed references are terminal before provider I/O.
- Finalized tombstones suppress from their authenticated onchain target without
  provider I/O; optional legacy object/CID/hash fields are detached audit
  metadata. Rebuild similarly skips accepted-manifest I/O only for durably
  accepted obsolete posts/profiles proven by the complete ordered ledger,
  while preserving accepted raw state, sequence/reference effects, and
  checkpoint.
- Provider-backed public profile/post search with indexed deterministic ranking,
  tombstone and visibility suppression, repeatable-read checkpoint evidence,
  bounded database/client resource use, strict response parsing, and honest
  invalid/unavailable states.
- Pairwise encrypted-message cryptographic adapter and real WebAuthn
  service-account ceremony subset. Initial credential/wrapper/activation,
  additional same-root passkeys, authentication/session issuance, and
  credential revocation are atomic at their respective store boundaries.
- Browser service-passkey listing, same-root addition, step-up-protected
  revocation, and cross-tab CSRF recovery. Service-passkey revocation does not
  claim to revoke a separate WokeNet delegation.
- Real two-authenticator Chromium coverage for enrollment, step-up, revocation,
  whole-account session invalidation, survivor sign-in, and revoked-credential
  rejection against the production auth application with an in-memory test
  store.
- Desktop/mobile browser semantics, accessibility automation, and a
  reproducible local production-browser performance observation.

### Implemented; external configuration required

- DNS, TLS, hosting, and edge routing for `woke.social`,
  `sociallywoke.com`, and `www.sociallywoke.com`.
- Production PostgreSQL roles/TLS, authenticated Redis with a deployment-scoped
  32-byte rate-limit HMAC secret, Kubo/pinning providers, gateways, and a funded
  Arweave-compatible uploader.
- Auth relying-party origin/ID, credential and session secrets, independent
  finalized-state relay key and policy/membership authorizer deployments, moderation object
  authorization/SSO, ClamAV, private media bearer credentials, and production
  media storage.
- Public indexer/feed/relay/moderation/storage endpoints and provider registry.
- External provider accounts, a verified security mailbox, and production
  operator keys.

### Experimental

- The native Firedancer WokeNet downstream and native RPC path.
- Every WOKE settlement result, because execution evidence currently comes from
  the compatibility oracle rather than native Firedancer.
- Creator WOKE tips/subscriptions and passkey-to-protocol identity integration,
  because the SDK executor is not yet connected to a flagship wallet/passkey
  signer or a native Firedancer RPC endpoint.
- Pairwise Olm messaging, because durable encrypted state, browser/relay
  integration, attachment handling, safety-number UX, and independent review
  are absent.

### Planned

- Native WokeNet localnet, public testnet, devnet/staging, and mainnet.
- Production genesis ceremony, supply, allocation, inflation, fee, rewards, and
  validator-economics policy.
- Wallet onboarding, sponsorship, WokeNet delegation/device-authority
  lifecycle, email/product recovery, rich publication, uploads, and live
  payment UX. Authentication-service passkey list/add/revoke is already
  implemented.
- Persistent encrypted messaging, attachments, safety-number UX, selective
  reporting, and paid-content delivery.
- Viewer-aware and provider-conformant search expansion, creator/event
  discovery, full story/livestream semantics, paid communities/events, refunds,
  and additional governance strategies.
- Manual WCAG review, field Core Web Vitals, load/capacity, regional latency,
  resilience, restore, failover, and incident exercises.
- Production multisig/upgrade authority, SBOM, signed provenance/artifacts, and
  independent operators.
- Deployable production artifacts, privacy-controlled observability and
  alerting, backup/restore automation and evidence, rollback/failover exercises,
  and incident drills.

### Not implemented

- Native versions of the five required missing RPC methods.
- A deployed native WokeNet validator/RPC cluster or WokeSocial program deployment.
- Group encrypted messaging.
- A production exchange, lending, yield, public sale, bridge, or custodial
  wallet. These are intentionally outside the delivered subset.
- A production deployment artifact or real-funds operation in this repository.
  External systems not represented by repository evidence were not assessed.

## Test counts and results

Application, integration, and browser results were obtained on 2026-07-28. The
final workspace verification, exact-commit clean-checkout build/program gate,
and native observer C-test execution completed on 2026-07-29. Incomplete native
evidence remains marked explicitly.

| Gate                       | Result                                                   | Evidence boundary                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frozen install             | Pass: 660/660 packages reused, zero downloaded           | Offline, lockfile-frozen install in an exact-commit clone; same-host pnpm content-store assisted                                                                                                       |
| Current committed clone    | Pass at `1513571e61ccf16ff3a715bc975b355646a0e935`       | Fresh `git clone --no-hardlinks`, initially clean with no `node_modules`; final tracked status clean; same-host rather than independent-machine evidence                                               |
| `pnpm verify`              | Pass                                                     | Workspace/naming/domain/network policy, formatting, lint, typecheck, unit, build, local production redirect probe                                                                                      |
| Naming policy              | Pass                                                     | Repository/package `wokenet`; platform `WokeSocial`/`wokesocial`; network `WokeNet`/`wokenet`                                                                                                          |
| Type checks                | 15/15 workspaces pass                                    | Strict TypeScript configuration                                                                                                                                                                        |
| Unit command               | 920 passing test executions                              | 907 workspace Vitest cases plus 13 repository script tests; messaging’s real-WASM file also runs in integration, so cross-gate totals are not unique                                                   |
| Integration command        | 85 passing across 19 files                               | Verified database TLS, isolated PostgreSQL 18.4, media processors, WebSocket relay, real WASM, and Kubo                                                                                                |
| Rust program tests         | 24 passing                                               | Sizing, validation, PDA/discriminator, sequence, allocation, profile-v2, and canonical manifest-URI helpers                                                                                            |
| Program compatibility      | 34/34 passing                                            | Real Agave local validator; compatibility evidence only                                                                                                                                                |
| Web Playwright             | 206 pass, 2 intentional mobile passkey lifecycle skips   | Desktop Chrome and Pixel 7 projects                                                                                                                                                                    |
| Auth browser E2E           | 1 pass                                                   | Chromium virtual authenticator                                                                                                                                                                         |
| Root browser total         | 207 pass, 2 skips                                        | Does not include the connected-slice executions                                                                                                                                                        |
| Connected slice            | 2 desktop/mobile passes before replay and 2 after replay | Nine finalized transactions, eight replayed events, zero dead letters                                                                                                                                  |
| IDL/indexer drift          | Pass                                                     | Checked-in decoder and projection exhaustively cover all 33 IDL events, including one-way identity deactivation                                                                                        |
| Domain production probe    | Pass                                                     | Local production-mode server with Host headers: exact legacy hosts preserve path/query in `308` redirects                                                                                              |
| WokeNet static policy      | Pass                                                     | Source locks, patch queue, config, native-only policy, capability record, and fail-closed production flags                                                                                             |
| WokeNet source apply/check | Pass                                                     | Fresh disposable checkout at the pinned upstream commit accepted the exact ordered downstream patch queue and source audit                                                                             |
| Bounded native RPC C unit  | Pass under Linux/x86-64 Docker emulation                 | Materialized downstream `test_accdb` and `test_rpc_tile` cover the bounded `getProgramAccounts` subset; not a complete binary or cluster attestation                                                   |
| RPC observer C unit        | Pass under Linux/x86-64 Docker emulation                 | `test_config_parse` and `test_tower_tile` cover the exact role matrix, vote suppression, reconciliation skip, virtual root advancement, and pruning; no connected boot or tower→replay→RPC integration |
| Native binary/cluster      | Not passed                                               | macOS cannot run the Linux-only binary gate; no complete attestation artifact or native connected cluster                                                                                              |
| Dependency audit           | Pass at check time: no known vulnerabilities reported    | Registry snapshot only; Node advisory caveat below                                                                                                                                                     |
| Secret scan                | Pass: committed history and working tree, no leaks       | Gitleaks rules, complete current history, and current tracked candidate files                                                                                                                          |

### Unit test executions by workspace

| Workspace          | Passing |
| ------------------ | ------: |
| Auth service       |      34 |
| Feed service       |      36 |
| Indexer            |     185 |
| Media worker       |      70 |
| Moderation service |      56 |
| Relay              |      81 |
| Web                |      81 |
| Configuration      |     144 |
| Crypto             |      12 |
| Messaging          |      13 |
| Protocol           |      85 |
| SDK                |      85 |
| Storage            |      22 |
| Test fixtures      |       4 |
| Repository scripts |      13 |
| **Total**          | **920** |

### Integration executions by surface

| Surface               | Passing |
| --------------------- | ------: |
| Auth PostgreSQL       |       4 |
| Configuration TLS     |       4 |
| Indexer PostgreSQL    |      27 |
| Media processors      |       3 |
| Moderation PostgreSQL |       4 |
| Relay real WebSocket  |      29 |
| Messaging real WASM   |      13 |
| Kubo/IPFS             |       1 |
| **Total executions**  |  **85** |

## Build results

- Exact commit `1513571e61ccf16ff3a715bc975b355646a0e935` passed the
  canonical gate from a fresh no-hardlink clone: offline frozen install,
  workspace/naming/domain/WokeNet policy, formatting, lint, build-before-typecheck
  ordering, 920 local test executions, all production builds, and the local
  production redirect probe. The clean checkout then installed the pinned
  Rust/Agave/Anchor toolchains, passed 24 Rust tests and 34 compatibility
  local-validator flows, regenerated the program artifacts, passed IDL/event
  drift, and remained clean. This is same-host, cache-assisted evidence.
- All 14 workspaces with production build scripts passed; all 15 workspaces
  passed type checking. The UI package is typechecked and consumed by the web
  build but has no separate build script.
- The final Next.js 16.2.12 build completed all 33 static-generation pages. It
  contains 46 application page files, with 32 static route entries including
  `_not-found` and 15 dynamic routes.
- The current SBF artifact is `1,607,032` bytes with SHA-256
  `485563697eace6a3f1fb9c8475ee42518b89db793b77b08282af3b9559380a08`.
- The current regenerated IDL is `315,340` bytes with SHA-256
  `84c8112c6ccb28412eb79baef3e1a7e09791cfb0f9da30903b40f4770361a172`
  and declares program `9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD`.
- No native Firedancer validator binary was built or launched. Across the
  bounded-RPC and final observer audits, four distinct native C unit-test
  executables were built and run under Linux/x86-64 Docker emulation:
  `test_accdb`, `test_rpc_tile`, `test_config_parse`, and `test_tower_tile`. The
  final exact-five-patch observer audit rebuilt and ran the latter two. The
  complete Linux binary/topology checker remains a separate, incomplete
  evidence gate.
- No web, service, program, or validator artifact has been published or signed
  as a production release.

## Security checks

Passing local checks:

- `pnpm audit --audit-level moderate` reported no known vulnerabilities.
- Gitleaks reported no leaked secrets.
- Formatting, lint, strict type checking, protocol schema drift, IDL event
  drift, repository naming, canonical-domain policy, and local
  production-server redirect probes passed.
- Protocol, storage, auth, indexer, relay, moderation, media, recovery,
  governance, and payment suites include malformed input, substitution,
  authorization, replay, stale-state, alias, balance-conservation, and
  corruption cases.
- WebAuthn is exact-origin/RP bound and requires user verification,
  discoverability, resident-key semantics, no attestation, canonical binary
  encodings, and PRF support before initial account verification. The service
  stores only a credential-bound encrypted root wrapper, commits initial
  credential/wrapper/activation atomically, and commits authentication counter
  update/session issuance atomically against revocation.
- Additional service passkeys must wrap the same root, revocation requires fresh
  step-up and revokes service sessions, cross-tab CSRF state is recoverable from
  the bound session, and sensitive browser buffers are cleared on best effort.
  These controls do not claim to revoke WokeNet delegation authority.
- The WokeNet transaction executor rejects signer-set and signature mismatch,
  provider/genesis drift, blockhash substitution or expiry, stale simulations,
  unexpected System Program effects, settlement-event/account-creation
  substitution, mismatched broadcast signatures, and nonfinal or failed
  transaction statuses. Requests, retries, rebroadcasts, polling, and total
  operation time are bounded.
- WokeNet binary tooling sanitizes child environments, disables ambient Git
  configuration/replacements, uses pinned source/dependencies, builds in fresh
  roots, and verifies defined ELF symbols and native-only topology.
- Root production configuration rejects mismatched runtime mode, localnet,
  non-finalized commitment, loopback or insecure browser/RPC/storage
  dependencies, non-TLS Redis, and missing program/session values. Standalone
  relay/auth/moderation development bypasses and the public local media token
  are forbidden in production. These are configuration guardrails, not
  production deployment evidence.

Security gate limitations:

- Node 22.23.1 is the newest published v22 artifact at report time, but it
  predates the 2026-07-27 advisory announcing replacement 22.x/24.x/26.x builds
  for issues up to HIGH severity. No patched 22.x version was named or published
  in the official index when checked. Production release must wait for and
  validate the replacement.
- No independent security audit, clean-machine release attestation, signed
  SBOM/provenance, public native cluster, production multisig, backup/restore
  exercise, or incident drill exists.
- The local dependency audit cannot establish the security of unreleased
  Firedancer source or future production infrastructure.

## Accessibility checks

- The web suite passed 206 browser cases with two intentionally skipped mobile
  passkey lifecycle cases; the real state-changing ceremonies run once in
  desktop Chromium.
- Axe ran 90 A/AA scans over 45 route fixtures: each fixture in desktop Chrome
  and Pixel 7 Chromium.
- Two additional theme-state checks passed, along with skip-link, keyboard
  navigation, high-contrast, responsive, semantic-state, and disabled-mutation
  checks.
- Connected post detail has semantic desktop/mobile browser coverage but is not
  yet part of the axe matrix.

These automated results do not establish WCAG 2.2 AA conformance. No complete
manual keyboard, VoiceOver/additional-screen-reader, zoom/reflow, forced-colors,
reduced-motion, captions, or RTL/localization matrix has been executed.

## Performance measurements

`pnpm measure:performance` ran three samples per route against the local
production Next.js build on macOS arm64, Node 22.23.1, loopback networking, and
an unthrottled headless Chromium browser. Values are per-route medians.

| Route       |    TTFB | DOM content loaded |    Load | LCP observation | CLS observation |
| ----------- | ------: | -----------------: | ------: | --------------: | --------------: |
| `/`         |  2.5 ms |            27.7 ms | 49.0 ms |           68 ms |               0 |
| `/home`     | 13.1 ms |            34.4 ms | 54.4 ms |           80 ms |               0 |
| `/feeds`    |  2.8 ms |            28.9 ms | 46.3 ms |           40 ms |               0 |
| `/protocol` |  3.6 ms |            25.5 ms | 44.7 ms |           40 ms |               0 |
| `/settings` |  2.2 ms |            28.4 ms | 46.0 ms |           40 ms |               0 |

This is a laboratory observation, not field Core Web Vitals. It excludes INP,
network throttling, production RPC/indexer/auth/media/storage latency, regional
edges, load, long-feed behavior, and capacity.

Compatibility-validator cost observations keep the tested program
transactions below the Solana packet/compute ceilings. The largest recorded
transaction in the current suite was an 892-byte subscription settlement; the
largest recorded compute use was 67,399 units. These are Agave
compatibility-oracle measurements, not native Firedancer performance evidence.

## Program IDs and deployments

| Environment                    | Program ID                                     | Status                          |
| ------------------------------ | ---------------------------------------------- | ------------------------------- |
| Agave compatibility localnet   | `9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD` | Ephemerally deployed and tested |
| Native WokeNet localnet        | None                                           | Not deployed                    |
| WokeNet devnet                 | None                                           | Not deployed                    |
| WokeNet public testnet/staging | None                                           | Not deployed                    |
| WokeNet mainnet                | None                                           | Not deployed                    |

There is no WOKE mint address because WOKE is specified as the network’s native
currency rather than an SPL token.

## Remaining external configuration

1. Configure and verify DNS/TLS/hosting for `woke.social`; route both legacy
   hosts to the redirect deployment.
2. Provision hardened PostgreSQL, Redis, Kubo/pinning, permanent storage,
   ClamAV/media, auth, feed, indexer, relay, and moderation infrastructure.
3. Set production RP/origin, service credentials, finalized-state
   authorizers, encryption keys, private bearer credentials, secret-manager
   references, and least-privilege database roles.
4. Configure multiple provider endpoints, monitoring, privacy-safe telemetry,
   alerts, backups, restores, rollback, and incident ownership.
5. Establish production entity, security mailbox, terms/privacy/community
   policies, operator agreements, and legal/regulatory review.
6. When upstream permits, build and attest the pinned native Firedancer
   downstream on supported Linux x64, complete RPC conformance, generate and
   semantically review genesis, run independent nodes, and repeat the connected
   slice without Agave.

## Known limitations

- Full native Firedancer is unreleased and upstream labels it unready even for
  test use.
- Five required native RPC methods are explicitly unimplemented. The bounded
  native `getProgramAccounts` subset is not unrestricted production conformance.
- Static source observations and direct native C/isolated binary tests are not
  cluster, consensus, restart, replay, finality, fee, or failure evidence.
- Production WOKE supply, allocation, inflation, rewards, fees, validator
  economics, public-sale policy, and genesis ceremony are unapproved.
- The WOKE SDK now compiles, signs, simulates, broadcasts, and finalizes one
  immutable Solana-format transaction under strict mock-RPC tests. Native
  execution remains blocked by absent Firedancer RPC methods; flagship
  wallet/passkey prompts and sponsorship are not connected; executable
  artifact/upgrade-authority attestation and finalized receipt/account proof
  remain separate explicit checks.
- Native payment settlement, wallet onboarding, protocol-identity/passkey
  integration, production recovery UX, and real-funds operation are absent.
- Messaging state is volatile; group messaging is absent.
- Media processing exists, but flagship upload/publication is not connected.
- Public profile/post search is a real replaceable service subset. Viewer-aware
  block/mute filtering, verified community discovery, creator/event discovery,
  independent-provider conformance, and production-scale relevance/load
  evidence remain absent.
- Manual accessibility, field performance, load, resilience, provider-loss,
  restore, and disaster-recovery evidence is absent.
- No production deployment evidence or artifact exists in this repository; no
  independent client/operator, independent security audit, or legal approval is
  represented.

## Mainnet-readiness assessment

**Not ready. Production activation is prohibited by repository policy and
cannot be enabled through configuration alone.**

Minimum blocking work:

1. Obtain a supported full native Firedancer release or independently validate
   and assume responsibility for the unreleased source.
2. Implement and independently test all required native RPC methods.
3. Produce deterministic native build artifacts, SBOM/provenance, signatures,
   and clean-machine attestations.
4. Complete semantic genesis/economic policy, ceremony, independent review,
   and multi-operator launch.
5. Deploy and validate the social program and SDK on native WokeNet.
6. Repeat program, indexer, payment, replay, restart, failover, and connected UI
   tests against native validator/RPC nodes.
7. Complete wallet/key/recovery/payment product UX, security review, Node
   security upgrade, manual accessibility, load/resilience, operations, and
   legal review.

Frankendancer, released `fdctl` v0.x, Agave, and `solana-test-validator` may not
be substituted to satisfy these gates.

## Decentralization assessment

**The design intends decentralization; the project does not currently qualify
as decentralized.**

Partial evidence exists for portable signed objects, deterministic projection
replay, alternate endpoint configuration, storage quorum/failover, relay
failover, transparent feed modes, and local moderation/provider contracts.

The following qualification evidence is absent:

- an independent native validator/RPC operator;
- an independent native indexer and independent reference client;
- a public WokeNet and reproducible native genesis;
- end-to-end provider migration and community export/import;
- full infrastructure-loss and provider-failure exercises;
- transparent production authority/multisig and signed release artifacts;
- public conformance suites run by parties independent of the flagship
  operator.

## Exact commands to run the implemented system

Prerequisites: Node 22.23.1 for the current pinned workspace, pnpm 11.2.2,
Docker, and a supported local shell. Do not use this environment for production
until the Node security replacement and other blockers are resolved.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm setup
pnpm infra:ps
pnpm dev
```

The development command loads the selected local environment, starts the base
and private media containers, applies idempotent local migrations, and starts
the remaining implemented workspace processes. It is fail-closed for
production mode and non-loopback advisory relay/moderation bindings; standalone
service defaults remain locked.
Production provider-backed behavior still requires the independently managed
authorization, secrets, and variables documented in `.env.example` and the
deployment guide.

## Exact commands to verify

Complete implemented local gate:

```sh
pnpm test:e2e:install
pnpm verify:all
```

Individual evidence:

```sh
pnpm workspace:check
pnpm naming:check
pnpm domain:check
pnpm wokenet:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm domain:probe
pnpm test:integration
pnpm --filter @wokesocial/rate-limit test:integration
pnpm test:e2e
pnpm measure:performance
pnpm test:programs
pnpm test:vertical-slice
pnpm --filter @wokesocial/indexer check:anchor-events
pnpm security:audit
pnpm security:secrets
```

Native source and supported-Linux attestation commands:

```sh
pnpm wokenet:materialize -- /absolute/path/to/wokenet-firedancer
pnpm wokenet:source-check -- /absolute/path/to/wokenet-firedancer
pnpm wokenet:binary-check -- /absolute/path/to/wokenet-firedancer
pnpm wokenet:verify-genesis -- /absolute/path/to/genesis.bin EXPECTED_BASE58_HASH
```

`wokenet:binary-check` requires supported Linux x64 and does not itself
establish a connected cluster. `wokenet:verify-genesis` proves only the
exact byte hash supplied by the operator.

## Recommended independent security-audit scope

1. Firedancer downstream patch, source/dependency lock, build isolation,
   genesis creation, consensus/finality, RPC semantics, restart/replay,
   failover, resource exhaustion, and network DoS.
2. Anchor account sizing, PDAs, owners/signers, authorities, delegation,
   recovery, governance, upgrade path, WOKE allocation/rounding, receipts,
   entitlements, replay, and denial-of-service boundaries.
3. SDK account ordering, optional-account sentinels, transaction compilation,
   RPC parsing, simulation equivalence, blockhash/fee changes, signing,
   broadcasting, and finalized proof handling.
4. Wallet, passkey, device delegation, recovery, sponsor, and key-custody
   boundaries.
5. Canonicalization, signatures, CIDs, storage trust, indexer poisoning,
   rollback/reorg, and provider reconciliation.
6. Relay, feed, moderation, media, and auth parsers; authorization, rate limits,
   evidence privacy, and fail-safe behavior.
7. Pairwise messaging device authorization, persistence, metadata, replay,
   safety UX, and future attachment/group designs.
8. Web/API XSS, CSRF, SSRF, SQL injection, path traversal, unsafe redirects,
   request smuggling, denial of service, and privacy leakage.
9. CI/supply chain, actions, OCI images, secrets, SBOM/provenance, signing,
   multisig, backups/restores, and incident response.

## Recommended legal-review scope

- Entity structure, contributor/IP licensing, trademarks, open-source notices,
  and third-party codec/cryptography obligations.
- Terms, privacy/cookie notices, community rules, moderation/appeals,
  transparency, law-enforcement requests, and security safe harbor.
- GDPR/UK GDPR, CCPA/CPRA, deletion versus permanent storage, controller/operator
  roles, breach duties, and vendor agreements.
- Minors/age assurance, CSAM, NCII, deepfakes, copyright, harassment, doxxing,
  accessibility claims, and recommender/platform obligations including the DSA.
- Encryption, metadata, sanctions/export controls, and cross-border data.
- WOKE tips/subscriptions, supply, inflation, fees, rewards, staking/validator
  economics, launch disclosures, public sale, sanctions/AML, money
  transmission, tax, refunds, and consumer protection.
- An independent economic review of the production genesis and validator
  incentive model before any public network or real-funds activity.

## Official upstream facts checked

- Node.js
  [v22.23.1](https://nodejs.org/en/blog/release/v22.23.1) and the official
  [distribution index](https://nodejs.org/dist/index.json).
- Node.js
  [July 2026 security release advisory](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases).
- Pinned Firedancer
  [commit](https://github.com/firedancer-io/firedancer/commit/60c3d2e381a6607f63adc818481e2f31472ae681).
- Firedancer
  [README at the pinned commit](https://github.com/firedancer-io/firedancer/blob/60c3d2e381a6607f63adc818481e2f31472ae681/README.md#L21-L31).
- Firedancer
  [release/operator documentation](https://docs.firedancer.io/guide/getting-started.html#releases).
- Pinned native RPC
  [source](https://github.com/firedancer-io/firedancer/blob/60c3d2e381a6607f63adc818481e2f31472ae681/src/discof/rpc/fd_rpc_tile.c).

## Release decision

The implemented foundation is suitable for continued local development,
compatibility testing, protocol review, and native Firedancer research. It is
not approved for production traffic, native-network launch, public fundraising,
or real-funds WOKE activity.

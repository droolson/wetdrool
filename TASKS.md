# WokeSocial implementation plan

Updated: 2026-07-29

This is the dependency-aware source of truth for implementation and
verification. A checkbox is marked only after the implementation exists and the
listed evidence has been produced. Documentation may describe intended behavior,
but it must not be mistaken for delivered behavior.

Status conventions:

- `[x]` implemented and verified
- `[ ]` not yet verified, including work that is only designed or partially
  implemented
- `BLOCKED(external)` requires a credential, paid service, domain action,
  third-party review, public-network funds, or another dependency that cannot be
  resolved from the repository

## 0. Repository audit

- [x] Inspect every existing repository file and directory.
  - Evidence: the workspace contained zero files and zero directories on
    2026-07-28.
- [x] Check Git state and preserve existing user changes.
  - Evidence: neither the workspace nor its parent was a Git repository; there
    were no changes to preserve.
- [x] Inventory host tooling.
  - Evidence: Node 22.23.1, pnpm 11.2.2, Git 2.50.1, Docker 29.4.0, and Docker
    Compose 5.1.2 were available. Rust, Cargo, Anchor, and Solana CLI were absent
    from the host `PATH`; the repository now provisions pinned, project-local
    copies instead of mutating the global toolchain.
- [x] Identify existing implementation and incomplete work.
  - Evidence: there was no implementation, configuration, documentation, or
    infrastructure.

## 1. Architecture, documentation, and foundation

Dependencies: repository audit.

### Product and architecture

- [x] Create and review `README.md`.
- [x] Create and review `docs/PRODUCT_SPEC.md`.
- [x] Create and review `docs/ARCHITECTURE.md`, including trust boundaries and
  data flows.
- [x] Create and review `docs/PROTOCOL.md`, including object rules, account
  layouts, PDA seeds, costs, and transaction constraints.
- [x] Create and review `docs/SECURITY.md` and `docs/THREAT_MODEL.md`.
- [x] Create and review `docs/MODERATION.md` and `docs/PRIVACY.md`.
- [x] Create and review `docs/DEPLOYMENT.md` and `docs/OPERATIONS.md`.
- [x] Create and review `docs/DECENTRALIZATION.md` with the required component
  matrix.
- [x] Create and review `docs/ROADMAP.md`.
- [x] Record architecture decisions in `docs/DECISIONS/`.
- [x] Add explicit technical-support-only legal placeholders and review scope.

### Monorepo and toolchains

- [x] Initialize Git and configure the private `AlexBTC420/wokesocial` source
  remote.
- [x] Set the repository identity to `wokenet` and enforce the platform/protocol
  naming boundary.
  - Evidence: the local repository directory and root package are both
    `wokenet`; `pnpm naming:check` enforces `WokeSocial`/`wokesocial` for the
    platform and `WokeNet`/`wokenet` for the protocol and local repository
    identity. `origin` points to the private `AlexBTC420/wokesocial` source
    repository; this hosting name does not change the local WokeNet protocol
    namespace.
- [x] Add a strict pnpm workspace and Turborepo pipeline.
- [x] Pin Node, pnpm, TypeScript, Rust, Anchor, and the Solana development
  toolchain.
  - Evidence: Node 22.23.1, pnpm 11.2.2, TypeScript 6.0.3, Rust 1.89.0,
    Anchor 0.32.1, and Solana 2.3.0 are exact development inputs.
- [x] Add strict shared TypeScript, ESLint, Prettier, and Rust formatting/lint
  configuration.
- [x] Add `.gitignore`, `.gitattributes`, `.editorconfig`, `.env.example`,
  contribution, security, and code-of-conduct files.
- [ ] Scaffold required apps, packages, the Anchor workspace, infrastructure,
  and scripts without placeholder success responses.
  - Implemented subset: web, authentication, indexer, feed, relay, moderation,
    media, protocol, storage, SDK, UI, configuration, crypto, messaging, shared
    fixtures, the Anchor workspace, Solana deployment metadata, local
    infrastructure, and scripts exist. Generated docs, full product recovery,
    creator-payment replacement, production moderation identity, the native
    Seeker app, and several launch boundaries remain incomplete.
- [x] Add Docker Compose for PostgreSQL, Redis, and local content storage with
  health checks and least-privilege local credentials.
- [ ] Add structured logging, uniform dependency-aware health/readiness,
  metrics, and an OpenTelemetry SDK/export pipeline across every service.
  - Implemented subset: services expose liveness/readiness routes, privacy-safe
    structured logs are used in most runtimes, relay exposes metrics, and the
    indexer creates API spans. Uniform route names, dependency/lag readiness,
    service-wide metrics, explicit indexer redaction, and an SDK/exporter wired
    to `OTEL_EXPORTER_OTLP_ENDPOINT` remain open.
- [x] Implement a fail-closed shared rate-limit store and verify limits across
  multiple replicas.
  - Evidence: `@wokesocial/rate-limit` uses one atomic Redis fixed-window Lua
    operation, HMAC-derived keys that never send raw client identities to
    Redis, abortable finite-time commands, active command/ACL readiness, and
    stable fail-closed `503` errors. Twenty-five unit cases and six real-Redis
    integration cases pass. All five Fastify services and the relay wire the
    shared limiter into readiness and shutdown while exempting only
    liveness/readiness reporting. A pinned Redis 8.8.1 integration creates two
    independent clients with one deployment/service identity and proves a
    shared quota, namespace/service/deployment isolation, expiry, and raw-key
    privacy. Memory state requires an explicit loopback-only development flag.
    This closes quota multiplication for HTTP replicas but does not make the
    relay horizontally safe: replay nonces, transport/connection leases,
    sequence, retention/subscriptions, and fanout remain process-local until
    shared coordination and cross-replica pubsub pass dedicated tests.
- [x] Fail closed on local/insecure production configuration and dangerous
  standalone service modes.
  - Evidence: staging and production parsing require aligned runtime mode, finalized
    explicit devnet/mainnet-beta selection, secure non-loopback browser/RPC/storage
    endpoints, `rediss://`, explicit program/session values, and non-loopback
    databases. Relay/auth/moderation development bypasses and the public local
    media token are rejected outside local development with negative tests.
- [x] Add CI for install, format, lint, typecheck, unit tests, program tests,
  integration tests, builds, dependency review, and secret scanning.
  - Evidence: CI includes frozen installation,
    workspace/browser/container/program/connected-vertical-slice gates,
    dependency review/audit, CodeQL, and a checksum-pinned Gitleaks wrapper.
    CodeQL runs the pinned JavaScript/TypeScript suite and retains its SARIF as
    a private workflow artifact because GitHub code scanning is not enabled for
    this private repository; it does not pretend that an unavailable SARIF
    upload succeeded. The current pnpm audit reports no known vulnerabilities.
- [x] Make `pnpm setup`, `pnpm dev`, `pnpm test`,
  `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:programs`,
  `pnpm test:vertical-slice`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`
  real.
  - Evidence: `pnpm setup` installs checksum-verified toolchains under `.local`,
    starts healthy PostgreSQL/Redis/Kubo containers, validates configuration, and
    applies all 18 ordered projection migrations through
    `0018_member_signed_community_memberships.sql` on a fresh projection. That
    predeployment migration refuses incompatible prior community, membership,
    or proposal rows/events and requires both a fresh disposable PostgreSQL
    projection and a fresh local-validator ledger. `pnpm dev` reloads the selected
    environment for every child process, starts the private ClamAV/media
    profile, applies all local service migrations idempotently, enables advisory
    authorization only after rejecting non-loopback or production use, and
    excludes the containerized media worker from duplicate Turbo startup.
    Standalone relay and moderation defaults remain locked.

### Phase 1 exit evidence

- [x] Clean dependency installation succeeds.
- [x] Formatter succeeds.
- [x] Lint succeeds.
- [x] Type checking succeeds.
- [x] Relevant unit tests succeed.
- [x] Production builds succeed.
  - Evidence: the implemented TypeScript packages and the Next.js application
    build successfully; the native Anchor SBF artifact is also produced by the
    program suite.
- [x] Documentation matches the generated foundation.

## 2. WokeNet on Solana and core protocol

Dependencies: phase 1, canonical schemas, and pinned Rust/Anchor/Solana
development toolchains.

- [x] Define WokeNet as the WokeSocial protocol and smart-contract deployment
  layer on Solana.
  - Evidence: ADR-0009 rejects a separate chain, Solana fork, custom validator,
    Firedancer/Agave topology, and WokeNet-owned RPC network. Deployment
    metadata uses explicit Solana clusters and preserves
    `wokenet:v1:<solana-genesis-hash>:<social-program-id>`.
- [ ] Publish a verified WokeNet deployment to Solana devnet.
  - Required evidence: reproducible SBF build, exact devnet genesis/program
    binding, deployment slot, authority record, finalized RPC verification,
    explorer-visible transaction, rollback plan, and release approval.
- [ ] Publish a security-reviewed WokeNet deployment to Solana mainnet-beta.
  - Blocked on independent program review, authority/multisig policy, devnet
    rehearsal, production operations, monitoring, incident response, and
    explicit approval. No public deployment is currently claimed.

- [ ] Implement protocol configuration and versioning.
  - Implemented subset: the versioned configuration PDA is initialized once and
    tracks checked state-family counts. Governed compatibility ranges, fees,
    migrations, and wider authority configuration remain planned.
- [ ] Implement identity roots, profile pointers, handles, multiple authorities,
  delegated session keys, revocation, and key rotation.
  - Implemented subset: stable identity roots, profile hash/URI pointers,
    collision-safe global handle claim/release, dual-signed root rotation, and
    scoped/expiring/revocable delegations bound to the current root-rotation
    epoch, a root-authorized one-way identity deactivation instruction with an
    exact current-sequence replay barrier and versioned event, plus a
    six-instruction delayed guardian-threshold recovery primitive. Multiple
    linked wallets, complete device/product integration, and email/passkey
    recovery UX remain planned.
- [ ] Implement follow/unfollow and block-edge event semantics.
  - Implemented subset: checked follow/unfollow/refollow and block/unblock state
    with PDA substitution checks and versioned events. Root and current-epoch
    delegated variants enforce exact identity, scope, expiry, and revocation.
- [ ] Implement communities, membership, scoped roles, and governance
  configuration.
  - Implemented predeployment subset: community creation, versioned governance
    commitments, schema-v2 signed creation manifests bound to the exact
    executable strategy, immutable creation root, and PDA nonce; privacy-safe
    public directory/address detail; member-authored schema-v2 join/leave for
    public or unlisted open communities; creator-root or current
    community-scoped-delegate remove/ban of an existing membership; terminal
    bans; exact-address privacy-safe membership status with no roster or
    identity fields; and immutable one-active-member-one-vote
    proposals/votes/finalization with quorum and approval thresholds.
    Community metadata is immutable in the current program. The flagship web
    and Seeker apps still expose no wallet-backed membership mutation;
    approval-required/private flows, richer role-based authorization,
    community-scoped delegation audiences, lifecycle/update instructions,
    other governance models, and proposal execution remain planned.
- [ ] Implement signed post references, reply/quote/repost/reaction references,
  and deletion tombstones.
  - Implemented subset: immutable post references, reaction
    add/remove/re-add state, one tombstone per author/post pair, and delegated
    publish/tombstone variants. Reply, quote, repost, and bookmark relationships
    are signed offchain objects; adding compact onchain targets requires a
    separate V2 relation account because V1 `PostReference` has no reserved
    bytes.
- [ ] Implement replacement mint-aware creator tips, subscriptions,
  entitlements, and configurable fees without custodial funds.
  - Quarantined legacy subset: lamport-denominated account/instruction layouts
    and historical arithmetic/state-transition helpers remain for migration and
    regression analysis. Program tests prove bootstrap, tip/offering execution,
    authority rotation, unpause, and entitlement maintenance fail without
    changing state or balances. No successful payment flow or `$WOKE` mint
    exists. A real SPL/Token-2022 mint, new mint-aware ABI, migration,
    SDK/UI/indexer work, tests, legal review, and audit are required.
- [ ] Document and test every PDA seed, account constraint, account size,
  compute assumption, authorization rule, replay boundary, and close rule.
  - Verified subset: implemented account families have exact serialization-size
    and rent checks; PDA domains, URI bounds, stale sequences, rotation epochs,
    signer control, handle collisions/releases, delegated authority attacks, and
    overflow are tested. A clean local-validator gate keeps representative
    transactions below 1,100 bytes and 150,000 CU (largest observed overall:
    892 bytes and 67,399 CU; governance additions: at most 581 bytes and
    32,806 CU). Exact rent is asserted for all 19 current account families.
    Generalized close rules, fuzzing, and future account families remain
    incomplete.
- [ ] Generate and verify the client from the IDL.
  - Implemented subset: Anchor generates the local IDL and TypeScript type used
    by the local-validator and connected suites. Eleven manually reviewed SDK
    builders now match the three member-signed membership,
    identity-deactivation, and seven quarantined legacy payment instruction
    layouts. A complete generated,
    checked-in SDK client and exhaustive cross-language conformance gate remain
    planned.
- [ ] Run Rust unit tests and Anchor local-validator tests for success, invalid
  signer, substitution, duplicate, replay, overflow, malformed input, and
  unauthorized-close cases.
  - Verified subset: 25 Rust tests cover account sizing, validation, PDA
    domains, discriminators, stale sequences, rotation epochs, governance and
    historical payment arithmetic, deterministic allocation, and overflow.
    Twenty-eight
    Solana local-validator flows exercise the original core path;
    rotation/delegation lifecycle;
    displaced-root invalidation; block/community/membership/governance
    commitments; proposal/vote/finalization snapshots; reactions; handle
    claim/release; recovery; all six delegated action variants; fail-closed
    legacy-payment bootstrap/execution/rotation/unpause/maintenance; root-only
    identity deactivation; identity, signer, scope, expiry, revocation, epoch,
    duplicate, late-member, substitution, replay, and threshold attacks; and
    transaction/compute/rent ceilings. The legacy payment cases assert unchanged
    state/balances and no successful payment flow.
    The full cross-language matrix, fuzzing, public-cluster deployment, and
    future close behavior remain incomplete.

## 3. Signed content, storage, indexer, relay, and feeds

Dependencies: phase 2 protocol identifiers and events.

- [x] Define one canonical source for all versioned protocol object schemas.
  - Evidence: `packages/protocol` defines strict modular Zod schemas and typed
    builders for all 29 current portable object families. Profiles,
    communities, and community-memberships use schema version 2 for current
    creation; the other families remain on schema version 1, while their frozen
    v1 shapes remain read-compatible. Its checked-in Draft 2020-12
    signed-envelope schema is
    generated from the same registry, exported as
    `@wokesocial/protocol/schema/v1`, and fails `schema:check` when stale. Rust
    consumption and cross-language golden conformance remain separate open
    gates.
- [x] Implement deterministic canonical serialization, stable identifiers,
  content hashing, signature creation, and signature verification.
  - Evidence: protocol unit tests cover canonical-byte equality, NFC rejection,
    exact-envelope decoding, stable object IDs/CIDs, Ed25519 verification,
    mutation rejection, and authorization rejection.
- [x] Implement local content-addressed storage with path-traversal defenses.
  - Evidence: local round-trip, deletion, corruption detection, size limits, and
    CID-derived safe paths are covered by package tests.
- [ ] Implement IPFS publication/retrieval, CID verification, pinning health,
  replication status, and gateway fallback.
  - Implemented subset: the HTTP adapter publishes pinned raw CIDv1 objects,
    verifies the returned CID and downloaded bytes, checks health, falls back
    across gateways, and unpins. A real Kubo container integration passes;
    durable replication-status persistence remains planned.
- [x] Implement Arweave-compatible publication with explicit permanence consent.
  - Evidence: the provider-neutral Arweave/Irys-compatible adapter requires
    recorded consent, validates uploader receipts and gateway readback, bounds
    timeouts, and truthfully reports deletion as unsupported. A funded
    production uploader and live-network integration remain external
    configuration rather than local adapter behavior.
- [ ] Implement multi-provider publication and deletion-compatible defaults.
  - Implemented subset: a quorum-aware multi-provider publisher and failover
    reader are unit-tested, and permanent publication requires explicit consent.
    Cross-provider deletion orchestration remains planned.
- [ ] Implement idempotent, finality-aware indexing with checkpoints, backfill,
  replay, DLQ, migrations, validation, retries, corruption detection, and
  metrics.
  - Implemented subset: finalized Solana JSON-RPC
    synchronization validates exact genesis/program identity, fails over RPC
    endpoints, replays from a configured deployment slot, verifies manifests,
    applies idempotent checkpoints, retries/DLQ, suppresses tombstones, and
    rebuilds memory/PostgreSQL projections. All 33 events in the current built
    IDL are decoded with exact drift checks that reject additions, removals,
    field/discriminator changes, and unhandled program-data events. All 33
    events are projected, including exact, one-way identity deactivation with
    historical authorization and replay invariants. Identity, handles,
    social/governance/recovery, and
    payment configuration/offerings/receipts/entitlements retain exact-network
    and raw-event provenance. Schema-v2 community creation additionally binds
    the immutable root authority, signed/PDA nonce, replacement sequence, and
    exact governance commitment before public projection. Membership-v2
    projection additionally verifies member or moderator authorship, exact
    action/state/role semantics, manifest lineage, and optimistic sequences.
    Its exact-address status route is limited to open public/unlisted parents
    and returns no roster, identities, signer authority, moderation reason, or
    manifest location. Eighteen ordered, checksummed migrations are present,
    and the updated unit and fresh-PostgreSQL gates pass.
    Fork/reorg handling, independent-provider reconciliation, production
    metrics, and production-scale rebuilds above 50,000 events remain
    incomplete.
  - Profile-manifest reads preserve signed schema-v1 history only before the
    per-network `INDEXER_PROFILE_V2_ACTIVATION_SLOT`; events at or after that
    immutable cutoff require schema v2. Live ingestion and exact-source rebuild
    use the same cutoff. Implemented root and delegated profile instructions
    accept only schema version 2 and append that commitment to the canonical
    onchain profile-reference event; explicit non-v2 commitments fail at every
    slot.
  - Manifest references use exact CIDv1/base32-lowercase `raw`/SHA-256 CIDs in
    the shared IPFS, local, Arweave-transaction/CID, or credential-free
    HTTPS/CID grammar. Invalid case, length, codec, multihash, padding, URI
    shape, or CID/URI disagreement becomes terminal `manifest-uri` before
    provider I/O.
  - Manifest-bearing raw events have immutable accepted, pending, or terminal
    disposition. Temporary unavailability advances sequence/checkpoint without
    exposing content. Every sync poll drains a deterministic batch-bounded due
    queue independently of new chain events or checkpoint movement. Promotion,
    rescheduling, and terminal conversion lock the exact fingerprint.
    Tombstones bypass manifest I/O entirely; optional legacy object/CID/hash
    fields are detached audit metadata that cannot gate suppression.
  - Suppression-aware rebuild skips provider I/O among accepted events only for
    a durably accepted obsolete profile followed by a later pointer or post
    followed by a tombstone, as proven by the complete ordered ledger. It
    retains accepted raw state, sequence/reference effects, and checkpoint.
    Late profile hydration after identity deactivation remains historical
    retention and never restores public person discovery.
- [x] Publish OpenAPI and an independently runnable indexer.
  - Implemented subset: the Fastify service exposes liveness, readiness,
    OpenAPI, feed, post, and bounded public-search endpoints backed by PostgreSQL
    with CORS, rate limiting, security headers, structured logging, and tracing
    hooks.
  - `/v1/feed/home` remains the configured-default-network consumer-safe
    response. The separate noncanonical `/v1/feed` projection resolves an
    explicit network or the operator default and otherwise fails closed. It
    returns checkpoint/provenance metadata, resolved network and viewer scope,
    and public chronological or public-following entries. Its opaque cursors
    bind the resolved network, recipe, and exact following viewer; `nextCursor:
    null` is terminal.
  - The production server can run the Solana synchronizer when explicit
    network, deployment-slot, `SOLANA_*` RPC, storage, and database configuration
    is supplied; it remains honestly disabled when that configuration is absent
    and rejects retired `WOKENET_*` runtime variables.
  - Evidence: a multi-stage, digest-pinned image runs as UID/GID `10005` with a
    read-only root, loopback-only Compose port, healthcheck, and one explicit
    writable content volume. The optional `indexer` profile and final image
    build were inspected. The packaged rebuild command validates the complete
    durable raw ledger and every referenced manifest in an isolated projection
    before an explicitly confirmed, per-network locked atomic replacement.
- [ ] Implement complete search and discovery with visibility and personal-safety enforcement.
  - Implemented subset: memory and PostgreSQL projections search current public
    display names/bios, canonical active handles, verified public posts, and
    verified public-community names/slugs/descriptions. The deterministic
    `public-match-v2` response is network-scoped, checkpointed in the same
    repeatable-read snapshot, rate/concurrency/statement-time bounded, and
    excludes unlisted/tombstoned posts plus unlisted/private/restricted or
    unverified communities. Indexed NFKC/ASCII-folded PostgreSQL fields and
    prefix-only fallback for terms without an extractable ASCII trigram avoid
    non-indexable unauthenticated substring predicates. A bounded community
    directory lists public manifests; address detail additionally permits
    unlisted manifests while private/restricted/unknown states share a 404 and
    no public endpoint returns memberships. The flagship strictly parses and
    rechecks governance/visibility proofs, caps provider response bytes, and
    renders real, empty, invalid-query, not-found, and unavailable states
    without fabricated results. Event/creator discovery, viewer-aware
    block/mute enforcement, production-scale relevance/load evidence, and
    independent-provider conformance remain open.
- [x] Implement non-authoritative multi-relay protocol and failover.
  - Evidence: `apps/relay` verifies strict signed advisory events and
    subscriptions, starts locked without a finalized-state key authorizer,
    and includes a bounded fail-closed HTTP adapter for a replaceable finalized
    authorizer with network/checkpoint/freshness binding and dependency
    readiness. It bounds replay/retention/rate/backpressure state, exposes
    privacy-safe readiness/policy/metrics, and its client passes real-loopback
    failover, reconnect, deduplication, and gap tests across multiple relay
    endpoints. A separate bounded adapter authorizes opaque-topic subscriptions
    against finalized policy, expires community delivery grants, and joins
    dependency readiness. Eighty-one unit cases and 34 real-WebSocket
    integration cases pass. Deploying the independent key and
    policy/membership authorities remains an operational integration.
- [x] Implement chronological, following, community, trending, media,
  explainable recommendation, and third-party feed interfaces.
  - Evidence: `apps/feed-service` deterministically scopes chronological,
    following, community, and media sources; uses bounded 15-minute-to-24-hour
    observations for trending without lifetime-popularity leakage; publishes
    transparent recommendation scores; and reconciles versioned third-party
    order metadata without allowing it to bypass local safety filters. Stable
    cursors bind mode/provider/policy inputs, responses carry source checkpoints
    and provider provenance, and 38 unit/API cases pass. Production source
    collection and a curated discovery registry remain replaceable integrations,
    not ranking-engine gaps.
- [ ] Test full projection rebuild and alternate-provider reconciliation.
  - Implemented subset: PostgreSQL tests rebuild from synthetic inputs, and the
    connected gate completely clears its network projection and reconstructs
    identity, profile, public community discovery, posts, follow, tombstone,
    checkpoint, and suppression from actual finalized validator history plus
    signed CAS manifests. Durable accepted/pending/terminal replay,
    accepted-obsolete suppression without provider I/O, and late
    hydration/deactivation parity pass in memory and PostgreSQL. Alternate
    storage/RPC reconciliation, fork/reorg evidence, and rebuilds above the
    current 50,000-event bound remain planned.

## 4. Flagship web application

Dependencies: phases 1-3 public interfaces.

- [x] Deliver the brand system, wordmark treatment, icon concept, design tokens,
  light/dark/high-contrast themes, and reduced-motion behavior.
  - Evidence: the original CSS-based mark and shared UI tokens render in the
    implemented Next.js routes; Playwright verifies high-contrast state and
    content visibility.
- [ ] Deliver every required public, onboarding, feed, community, messaging,
  creator, settings, safety, data, developer, and status screen.
  - Implemented subset: 46 App Router page files cover the complete required
    route-shell surface. The current production build emits 32 static route
    entries, including the framework `_not-found` entry, plus 15 dynamic routes.
    Community directory, address-routed public/unlisted detail, exact-governance
    proof presentation, and public community search consume the strict open
    indexer contract. Joining, membership, administration, and governance writes
    remain visibly disabled rather than reporting false success. Route presence
    alone does not satisfy the production-quality interaction, data, and
    end-to-end acceptance criteria for every screen.
- [ ] Implement responsive navigation and polished loading, empty, error,
  offline, and degraded-network states.
  - Implemented subset: responsive navigation, skip link, loading/error
    boundaries, connectivity notice, and explicit unavailable/degraded states
    exist across the complete route set. The full live-provider permission,
    progress, retry, and partial-failure matrix remains incomplete.
- [ ] Implement the complete composer with sanitization, accessibility metadata,
  audience and permission controls, storage policy, local drafts, progress,
  retry, and recovery.
  - Implemented subset: a versioned device-local composer validates plain text,
    content warnings, typed media references and image alt text, audience,
    community, reply/remix permissions, and storage policy; provides safe React
    text preview, save/restore, and two-step discard; and never enables publish
    without authentication, storage, simulation, and finalized receipt
    adapters. Rich text, polls, uploads, scheduling, and real publication
    progress/retry remain open.
- [ ] Implement feed explanations, personalization controls, chronological
  fallback, sensitive-content controls, and block/mute filtering.
  - Implemented subset: all feed/control surfaces explain their intended
    contracts, and versioned device-local privacy/safety preferences plus an
    exact-identity feed hide list persist and export safely. The consumer-safe
    home remains separate from strict bounded chronological pagination and an
    explicitly public, unauthenticated following-graph preview backed by the
    open indexer. Both projection routes re-apply exact-identity hiding on this
    device. Media-only posts retain verified references, but gateway playback is
    not connected. Authenticated following, recommendation-provider integration,
    complete offline caching, independent-provider conformance, and cross-device
    enforcement remain open.
- [x] Add WCAG 2.2 AA automated checks and manual critical-flow procedures.
  - Evidence: 210 desktop and mobile-viewport Chromium tests pass with two
    intentional mobile-project skips for desktop-only passkey-lifecycle flows,
    including 90 axe A/AA scans over 45 route fixtures, keyboard skip-link and
    navigation, high-contrast state, responsive layouts, local
    preference/export flows, semantic connected-post coverage, and disabled
    destructive/report mutations. The manual matrix in
    `docs/ACCESSIBILITY.md` remains required before a WCAG conformance claim.

## 5. Moderation, governance, and safety

Dependencies: identities, communities, signed labels, indexer, flagship flows.

- [ ] Implement personal block, mute, keyword, reply, mention, DM, sensitivity,
  shared-blocklist, safety-mode, and anti-dogpile controls.
  - Implemented subset: device-local privacy/safety settings and an exact
    identity hide/mute-intent list are versioned, validated, persisted,
    removable, and applied locally to the home, chronological, and public
    following-preview feeds. This is not authenticated or shared safety state.
    Relay enforcement, keyword/mention/DM controls, shared blocklists, and
    cross-device protocol state remain open.
- [ ] Implement scoped community moderation, temporary actions, conflict
  controls, versioned policy, append-only logs, reports, and appeals.
  - Implemented subset: `apps/moderation-service` verifies authorized signed
    label/report/appeal objects; encrypts restricted evidence with AES-256-GCM;
    keeps accepted objects and status history append-only and idempotent in
    memory or PostgreSQL; prevents cross-provider supersession; supports scoped
    conflict assertions/overrides, legal holds, due/review/expiry transitions,
    and transparency aggregation; and exposes
    purpose-authorized restricted cases. Fifty-six unit and four isolated
    PostgreSQL cases pass. A production object authorizer, operator SSO,
    specialist workflow UI, community permission projection, and separate
    reviewed retention executor remain open. The web runtime cannot delete
    ledger history and reports zero automatic removals; production readiness
    fails closed without the missing executor and deletion evidence.
- [ ] Implement replaceable client/indexer policies and narrow technical
  protocol restrictions.
  - Implemented subset: the moderation provider exposes OpenAPI and signed,
    explicitly noncanonical label assertions, and starts locked without an
    injected current key/provider authorizer. Multi-provider client policy and
    technical protocol restrictions remain open.
- [ ] Implement consentful evidence disclosure, spam/rate controls, bot labels,
  coordinated-harassment signals, doxxing warnings, NCII flow, child-safety
  escalation hooks, crisis-resource hooks, and transparency exports.
  - Implemented subset: report evidence references must be encrypted by the
    shared protocol schema, intake receipts never echo evidence, request bodies
    are log-redacted, case reads require an injected authorization callback plus
    a declared purpose, and API rate/body limits are tested. Specialist safety
    flows and transparency exports remain open.
- [ ] Implement supported governance strategies and document anti-sybil
  tradeoffs without defaulting to token wealth.
  - Implemented subset: the program enforces one active snapshot-eligible
    member, one vote with immutable proposal/vote accounts, abstention-aware
    quorum, checked `u128` tally arithmetic, permissionless deterministic
    finalization, and no token weighting. Reputation, delegation, council,
    consensus, and emergency-review models remain portable policy declarations
    only.

## 6. Passkeys, recovery, sponsorship, and devices

Dependencies: identity/delegation protocol, production-grade web sessions,
threat-model mitigations.

- [ ] Implement existing-wallet onboarding through supported Solana wallets.
- [ ] Complete the native Android WokeSocial client for Solana Seeker using
  Mobile Wallet Adapter.
  - Implemented subset: an Expo/React Native Android foundation provides an MWA
    connection boundary, exact Solana genesis/program verification, a strict
    read-only chronological-feed client, honest failure states, and focused
    unit tests. It exposes no program transaction action.
  - Required evidence: native Android source, reviewed intent/deep-link and
    permission boundaries, wallet connection/signing tests on Seeker-compatible
    hardware or an approved emulator matrix, reproducible release build,
    controlled signing, verifiable signed-APK provenance, secure update and
    rollback procedure, accessibility checks, and explicit distribution
    approval. No verified Seeker-device run, reproducible signed APK, signing
    provenance, store submission, or publication currently exists.
- [ ] Implement passkey-first onboarding using WebAuthn and a documented
  noncustodial signing architecture.
  - Implemented subset: ADR-0006 fixes the authentication/signing boundary;
    `@wokesocial/crypto` wraps locally generated Ed25519 seeds with
    credential-bound WebAuthn PRF output using HKDF-SHA-256 plus AES-256-GCM.
    The replaceable auth service now verifies exact-origin/RP, user-verifying,
    discoverable ceremonies with durable PostgreSQL challenge, credential,
    session, and ciphertext-bundle state. Initial credential creation, the
    credential-bound encrypted root wrapper, and account activation commit
    atomically; PRF absence fails before the account is created. Authentication
    commits the credential counter transition and new session atomically with
    revocation, including PostgreSQL rollback coverage. The browser creates the
    Ed25519 root seed locally, strips PRF output from server requests, and
    supports discoverable sign-in plus list/add/revoke service passkeys. Each
    additional passkey unwraps and rewraps the same root, and revocation requires
    fresh step-up, deletes that wrapper, and revokes service sessions.
    The development-localnet composer now requires a fresh passkey assertion,
    atomically creates one deterministic WokeNet identity plus anonymous name
    claim (or migrates a legacy identity-only account), signs canonical post
    bytes, verifies local CAS storage, simulates and finalizes exact Solana
    transactions, waits for the indexer, strictly resolves the name, and
    exposes the complete proof. Its real-Chromium acceptance publishes two
    posts, restores one ambiguous finalized intent without rebroadcast,
    replays 14 events, and reports zero secret matches. Thirty-four auth unit,
    four isolated PostgreSQL, one auth-service browser integration, 253 web
    tests across 19 files, and the vertical publication/replay browser checks
    pass.
  - Remaining scope: connect service-passkey revocation to the separate WokeNet
    delegation/device-authority lifecycle, complete recovery UX and independent
    security review, provide a reviewed fallback for authenticators without PRF
    support, and move the publication flow beyond the development-localnet
    boundary.
- [ ] Implement email-assisted recovery without making email the protocol
  identity.
- [ ] Implement device-bound delegated keys, expiration, revocation, wallet
  link/unlink, key rotation, recovery delay/cancellation, and optional hardware
  wallet support.
- [ ] Implement optional replaceable sponsored transactions with strict
  anti-abuse controls and no false-success UI.
- [ ] Complete security tests for malicious prompts, recovery abuse,
  compromised devices, replay, RPC failure, and priority-fee/blockhash errors.

## 7. End-to-end encrypted messaging and relays

Dependencies: secure devices, identity verification, relay envelope interface.

- [x] Select an established audited one-to-one protocol/library and record an
  ADR; do not invent cryptography.
  - Evidence: ADR-0007 selects the Apache-2.0 Rust
    `matrix-sdk-crypto`/`vodozemac` engine through its maintained WASM binding,
    preserves WokeSocial identity and relay authority boundaries, and keeps
    group messaging gated.
- [ ] Implement device keys, authenticated encryption, replay protection,
  rotation, forward secrecy where supported, safety-number UX, encrypted local
  storage, attachments, revocation, message requests, and blocking.
  - Implemented subset: `@wokesocial/messaging` delegates pairwise sessions
    to pinned `@matrix-org/matrix-sdk-crypto-wasm@18.4.0`, routes only opaque
    upload/query/claim requests, binds engine keys to injected current
    WokeSocial device authorization before and after sensitive operations,
    verifies a canonical sender-device Ed25519 signature over routing fields
    and ciphertext before mutating Olm state, and rejects replay, corruption,
    wrong-device delivery, local or remote revocation, authorization changes,
    unbounded dependency stalls, production volatile storage, and all
    room/group request categories. Thirteen independent real-WASM tests pass.
  - Remaining scope: production encrypted persistent storage, cross-tab
    single-writer ownership, durable replay state, browser WASM/CSP packaging,
    pre-key retransmission, attachments, safety verification UX, request/block
    product controls, relay integration, and independent review.
- [x] Minimize and document relay-visible metadata.
  - Evidence: relay payload/topic/recipient/subscription contents are excluded
    from logs and metrics; operator docs enumerate the remaining connection,
    timing, routing-audience, and ciphertext-size visibility. This does not
    imply message-metadata resistance beyond the implemented transport.
- [ ] Implement reporter-controlled selective disclosure.
- [x] Keep group messaging disabled in production until its mature-protocol,
  audit, interoperability, recovery, and membership-change gates pass.
  - Evidence: the real-WASM pairwise adapter rejects room/group request
    categories, no group-encryption path is exposed, and production messaging
    remains fail-closed while the required gates are absent.

## 8. Media, vertical video, stories, livestreaming, and events

Dependencies: signed manifests, storage providers, web composer, workers.

- [ ] Implement direct and resumable uploads, client hashing, MIME/size checks,
  cancellation, and safe retry.
  - Implemented worker subset: authenticated create/claim ownership, exact
    offset/chunk/source hashes, cancellation, expiry, restart recovery,
    idempotent finalization, 100,000,000-byte limit, and strict
    MIME/container/decode validation pass adversarial tests. Browser
    direct-upload and client-hash UX remain open.
- [ ] Implement metadata stripping, responsive images, thumbnails, video
  transcoding/HLS, captions, audio waveforms, alt-text prompts, malware hook,
  replication, and storage health.
  - Implemented worker subset: bounded Sharp and FFmpeg/ffprobe profiles produce
    metadata-free image variants, thumbnails, MP4/AAC, poster/HLS, audio
    waveforms, validated caption references, and content-addressed
    publications. The private ClamAV 1.5.3 profile passes production-adapter
    benign/EICAR checks and records fresh engine/database provenance.
- [ ] Publish the media manifest and independent preprocessed-publication path.
  - Implemented worker subset: managed and independently preprocessed bytes
    produce protocol-valid unsigned media-manifest content plus verified
    storage receipts. The worker never signs for a user; flagship client
    signing/publication integration remains open.
- [ ] Implement vertical video, expiring-story semantics, livestream signaling,
  and events with honest deletion/permanence behavior.

## 9. Creator economy

Dependencies: identity, content entitlements, a real token design, legal review,
and security review.

- [x] Quarantine the legacy lamport-denominated payment ABI.
  - Evidence: its policy is paused by default. Under ADR-0009 it must remain
    paused, cannot execute or be unpaused, cannot be exposed by flagship
    clients, and cannot describe SOL or lamports as `$WOKE`. Historical tests
    remain regression evidence only.
- [x] Keep portable signed payment-asset metadata truthful and distinct from the
  quarantined onchain ABI.
  - Evidence: `paymentAssetSchema` accepts `{ kind: "sol" }` or exact SPL token
    metadata and rejects `{ kind: "woke" }`. This does not create a mint,
    authorize the legacy ABI, or establish an entitlement.
- [ ] Define and create a real `$WOKE` SPL or Token-2022 mint.
  - Required evidence: reviewed token standard, exact mint, decimals,
    mint/freeze authorities, extensions, distribution, tokenomics, legal
    posture, public deployment record, and explicit approval. No mint exists.
- [ ] Replace the legacy payment instructions with a new mint-aware ABI and
  explicit migration/version boundary.
  - Required scope: token-account constraints, transfer semantics, fee/split
    accounting, receipts, entitlements, pause/retirement, SDK builders, indexer
    projection, UI wording, migration, adversarial tests, devnet rehearsal,
    independent audit, and release approval.
- [ ] Implement creator subscriptions, paid communities/events, entitlement
  verification, splits, fees, previews, history, and refund metadata.
  - Legacy regression-only subset: frozen offering/receipt/entitlement layouts,
    checked Hamilton allocation helpers, renewal bounds, sequence rules,
    root-epoch invalidation, and refund-policy commitments remain documented or
    unit-tested, but program execution is rejected before state or balance
    changes. They are not reusable or deployable payment functionality.
- [ ] Test the replacement mint-aware design against token-account
  substitution, transfer-hook/extension behavior where applicable, duplicate
  payment, replay, rounding, fake entitlement, simulation mismatch, authority
  compromise, and provider drift.
- [x] Keep every public deployment and real-fund action manual and documented.
  - Evidence: repository policy keeps every production approval false, setup
    and development commands are local-only, CI has no launch authority, and
    the deployment runbook requires explicit authority, audit, and operator
    actions.

## 10. Launch hardening and independent operation

Dependencies: all applicable product phases.

- [ ] Complete CSP, secure headers, CSRF applicability, validation, encoding,
  safe URLs, rate limits, least privilege, migration rollback, secret/dependency
  scanning, and release integrity.
- [ ] Complete the production upgrade-authority, multisig, verifiable-build,
  narrowly scoped emergency control, and immutability path.
- [ ] Meet WCAG 2.2 AA across essential flows, including keyboard-only,
  screen-reader, contrast, resizing, reduced motion, touch, captions, RTL, and
  localization checks.
- [ ] Measure and meet documented performance budgets for responsive web at
  desktop and mobile viewports.
- [ ] Measure and meet separate native Android/Seeker startup, navigation,
  wallet-handoff, memory, battery, and network budgets on the approved device
  matrix.
- [ ] Test RPC, gateway, indexer, relay, database-projection, and partial-network
  failure behavior without blank screens.
- [ ] Test export, migration, projection rebuild, alternate client/service
  configuration, deletion suppression, and flagship-infrastructure loss.
- [ ] Prepare provider-neutral deployment, Solana devnet/mainnet-beta
  automation, DNS/TLS guide, monitoring, privacy-controlled error tracking,
  backups, rollback, incident response, and disaster recovery.
- [ ] Obtain `BLOCKED(external)` independent WokeNet program, web/service, and
  Seeker Android security audits.
- [ ] Obtain `BLOCKED(external)` cryptography and messaging audit.
- [ ] Obtain `BLOCKED(external)` qualified legal/privacy/safety review.
- [ ] Obtain `BLOCKED(external)` production credentials, domain control,
  provider accounts, program-authority participants, Android signing custody,
  and funded Solana deployment identities where applicable.

## 11. Expanded platform workstreams

Dependencies: the verified social publication foundation, plus the specific
privacy, security, economic, and operational gates named below. The complete
design is in [docs/PLATFORM_EXPANSION.md](docs/PLATFORM_EXPANSION.md) and is
tracked by [GitHub epic #12](https://github.com/AlexBTC420/wokesocial/issues/12).

- [ ] Define and verify decentralized long-form and vertical short-form video
  manifests, browser upload/playback, replaceable delivery, accessibility, and
  representative performance benchmarks.
- [ ] Treat “middle-out” as a measured media R&D program; retain
  standards-based fallbacks and ship no codec or efficiency claim without a
  public corpus and reproducible result.
- [x] Define and cross-language test the version-1 `.woke` namespace,
  deterministic pseudonymous derivation from immutable identity origin,
  conservative ASCII normalization, rotation/recovery stability, and
  program-enforced `anon_` anti-front-running.
- [x] Atomically claim the derived anonymous name during fresh durable passkey
  identity registration, migrate legacy identity-only accounts at their
  current sequence, and implement independently verifiable checkpoint-covered
  resolution to the current Solana authority.
  - Evidence: the bounded multi-instruction executor accepts Agave's exact
    two-inner-group response; simulation verifies both rent-funded account
    creations and both events; finalized reconciliation binds sequence-1 claim
    to the stable identity; the strict resolver follows finalized root
    rotation; and `pnpm test:vertical-slice` reconstructs 14 events after one
    atomic registration plus two browser posts.
- [ ] Connect finalized `.woke` names across profile, feed, search,
  payment/signature confirmation, cache invalidation, and public-cluster
  product surfaces.
  - Partial evidence (signature confirmation and cache invalidation only):
    the localnet composer—the only current signature surface—derives the
    disclosure from the account's synchronized ciphertext-only key wrappers,
    requires every wrapper to agree on one exact 32-byte key, shows the exact
    deployment, program, root authority, derived identity account, and
    anonymous `.woke` candidate before enabling a signature, caches the
    disclosure only against the exact account/key/deployment binding,
    discards it on any change, and `publishLocalnetTextPost` rejects with
    `destination-mismatch` before any account read or transaction when the
    fresh passkey key differs from the disclosed destination. Passkey
    onboarding renders the exact (untruncated) Solana destination for the
    derived candidate. Verified by `pnpm --filter @wokesocial/web test`
    (20 files / 260 cases) and `pnpm verify` on 2026-07-29. No payment
    surface exists yet.
  - Partial evidence (feed, post-detail, search, and Seeker-feed rendering):
    the open indexer serializes each author's canonical active handle—the
    lexically first active claim, matching person search, and always null
    for a deactivated identity—into `/v1/feed` (`authorHandle`),
    `/v1/feed/home`, `/v1/posts/{objectId}`, and post-kind search results,
    with handle release proven to drop the field; the strict projected-feed
    client accepts only an exactly canonical handle serialization; and the
    web post card, search results, and Seeker read-only feed render
    `handle.woke` with an honest no-active-name state. Verified by the
    indexer (209), indexer-client (59), web (260), and mobile (12) unit
    suites on 2026-07-29.
  - Partial evidence (profile surface): `GET
    /v1/identities/{identityId}/profile` serves one exact identity's
    checkpoint-covered state, its ingestion-filtered public profile
    projection, and its canonical active handle (always null for a
    deactivated identity); the strict client parser rejects broken
    identity/handle/deactivation bindings and stale checkpoints; and the
    web profile route renders the display name, `handle.woke`, public
    bio/pronouns/links, an independently checkable identity receipt, and
    honest deactivated/not-found/degraded/invalid-identifier states.
    Verified by the indexer (210), indexer-client (64), and web (260) unit
    suites on 2026-07-29. Share surfaces and public-cluster surfaces
    remain open.
- [ ] Ship handle subdomains (`*.woke.social`), `handle@woke.social` E2EE
  mail, the Woke AI site builder, the platform assistant, and the feed-native
  Solana token launchpad.
  - Partial evidence (front-end flows and prepared contracts only): `/sites`
    derives the injective identity bundle for any canonical handle — the
    DNS-safe subdomain (underscore→hyphen; handles never contain hyphens)
    and the verbatim `handle@woke.social` mail address, with E2EE-between-
    identities semantics and non-deployed status stated — offers the Crypto
    Project (featured), Personal Blog, and Work Portfolio presets with
    device-local drafts, a deterministic local preview, and the exact frozen
    Woke AI generation request (Qwen3 Coder Next, static bundle, no
    trackers, truthful-claims constraint); `/ai` is the platform assistant
    surface over the self-hosted model catalog (Kairos default) with a
    fail-closed `WOKESOCIAL_AI_INFERENCE_URL` runtime reader — messages stay
    on-device and no inference occurs; `/launchpad` previews the fair
    bonding-curve Solana token launch flow (SPL/Token-2022), sentiment
    discovery, and the prepared noncustodial agent API, with launching and
    trading explicitly disabled behind named gates. Verified by the web unit
    suite (22 files / 271 cases) on 2026-07-30. No site is served, no model
    runs, no token exists, and no trade can execute; the mint-aware ABI,
    bonding-curve program, publishing service, and inference runtime all
    remain open gated work.
- [ ] Specify and implement custom-name eligibility, reservation,
  commit/reveal, expiry/grace/cooldown, recovery, transfer, reserved-name,
  impersonation/trademark, appeal, refund, and anti-squatting policy.
- [ ] Implement separate auditable reputation, points, promotional-grant, AI
  credit, and redemption-entitlement ledgers with public formulas, caps,
  anti-abuse controls, reconciliation, statements, and appeals.
- [ ] Build the portable deterministic avatar renderer and off-chain creator
  catalog before enabling optional on-chain creator-item ownership.
- [ ] Define creator subscription, first-1,000 lifetime monthly-rate lock,
  contribution-based access, 30-day initial refund, rights, tax, entitlement,
  and settlement behavior before accepting payment.
- [ ] Prove optional verification with on-device or independently attested
  ephemeral processing, minimal signed claims, no raw evidence persistence,
  calibrated uncertainty, an alternate path, and human appeal.
- [ ] Benchmark current 30–35B-class open models on the actual Apple Silicon
  cluster and ship a replaceable inference API, licensed data pipeline,
  privacy controls, AI-credit metering, and published evaluations.
- [ ] Implement sourced social-sentiment research and paper trading with
  manipulation detection, uncertainty, user-defined risk limits, and
  reproducible performance evaluation.
- [ ] Keep real-money automation disabled until client-held authorization,
  exact simulation/preview, revocation, kill switches, security audit,
  financial/legal review, and user-protection gates pass.
- [ ] Publish machine-readable governance for protocol changes, name rules,
  point formulas, marketplace policy, AI policy, and automation limits without
  assigning control by default to SOL, NFT, purchased-point, or future `$WOKE`
  wealth.

## Vertical slice acceptance gate

This gate is deliberately cross-phase and is the first integrated milestone.

`pnpm test:vertical-slice` passed on the member-signed membership-v2 state from
a fresh Solana local validator and disposable PostgreSQL on 2026-07-29. It
finalized exactly 11 local transactions, applied 10 durable projected events,
produced zero dead letters, compared pre/post replay state exactly, and passed
eight production desktop and mobile-viewport Chromium checks (four before and
four after replay) without request interception. This is local development
scope, not devnet, mainnet-beta, Seeker, or `$WOKE`-mint evidence.

- [x] A user creates an identity on a real local validator.
- [x] The user creates or updates a profile.
- [x] The client canonicalizes and signs a text-post manifest.
- [x] Local content-addressed storage returns a verifiable address.
- [x] The local WokeNet program anchors the manifest hash and reference.
- [x] The indexer validates the event, content hash, and signature.
- [x] The web feed displays the verified post.
- [x] The public directory, exact-network search, and address-routed detail
  display the verified community without exposing private membership data.
- [x] A second identity signs and anchors its own membership-v2 join, and the
  exact-address status response proves finalized active membership without a
  roster or member/actor identity fields.
- [x] A second identity follows the first.
- [x] The following feed includes the post.
- [x] The network projection is completely cleared and rebuilt solely from
  protocol data and signed manifests.
- [x] An automated integration test proves the complete path.

## Final completion gates

- [ ] Build gate passes from a clean checkout.
  - Historical baseline: a fresh same-host `git clone --no-hardlinks` of commit
    `866d88cc5031c41ae74abaa371ad4f62df8f1fba` began clean without
    `node_modules` and passed the then-current canonical verification suite.
    The Solana/Seeker pivot now passes the canonical suite in the working
    checkout, but it has not yet been re-attested from a fresh clone. The prior
    cache-assisted run is retained as historical evidence, not evidence for the
    current tree or an independent-machine/public-cluster attestation.
- [ ] Unit, program, integration, E2E, accessibility, and critical security
  suites pass.
  - Implemented subset: every currently implemented suite passes, including the
    isolated PostgreSQL, real browser passkey lifecycle, local-validator,
    connected-slice, dependency-audit, and secret-scan gates. The objective’s
    complete consumer-journey, Seeker Android, manual accessibility,
    load/failure/restore, and critical-security matrices are not yet implemented,
    so this umbrella completion gate remains open.
- [ ] Essential consumer flows work without manual database editing.
- [ ] Protocol schemas, signatures, hashes, alternate endpoints, rebuild, and
  migration are verified.
- [ ] No known high-severity vulnerability remains.
- [x] Architecture, APIs, deployment, operations, limitations, and clean-machine
  setup documentation match the implementation.
- [x] `FINAL_REPORT.md` distinguishes implemented-and-tested,
  externally-configured, experimental, planned, and not-implemented work.
- [x] Production WokeNet readiness is assessed without automatically deploying
  the program, creating a token mint, publishing an APK, or spending funds.

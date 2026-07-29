# WokeSocial and WokeNet

This `wokenet` repository contains WokeSocial, the open, LGBTQ+ affirming,
trans-owned social platform at `woke.social`, and WokeNet, its portable
protocol and smart-contract deployment layer on the Solana blockchain. WokeNet
is not a blockchain, Solana fork, validator implementation, or separate
consensus network. Solana validators and RPC providers are external; this
repository does not ship a Firedancer/Agave topology or operate WokeNet nodes.

The flagship experience is intended to feel like a polished consumer product.
Users should not need cryptocurrency knowledge, a visible wallet address, or a
token to explore the social network. Compact, verifiable protocol state targets
the WokeSocial program deployed to a selected Solana cluster. Content, media,
private messages, search, recommendations, and other high-volume concerns live
in independently operable offchain layers.

Primary domain: `woke.social`. The legacy `sociallywoke.com` hostname is
redirect-only and must never be treated as a distinct application or WebAuthn
origin.

The configured source remote is the private GitHub repository
`AlexBTC420/wokesocial`. The local repository/workspace identity remains
`wokenet`; source hosting is not a public deployment or release record.

## Project status

This repository began from an empty workspace on 2026-07-28. It is under active
multi-phase implementation. The local foundation, a connected protocol-to-web
slice, and several broader protocol/service paths are implemented and tested,
but nothing is production-ready.
[`TASKS.md`](TASKS.md) records the verification boundary; an unchecked broader
requirement may contain a tested subset without being complete.

| Area | Current state |
| --- | --- |
| Architecture and specifications | Initial baseline implemented; v1 conformance work remains |
| Monorepo and local infrastructure | Implemented and verified locally with PostgreSQL, Redis, Kubo, and hardened service-container profiles |
| WokeNet | The protocol namespace, Anchor program, portable identifiers, deployment manifest schema, SDK boundaries, and indexer bindings are implemented for Solana. Local-validator evidence exists; no devnet or mainnet-beta WokeNet program deployment has been published |
| Social protocol | The generated IDL contains 43 instructions, 19 account layouts, and 33 events. The predeployment community-membership v2 slice replaces creator assignment with member-authorized join/leave plus creator-or-scoped-delegate remove/ban, while the wider local-validator surface covers identity/profile references, one-way identity deactivation, handles, root rotation, scoped delegation, delayed guardian-threshold recovery, social actions, communities/governance, posts, reactions, tombstones, and a quarantined legacy payment ABI |
| Signed content and storage | A strict 29-family portable object registry, including current schema-v2 profile, community, and community-membership objects plus read-compatible historical v1 objects, canonical signed manifests, local CAS, multi-provider storage, IPFS/Kubo, and an Arweave-compatible permanent-storage adapter are implemented and tested |
| Open indexer | Finalized Solana RPC synchronization, exact decoding and projection of all 33 IDL events including one-way identity deactivation, canonical profile-v2, governance-bound community-v2, and member-signed community-membership-v2 verification, exact CID/manifest-URI verification, accepted/pending/terminal ingestion, checkpoint-independent bounded hydration, suppression-aware replay, 18 ordered PostgreSQL migrations, RPC failover, DLQ, provenance, and REST APIs are implemented. Privacy-safe verified-community directory/detail, an exact-address membership-status endpoint with no roster or identity fields, and deterministic `public-match-v2` search complement the consumer-safe home and noncanonical `/v1/feed` projections; fork/reorg evidence, independent-provider reconciliation, and production-scale rebuilds above 50,000 events remain incomplete |
| Feed service | Independently replaceable chronological, following, community, media, bounded-trending, explainable recommendation, and third-party reconciliation engine implemented and tested |
| Relay | Replaceable signed WebSocket transport, bounded finalized key and expiring opaque-topic subscription authorizer HTTP adapters, and multi-relay failover client implemented and tested; independent authorizer deployments and E2EE remain external |
| Flagship web application | Complete required route surface, production build, responsive/a11y states, local composer/preferences/export, provider settings, and real passkey-service registration/sign-in implemented. The consumer-safe home feed, strict bounded chronological pagination, address-routed verified community directory/detail, `public-match-v2` search, and an explicitly public unauthenticated following-graph preview are connected to the open indexer; exact-identity hiding remains device-local, and media-only posts retain verified references without connected gateway playback. Community joining/membership, authenticated following, recommendation-provider integration, cross-device safety, and complete offline caching remain open; unsupported onchain mutations fail closed |
| Moderation and safety | Replaceable signed label/report/appeal service, encrypted durable PostgreSQL case ledger, retention/legal-hold lifecycle, transparency aggregation, locked-by-default authorization, and restricted case reads are implemented; production authorizer/SSO and complete specialist product workflows remain blocked |
| Passkeys and recovery | Replaceable WebAuthn service, durable one-time ceremonies/sessions, discoverable browser registration/sign-in, and ciphertext-only PRF key-bundle sync implemented and tested; protocol-identity creation, recovery, sponsorship, and complete device flows remain open |
| End-to-end encrypted messaging | Experimental pairwise-only adapter delegates real Olm sessions to pinned Matrix Rust crypto WASM, authenticates outer envelopes before state mutation, and passes 13 adversarial real-device cases; volatile storage, browser packaging, attachments, safety UX, and reporting remain non-production |
| Media pipeline | Resumable authenticated worker, strict MIME/hash/container checks, real ClamAV scanning, metadata-free image/video/audio processing, HLS, waveform output, unsigned media manifests, and independent preprocessed publication are implemented and tested; flagship upload integration remains open |
| Creator payments and `$WOKE` | No `$WOKE` mint or successful payment flow exists. The existing lamport-denominated tip/subscription ABI is legacy and quarantined: bootstrap, execution, authority mutation, and unpause fail without state/balance changes. Portable metadata truthfully accepts SOL or exact SPL asset details and rejects `{ kind: "woke" }`; a real SPL/Token-2022 mint, reviewed authorities/tokenomics, a new mint-aware ABI, migration, SDK/UI/indexer work, tests, and audit are required before any `$WOKE` payment claim |
| Solana Seeker app | An Expo/React Native Android foundation implements the Mobile Wallet Adapter connection boundary, exact Solana deployment verification, a read-only chronological feed, verified public-community discovery, and unit-test coverage. Community discovery is read-only: identity selection, manifest signing, simulation, Mobile Wallet Adapter transaction approval, finality, and indexer-catch-up are not connected. It is not a release: no verified Seeker-device run, transaction-signing flow, reproducible signed APK, signing provenance, secure update/rollback evidence, store submission, or publication exists |
| Production deployment | Not authorized or attempted |

The fixed development-localnet program ID is
`9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD`. It is a development identifier,
not evidence of a devnet or mainnet-beta deployment.

### Verified local evidence

- `pnpm setup` installs checksum-verified, project-local Rust 1.89.0, Solana
  2.3.0, and Anchor 0.32.1 development toolchains; starts the pinned local
  containers; and applies PostgreSQL migrations.
- `pnpm test:programs` performs an Anchor SBF build and passes a real
  30-case Solana local-validator suite covering core actions, handle
  release, all six delegated social variants, delayed guardian recovery,
  one-member-one-vote proposal/vote/finalization, quarantined legacy payment paths,
  and adversarial authorization, substitution, snapshot, replay, cancellation,
  epoch, threshold, and payment-quarantine paths. The payment tests prove
  bootstrap, execution, authority mutation, and unpause fail without state or
  balance changes; no successful payment flow exists.
- `pnpm test:vertical-slice` starts a fresh validator and disposable PostgreSQL,
  finalizes exactly 11 real local transactions, verifies signed post,
  schema-v2 community, and member-authored membership-join CAS content through
  the production indexer, asserts privacy-safe exact-address membership status,
  suppresses a tombstoned post, clears and exactly replays 10 durable events,
  and exercises production Next.js before and after replay with eight desktop
  and mobile-viewport Chromium checks. This is local Solana program evidence,
  not a public deployment claim.
- The updated package run covers deterministic canonical bytes and identifiers, Ed25519
  verification across 29 portable object families, local CAS integrity, storage
  replication, recoverable SDK publication, manifest verification, exhaustive
  current-IDL indexing, and in-memory rebuild. That focused baseline
  includes 149 configuration unit cases plus four verified-database-TLS
  integration cases, 206 indexer unit cases across 21 files, 36 isolated
  indexer PostgreSQL cases across 12 files, 38 feed-service cases, and 25
  shared rate-limiter unit cases plus six real-Redis integration cases.
  The workspace-wide membership-v2 gates pass; counts not explicitly updated
  for that slice retain the prior published baseline and should not be treated
  as a newly captured aggregate.
- Relay tests exercise 81 unit cases and 34 real-loopback WebSocket integration
  cases, including signed envelopes, locked-by-default authorization, bounded
  retention, backpressure, failover, reconnect, deduplication, subscription
  scope enforcement, and relay-local gap detection.
- Thirteen real-WASM messaging cases create independent devices, establish
  authenticated Olm sessions through opaque directory requests, verify
  sender-signed routing metadata before stateful decryption, reject relay
  mutation without consuming the honest copy, enforce local and remote
  revocation, bound dependency stalls, and keep plaintext out of directory and
  relay artifacts. The adapter exposes no group/room API and rejects its
  memory-only storage mode in production.
- The media worker passes 70 adversarial unit cases and three real
  Sharp/FFmpeg/ffprobe integrations. Its hardened Compose profile additionally
  passes benign/EICAR scans through the production adapter and digest-pinned
  ClamAV 1.5.3 while both containers run unprivileged with read-only roots and
  no published clamd port.
- Container integration tests pass against PostgreSQL and Kubo. The PostgreSQL
  test projects signed profile/post/tombstone manifests, a follow edge, duplicate
  delivery, feed filtering, and deterministic rebuild.
- The 46-page Next.js route surface builds for production; 109 web unit tests
  and 210 desktop and mobile-viewport Playwright cases pass, with two deliberate
  duplicate mobile-viewport passkey lifecycle cases skipped. The suite includes
  automated axe WCAG A/AA checks across 45 route fixtures in both desktop and
  mobile-viewport projects, plus
  semantic connected-post coverage and a real virtual-authenticator
  atomic-registration, logout, and discoverable-sign-in journey.
- The replaceable authentication service passes 34 unit/API security and
  retention cases, four isolated PostgreSQL integration cases, and one
  real-browser WebAuthn ceremony case. Initial credential/root-wrapper/account
  activation, same-root passkey addition, and authentication/session issuance
  are atomic at their respective store boundaries; revocation is step-up
  protected and invalidates service sessions. The service never receives a PRF
  result or plaintext signing seed and does not claim to create or revoke the
  protocol identity or Solana program delegation.
- The moderation provider passes 56 unit cases and four isolated PostgreSQL
  cases, including append-only ledger enforcement, runtime-role deletion
  denial, readiness privilege checks, and retention-safe maintenance behavior.
- Digest-pinned OCI images for authentication, feed, relay, and moderation
  services have been locally built and exercised as unprivileged users with
  read-only roots, dropped capabilities, bounded process counts, and explicit
  liveness/readiness behavior.
- The dependency audit currently reports no known vulnerabilities after exact
  patched-version overrides; a checksum-pinned Gitleaks wrapper and CI security
  workflow are configured.

## Architectural commitments

- Identity and the social graph must survive the flagship client and database.
- Public content is versioned, content-addressed, signed, and independently
  verifiable.
- PostgreSQL indexers are disposable projections, never canonical state.
- RPC providers, content gateways, indexers, relays, storage providers,
  moderation providers, and feed providers are replaceable.
- Sensitive personal information and private messages never go onchain.
- A public or unlisted open-community join/leave must be authorized by the
  member identity. A creator root or current scoped delegate may remove or ban
  only an existing membership; `banned` is terminal.
- The public indexer may answer one exact verified membership-PDA status query
  for an open public/unlisted community, but it exposes no roster, member or
  actor identity, signer authority, moderation reason, or manifest location.
- Private content is encrypted before it reaches storage or relays.
- Deletion is implemented with client/indexer suppression, storage-provider
  requests where possible, key destruction for encrypted content, and signed
  tombstones. Permanent or replicated copies cannot be dishonestly promised
  away.
- Ordinary identities, posts, reading, and social participation are not
  token-gated, and no NFT is required.
- No `$WOKE` mint exists. The name is reserved for a possible future
  SPL/Token-2022 asset; it is not SOL, lamports, a native fee currency, or a
  currently usable payment instrument.
- The non-release Android foundation targets Solana Seeker and Mobile Wallet
  Adapter. Its current feed and community discovery are read-only; a release
  still requires the missing wallet-backed mutation flow, device evidence,
  transaction-intent tests, reproducible builds, controlled signing, signed-APK
  provenance, security review, secure update/rollback evidence, and explicit
  distribution approval.

The detailed design is in:

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/PROTOCOL.md`](docs/PROTOCOL.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
- [`docs/MODERATION.md`](docs/MODERATION.md)
- [`docs/PRIVACY.md`](docs/PRIVACY.md)
- [`docs/DECENTRALIZATION.md`](docs/DECENTRALIZATION.md)
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/DECISIONS/`](docs/DECISIONS/)

## Repository layout

```text
apps/
  web/                  Complete required route surface and connected read-only slice
  mobile/               Non-release Expo/React Native Seeker and Mobile Wallet Adapter foundation
  auth-service/         Replaceable WebAuthn RP, sessions, and ciphertext-only key-bundle sync
  indexer/              Finalized Solana RPC synchronizer and rebuildable projection
  feed-service/         Replaceable chronological/recommendation feed engine
  relay/                Non-authoritative signed WebSocket transport and client
  moderation-service/   Signed label and restricted report/appeal provider
  media-worker/         Resumable, verified, noncustodial media preparation
packages/
  protocol/             Implemented canonical schemas, signatures, hashes, and IDs
  storage/              Local, memory, multi-provider, IPFS, and Arweave adapters
  sdk/                  Post/profile/community/membership publication plus quarantined legacy payment helpers
  ui/                   Implemented accessible design-system subset
  config/               Implemented shared typed local configuration
  crypto/               WebCrypto hashing, HKDF, sealed envelopes, and passkey key wrapping
  messaging/            Pairwise-only Matrix Rust crypto WASM adapter
  test-fixtures/         Deterministic public protocol fixtures and golden values
programs/
  social_protocol/      Implemented Anchor core-protocol subset
network/
  solana/               WokeNet deployment manifests and Solana cluster metadata
infra/                  Local and provider-neutral infrastructure
scripts/                Reproducible setup, verification, and operations
docs/                   Product, protocol, security, and operator docs
```

Production messaging, complete recovery UX, payment UX, release-grade Seeker delivery,
and other incomplete boundaries are not presented as false-success services.
The moderation, authentication, pairwise encryption, recovery-program,
quarantined payment-program/SDK/indexer, and media paths are implemented
subsets, not claims that the full safety, protocol identity, account-recovery,
messaging, creator-economy, mobile, or publication products are complete.

## Developer commands

The following root interfaces are implemented:

```sh
pnpm install --frozen-lockfile
pnpm setup
pnpm dev
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm measure:performance
pnpm test:programs
pnpm test:vertical-slice
pnpm lint
pnpm typecheck
pnpm build
```

`pnpm test` is the fast workspace unit suite. Container integrations,
Solana local-validator tests, the connected local proof, and browser tests
remain explicit commands:

```sh
pnpm test:integration
pnpm test:programs
pnpm test:vertical-slice
pnpm test:e2e
pnpm measure:performance
```

`pnpm verify:all` composes the workspace gates, container integrations, browser
suite, local production-browser performance observation, Solana local-validator
program suite, connected local slice, dependency audit, and local
secret scan when the required local services are available. It does not deploy
to devnet or mainnet-beta, publish a Seeker APK, or create a `$WOKE` mint.

`pnpm dev` loads `.env` or the checked-in local-only `.env.example`, starts and
waits for PostgreSQL, Redis, Kubo, the private ClamAV network, and the
containerized media worker, reapplies idempotent local migrations, then starts
the implemented workspace development processes. Relay and moderation run in
an explicitly loopback-only advisory mode. The command rejects production
environments and non-loopback service binds before it enables those two
development-only overrides. Standalone services remain locked by default. Stop
persistent containers with `pnpm infra:down`.

## Security and privacy

Do not report a security vulnerability in a public issue. The private reporting
process is documented in [`SECURITY.md`](SECURITY.md).

Never commit seed phrases, private keys, passkey material, session keys,
database credentials, provider tokens, or production RPC URLs with embedded
credentials. Development examples must use deterministic local-only fixtures.

The privacy and legal documents in this repository are technical implementation
support. They are not legal advice and require review by qualified counsel
before a public launch.

## Licensing

The repository is licensed under Apache License 2.0. See [`LICENSE`](LICENSE).

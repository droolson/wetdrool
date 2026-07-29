# WokeNet

This `wokenet` repository contains WokeNet, the sovereign blockchain network,
and WokeSocial, its open, LGBTQ+ affirming, trans-owned social-network protocol
and reference client. The platform is built around user-controlled identity,
signed content, and replaceable infrastructure.

The flagship experience is intended to feel like a polished consumer product.
Users should not need cryptocurrency knowledge, a visible wallet address, or
WOKE to explore the social network. Compact, verifiable protocol state and
native creator settlement target WokeNet, a sovereign
Solana-protocol-compatible network. Content, media, private messages, search,
recommendations, and other high-volume concerns live in independently operable
offchain layers.

Primary domain: `woke.social`. The legacy `sociallywoke.com` hostname is
redirect-only and must never be treated as a distinct application or WebAuthn
origin.

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
| WokeNet | Sovereign network identity, native WOKE policy, pinned native-Firedancer downstream, deterministic genesis patch, a bounded native `getProgramAccounts` subset with direct C tests, native-only configurations, and fail-closed capability gates are implemented; five required RPC methods and native-cluster evidence remain missing, so production activation is blocked |
| Social protocol | The Solana-wire compatibility oracle verifies 41 instructions, 19 account layouts, and 33 events covering identity/profile references, root-authorized one-way identity deactivation, handles, root rotation, scoped delegation, delayed guardian-threshold recovery, social actions, communities/governance, posts, reactions, tombstones, native WOKE tips, subscriptions, receipts, and entitlements; this is not native WokeNet evidence |
| Signed content and storage | A strict 29-family portable object registry, canonical signed manifests, local CAS, multi-provider storage, IPFS/Kubo, and an Arweave-compatible permanent-storage adapter are implemented and tested |
| Open indexer | Finalized Solana-format RPC synchronization tested against the Agave compatibility oracle, exact decoding and projection of all 33 IDL events including one-way identity deactivation, canonical onchain profile-v2 commitments plus an immutable legacy cutoff, exact CID/manifest-URI verification, accepted/pending/terminal ingestion, checkpoint-independent bounded hydration, suppression-aware replay, sixteen PostgreSQL migrations, failover, DLQ, provenance, and REST APIs are implemented; native Firedancer RPC, fork/reorg evidence, independent-provider reconciliation, and production-scale rebuilds above 50,000 events remain incomplete |
| Feed service | Independently replaceable chronological, following, community, media, bounded-trending, explainable recommendation, and third-party reconciliation engine implemented and tested |
| Relay | Replaceable signed WebSocket transport, bounded finalized key and expiring opaque-topic subscription authorizer HTTP adapters, and multi-relay failover client implemented and tested; independent authorizer deployments and E2EE remain external |
| Flagship web application | Complete required route surface, production build, responsive/a11y states, local composer/preferences/export, provider settings, and real passkey-service registration/sign-in implemented; unsupported onchain mutations fail closed |
| Moderation and safety | Replaceable signed label/report/appeal service, encrypted durable PostgreSQL case ledger, retention/legal-hold lifecycle, transparency aggregation, locked-by-default authorization, and restricted case reads are implemented; production authorizer/SSO and complete specialist product workflows remain blocked |
| Passkeys and recovery | Replaceable WebAuthn service, durable one-time ceremonies/sessions, discoverable browser registration/sign-in, and ciphertext-only PRF key-bundle sync implemented and tested; protocol-identity creation, recovery, sponsorship, and complete device flows remain open |
| End-to-end encrypted messaging | Experimental pairwise-only adapter delegates real Olm sessions to pinned Matrix Rust crypto WASM, authenticates outer envelopes before state mutation, and passes 13 adversarial real-device cases; volatile storage, browser packaging, attachments, safety UX, and reporting remain non-production |
| Media pipeline | Resumable authenticated worker, strict MIME/hash/container checks, real ClamAV scanning, metadata-free image/video/audio processing, HLS, waveform output, unsigned media manifests, and independent preprocessed publication are implemented and tested; flagship upload integration remains open |
| Events and creator payments | Native WOKE tip/subscription instructions, IDL-aligned SDK instruction/proof helpers, permanent receipts/entitlements, and rebuildable indexer projections are implemented against the compatibility oracle; flagship transaction UX and native Firedancer settlement remain disabled |
| Production deployment | Not authorized or attempted |

The fixed compatibility-localnet program ID is
`9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD`. It is a development identifier,
not evidence of a native WokeNet deployment.

### Verified local evidence

- `pnpm wokenet:check` structurally verifies the pinned Firedancer source
  and patch checksums, native-only build declarations, fail-closed RPC
  capability record, the bounded `getProgramAccounts` filters, configurations,
  and resource ceilings, the five still-missing required RPC methods, WOKE unit
  policy, TOML safety settings, and local genesis allocations.
  `pnpm wokenet:materialize -- /absolute/path` produces the exact downstream
  source tree. The supported-Linux binary gate builds and runs the native
  account-database and RPC C tests; a connected native cluster is still
  required.
- `pnpm setup` installs checksum-verified, project-local Rust 1.89.0, Agave
  2.3.0, and Anchor 0.32.1 compatibility toolchains; starts the pinned local
  containers; and applies PostgreSQL migrations. Agave is never WokeNet
  runtime evidence.
- `pnpm test:programs` performs a native Anchor SBF build and passes a real
  34-case Agave compatibility-oracle suite covering core actions, handle
  release, all six delegated social variants, delayed guardian recovery,
  one-member-one-vote proposal/vote/finalization, native WOKE payment paths,
  and adversarial authorization, substitution, snapshot, replay, cancellation,
  epoch, threshold, rounding, and entitlement paths.
- `pnpm test:vertical-slice` starts a fresh validator and disposable PostgreSQL,
  finalizes nine real local transactions, verifies exact signed CAS content
  through the production indexer, suppresses a tombstoned post, clears and
  exactly replays the projection, and exercises production Next.js on desktop
  and mobile Chromium. This is a Solana-format compatibility proof, not a
  native WokeNet transaction claim.
- Package tests cover deterministic canonical bytes and identifiers, Ed25519
  verification across 29 portable object families, local CAS integrity, storage
  replication, recoverable SDK publication, manifest verification, exhaustive
  current-IDL indexing, and in-memory rebuild. The current focused evidence
  includes 144 configuration unit cases plus four verified-database-TLS
  integration cases, 184 indexer unit cases across 20 files, 27 isolated
  indexer PostgreSQL cases across 11 files, and 36 feed-service cases.
- Relay tests exercise 81 unit cases and 29 real-loopback WebSocket integration
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
- The 46-page Next.js route surface builds for production; 81 web unit tests and
  206 desktop/mobile Playwright cases pass, with two deliberate duplicate
  mobile passkey lifecycle cases skipped. The suite includes automated axe WCAG A/AA
  checks across 45 route fixtures in both desktop and mobile projects, plus
  semantic connected-post coverage and a real virtual-authenticator
  atomic-registration, logout, and discoverable-sign-in journey.
- The replaceable authentication service passes 34 unit/API security and
  retention cases, four isolated PostgreSQL integration cases, and one
  real-browser WebAuthn ceremony case. Initial credential/root-wrapper/account
  activation, same-root passkey addition, and authentication/session issuance
  are atomic at their respective store boundaries; revocation is step-up
  protected and invalidates service sessions. The service never receives a PRF
  result or plaintext signing seed and does not claim to create or revoke the
  protocol identity or WokeNet delegation.
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
- Private content is encrypted before it reaches storage or relays.
- Deletion is implemented with client/indexer suppression, storage-provider
  requests where possible, key destruction for encrypted content, and signed
  tombstones. Permanent or replicated copies cannot be dishonestly promised
  away.
- WOKE is the network’s native fee/staking/settlement currency, not an SPL
  token. Ordinary identities, posts, reading, and social participation are not
  token-gated, and no NFT is required.

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
  auth-service/         Replaceable WebAuthn RP, sessions, and ciphertext-only key-bundle sync
  indexer/              Solana-format RPC synchronizer tested against the compatibility oracle
  feed-service/         Replaceable chronological/recommendation feed engine
  relay/                Non-authoritative signed WebSocket transport and client
  moderation-service/   Signed label and restricted report/appeal provider
  media-worker/         Resumable, verified, noncustodial media preparation
packages/
  protocol/             Implemented canonical schemas, signatures, hashes, and IDs
  storage/              Local, memory, multi-provider, IPFS, and Arweave adapters
  sdk/                  Publication pipeline plus WOKE instruction/simulation/proof helpers
  ui/                   Implemented accessible design-system subset
  config/               Implemented shared typed local configuration
  crypto/               WebCrypto hashing, HKDF, sealed envelopes, and passkey key wrapping
  messaging/            Pairwise-only Matrix Rust crypto WASM adapter
  test-fixtures/         Deterministic public protocol fixtures and golden values
programs/
  social_protocol/      Implemented Anchor core-protocol subset
network/
  wokenet/         Pinned native-Firedancer downstream, policy, configs, and gates
infra/                  Local and provider-neutral infrastructure
scripts/                Reproducible setup, verification, and operations
docs/                   Product, protocol, security, and operator docs
```

Production messaging, complete recovery UX, payment UX, native-network
settlement, and other incomplete boundaries are not presented as false-success
services. The moderation, authentication, pairwise encryption,
recovery-program, payment-program/SDK/indexer, and media paths are implemented
subsets, not claims that the full safety, protocol identity, account-recovery,
messaging, creator-economy, or publication products are complete.

## Developer commands

The following root interfaces are implemented:

```sh
pnpm install --frozen-lockfile
pnpm setup
pnpm wokenet:check
pnpm wokenet:materialize -- /absolute/path/to/wokenet-firedancer
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
Agave compatibility-oracle tests, the connected compatibility proof, and
browser tests remain explicit commands:

```sh
pnpm test:integration
pnpm test:programs
pnpm test:vertical-slice
pnpm test:e2e
pnpm measure:performance
```

`pnpm verify:all` composes the workspace gates, container integrations, browser
suite, local production-browser performance observation, compatibility-oracle
program suite, connected compatibility slice, dependency audit, and local
secret scan when the required local services are available. Native Firedancer
build/cluster evidence remains a separate supported-Linux gate and is not
inferred from `verify:all`.

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

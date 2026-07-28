# Final verification report

- Date: 2026-07-28
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
- Native WOKE tip and weekly-subscription program primitives, receipts,
  entitlements, SDK instruction builders, allocation checks, simulation
  comparison, and finalized-account proof verification pass against an Agave
  compatibility oracle.
- A local compatibility slice creates signed content and finalized program
  state, syncs it into PostgreSQL, serves it through the production indexer and
  production Next.js build, destroys the projection, replays it, and obtains
  identical desktop/mobile results.
- WokeNet source policy is pinned to one exact official Firedancer commit,
  one exact downstream patch, and one exact OpenSSL source commit. The
  materializer and supported-Linux binary-attestation command reject Agave,
  Frankendancer, `fdctl`, pre-existing build output, inherited build injection,
  source drift, dependency drift, and unbound binaries.
- The repository root, package name, package scope, platform IDs, chain IDs,
  environment-variable namespaces, and wire namespace pass an automated naming
  policy: WokeSocial/`wokesocial` is the application platform and
  WokeNet/`wokenet` is the chain and repository.

Production activation remains blocked. Upstream says full no-Agave Firedancer
has no release and is not ready for test or production use. The pinned native
RPC source is missing six methods required by the social stack. No native WokeNet
cluster has been built and launched end to end, no production genesis or
economic policy is approved, no native program deployment exists, and no
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

| Layer                | Delivered architecture                                                                                                                                                                                                               | Status and boundary                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace            | Strict pnpm/Turborepo monorepo with 15 workspaces: seven apps and eight packages                                                                                                                                                     | Implemented and tested                                                                                                                |
| Web                  | Next.js App Router reference client with 46 page files, canonical-host proxy, provider settings, read-only/degraded states, device-local composer/preferences/export, and responsive themes                                          | Implemented and tested subset; transactional product flows remain gated                                                               |
| Portable protocol    | 29 versioned object families, RFC 8785 canonical bytes, SHA-256 object identifiers/CIDs, Ed25519 signatures, authorization transitions, and generated Draft 2020-12 JSON Schema                                                      | Implemented and tested TypeScript subset; shared Rust/TypeScript golden corpus remains planned                                        |
| WokeSocial program   | Anchor/SBF program with configuration, identities/profiles, handles, root rotation, delegation, recovery, follows/blocks, communities, voting, posts/reactions/tombstones, WOKE tips, subscriptions, receipts, and entitlements      | Implemented and tested only against the Agave compatibility oracle                                                                    |
| WOKE SDK             | Operation-scoped signed publication plus seven IDL-aligned Anchor instruction builders, PDA derivation, Hamilton allocation, mandatory network context, parsed-simulation comparison, and finalized receipt/entitlement verification | Implemented and tested subset; no concrete RPC parser, payment-message compiler, payment transaction signer/broadcaster, or wallet UX |
| Indexer              | Solana-format finalized sync, exact 32-event decoder, signed-manifest validation, checkpoints, retry/DLQ, replay, provenance, REST/OpenAPI, and ten PostgreSQL projection migrations                                                 | Implemented and tested against compatibility RPC/PostgreSQL; native Firedancer RPC and reorg evidence absent                          |
| Replaceable services | WebAuthn auth service, seven-mode feed service, signed WebSocket relay, moderation service, and hardened media worker                                                                                                                | Implemented and tested subsets; production authorization, provider accounts, SSO, storage, and telemetry require configuration        |
| Storage              | Memory/local CAS, quorum provider, Kubo/IPFS adapter, and consent-gated Arweave-compatible adapter                                                                                                                                   | Implemented and tested locally; funded/permanent production providers require external configuration                                  |
| Messaging            | Pairwise Olm adapter backed by Matrix Rust crypto WASM, signed routing envelope, authorization/revocation checks, and fail-closed production storage policy                                                                          | Experimental; volatile state only, without browser persistence, attachments, safety UX, or group messaging                            |
| WokeNet              | Pinned native Firedancer source/patch policy, native-only configs, WOKE genesis policy, capability record, materializer, source checker, genesis byte-hash verifier, and isolated Linux binary-attestation gate                      | Experimental scaffold; no passing native connected cluster or production release                                                      |
| Operations           | Threat model, security, privacy, accessibility, deployment, incident, decentralization, legal-review, and nine ADR documents                                                                                                         | Implemented documentation; production drills and independent reviews are open                                                         |

## WokeNet and `$WOKE`

### Implemented source and policy controls

- Official Firedancer upstream:
  `60c3d2e381a6607f63adc818481e2f31472ae681`.
- Downstream marker: `WokeNet Firedancer downstream-v1`.
- Downstream patch:
  `0001-explicit-sovereign-genesis-allocations.patch`, SHA-256
  `7d1f6419c7325cdfbe777df740a0f5708f1de510d3b4e650a4e9483982767806`.
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
reapplies only the pinned patch, clones and rebuilds the pinned OpenSSL source,
runs `test_genesis_create` and `test_rpc_tile`, checks ELF64 little-endian x86-64
executables, requires defined global native function symbols, verifies exact
version/commit branding, rejects forbidden dynamic dependencies, parses native
tile topology, hashes evidence, and removes the disposable checkout.

### Native RPC status

The following are **source observations, not conformance results**:

| Observed method bodies | Required but explicitly unimplemented |
| ---------------------- | ------------------------------------- |
| `getAccountInfo`       | `getProgramAccounts`                  |
| `getBalance`           | `getSignaturesForAddress`             |
| `getGenesisHash`       | `getSignatureStatuses`                |
| `getLatestBlockhash`   | `getTransaction`                      |
| `getMultipleAccounts`  | `sendTransaction`                     |
| `getSlot`              | `simulateTransaction`                 |

Only `getMultipleAccounts` has direct native upstream C-test coverage recorded
in the capability file. `getSignatureStatuses` is design-only: the checked-in
design records the required snapshot/live result cache, commitment, fork, and
direct C-test work, while the capability remains false and no implementation is
claimed. A historical ad hoc Linux audit built both native ELF binaries and
passed the two named upstream tests, but its synthetic sysfs fixture stopped
before the complete topology phase. No retained passing attestation artifact or
native cluster claim exists.

## Features delivered

### Implemented and tested

- Canonical `woke.social` origin and permanent exact-host legacy redirects.
- Complete documented web route surface with explicit disabled/degraded states
  instead of fake mutation success.
- Portable signed object, storage, publication, indexer, replay, feed, relay,
  moderation, authentication, media-processing, and provider-selection
  subsets.
- Anchor program with 40 instructions, 19 account types, 32 events, 121 errors,
  and 90 IDL types.
- Delayed guardian-threshold recovery primitive and one-active-member-one-vote
  governance primitive.
- Native WOKE tip and weekly-subscription compatibility primitives with
  permanent receipt/entitlement accounts and exact value conservation.
- Seven WOKE SDK instruction builders with one-to-three-recipient allocation,
  account-order/signer/writable checks, replay context, optional-account
  sentinels, simulation verification, and finalized proof verification.
- Operation-scoped SDK publication signing with a canonical payload snapshot and
  pre-storage rejection of signer payload, identity, key, or signature
  substitution.
- Ten indexer, five auth, and two moderation SQL migrations.
- Pairwise encrypted-message cryptographic adapter and real WebAuthn
  service-account ceremony subset. Initial credential/wrapper/activation,
  additional same-root passkeys, authentication/session issuance, and
  credential revocation are atomic at their respective store boundaries.
- Browser service-passkey listing, same-root addition, step-up-protected
  revocation, and cross-tab CSRF recovery. Service-passkey revocation does not
  claim to revoke a separate WokeNet delegation.
- Desktop/mobile browser semantics, accessibility automation, and a
  reproducible local production-browser performance observation.

### Implemented; external configuration required

- DNS, TLS, hosting, and edge routing for `woke.social`,
  `sociallywoke.com`, and `www.sociallywoke.com`.
- Production PostgreSQL roles/TLS, Redis, Kubo/pinning providers, gateways, and
  a funded Arweave-compatible uploader.
- Auth relying-party origin/ID, credential and session secrets, relay
  finalized-state authorization, moderation object authorization/SSO, ClamAV,
  private media bearer credentials, and production media storage.
- Public indexer/feed/relay/moderation/storage endpoints and provider registry.
- Secret manager, monitoring, privacy-controlled error reporting, alerting,
  backup/restore, verified security mailbox, and operator keys.

### Experimental

- The native Firedancer WokeNet downstream and native RPC path.
- Every WOKE settlement result, because execution evidence currently comes from
  the compatibility oracle rather than native Firedancer.
- Creator WOKE tips/subscriptions and passkey-to-protocol identity integration,
  because the flagship WokeNet identity/delegation transaction path is absent.
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
- Search service, full story/event/livestream semantics, paid
  communities/events, refunds, and additional governance strategies.
- Manual WCAG review, field Core Web Vitals, load/capacity, regional latency,
  resilience, restore, failover, and incident exercises.
- Production multisig/upgrade authority, SBOM, signed provenance/artifacts, and
  independent operators.

### Not implemented

- Native versions of the six required missing RPC methods.
- A deployed native WokeNet validator/RPC cluster or WokeSocial program deployment.
- Group encrypted messaging.
- A production exchange, lending, yield, public sale, bridge, or custodial
  wallet. These are intentionally outside the delivered subset.
- A production deployment artifact or real-funds operation in this repository.
  External systems not represented by repository evidence were not assessed.

## Test counts and results

All results below were obtained on 2026-07-28 unless marked as an incomplete
native audit.

| Gate                       | Result                                                    | Evidence boundary                                                                                                 |
| -------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Frozen install             | Pass: all 16 projects already up to date with pnpm 11.2.2 | Renamed working tree; final-commit no-hardlink clone evidence is recorded separately                              |
| Final committed clone      | Pass                                                      | Separate same-host `git clone --no-hardlinks`, frozen install, and `pnpm verify`; not an independent machine      |
| `pnpm verify`              | Pass                                                      | Workspace/naming/domain/network policy, formatting, lint, typecheck, unit, build, local production redirect probe |
| Naming policy              | Pass                                                      | Repository/package `wokenet`; platform `WokeSocial`/`wokesocial`; network `WokeNet`/`wokenet`                     |
| Type checks                | 15/15 workspaces pass                                     | Strict TypeScript configuration                                                                                   |
| Unit command               | 438 passing test executions                               | Messaging’s real-WASM file also runs in integration, so cross-gate totals are not unique                          |
| Integration command        | 43 passing across 13 files                                | Isolated PostgreSQL 16, media processors, WebSocket relay, real WASM, and Kubo                                    |
| Rust program tests         | 21 passing                                                | Sizing, validation, PDA/discriminator, sequence, and allocation helpers                                           |
| Program compatibility      | 33/33 passing                                             | Real Agave local validator; compatibility evidence only                                                           |
| Web Playwright             | 203 pass, 1 intentional mobile passkey duplicate skipped  | Desktop Chrome and Pixel 7 projects                                                                               |
| Auth browser E2E           | 1 pass                                                    | Chromium virtual authenticator                                                                                    |
| Root browser total         | 204 pass, 1 skip                                          | Does not include the connected-slice executions                                                                   |
| Connected slice            | 2 desktop/mobile passes before replay and 2 after replay  | Nine finalized transactions, eight replayed events, zero dead letters                                             |
| IDL/indexer drift          | Pass                                                      | Checked-in decoder exhaustively covers all 32 IDL events                                                          |
| Domain production probe    | Pass                                                      | Local production-mode server with Host headers: exact legacy hosts preserve path/query in `308` redirects         |
| WokeNet static policy      | Pass                                                      | Source locks, patch, config, native-only policy, capability record, and fail-closed production flags              |
| WokeNet source apply/check | Pass                                                      | Fresh disposable checkout at the pinned upstream commit accepted the exact downstream patch and source audit      |
| Native binary/cluster      | Not passed                                                | macOS cannot run the Linux-only binary gate; no complete attestation artifact or native connected cluster         |
| Dependency audit           | Pass at check time: no known vulnerabilities reported     | Registry snapshot only; Node advisory caveat below                                                                |
| Secret scan                | Pass: 4.27 MB history and 4.44 MB working tree, no leaks  | Gitleaks rules, three commits, and current tracked candidate files                                                |

### Unit test executions by workspace

| Workspace          | Passing |
| ------------------ | ------: |
| Auth service       |      24 |
| Feed service       |      29 |
| Indexer            |      70 |
| Media worker       |      57 |
| Moderation service |      41 |
| Relay              |      24 |
| Web                |      61 |
| Configuration      |      20 |
| Crypto             |      12 |
| Messaging          |      13 |
| Protocol           |      40 |
| SDK                |      30 |
| Storage            |      14 |
| Test fixtures      |       3 |
| **Total**          | **438** |

### Integration executions by surface

| Surface               | Passing |
| --------------------- | ------: |
| Auth PostgreSQL       |       3 |
| Indexer PostgreSQL    |       9 |
| Media processors      |       3 |
| Moderation PostgreSQL |       3 |
| Relay real WebSocket  |      11 |
| Messaging real WASM   |      13 |
| Kubo/IPFS             |       1 |
| **Total executions**  |  **43** |

## Build results

- All 14 workspaces with production build scripts passed; all 15 workspaces
  passed type checking. The UI package is typechecked and consumed by the web
  build but has no separate build script.
- Final Next.js 16.2.12 run:
  - optimized compilation: 1.461 seconds;
  - TypeScript phase: 1.535 seconds;
  - 34 static-generation pages: 154 milliseconds;
  - 46 application page files, with 32 static route entries including
    `_not-found` and 15 dynamic routes.
- The SBF artifact rebuilt after the `wokesocial` PDA namespace change is
  `1,587,776` bytes with SHA-256
  `daab7ac9c7717422c5d6f458bb38e5c88b08b3ac6a078580c132e11e1c48e3b1`.
- The regenerated IDL is `311,163` bytes with SHA-256
  `ed335e9e08ffd979fb193544208470338e46ca32b13851199cc6c8d9c7ade397`
  and declares program `9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD`.
- No native Firedancer binary was built or launched on the macOS verification
  host. The Linux checker exists but is a separate, currently incomplete
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
- WokeNet binary tooling sanitizes child environments, disables ambient Git
  configuration/replacements, uses pinned source/dependencies, builds in fresh
  roots, and verifies defined ELF symbols and native-only topology.

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

- The web suite passed 203 browser cases with one intentionally skipped
  duplicate mobile passkey case.
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

| Route       |   TTFB | DOM content loaded |    Load | LCP observation | CLS observation |
| ----------- | -----: | -----------------: | ------: | --------------: | --------------: |
| `/`         | 2.8 ms |            29.7 ms | 47.6 ms |           52 ms |               0 |
| `/home`     | 6.9 ms |            25.9 ms | 43.7 ms |           68 ms |               0 |
| `/feeds`    | 2.5 ms |            26.2 ms | 43.9 ms |           40 ms |               0 |
| `/protocol` | 3.5 ms |            23.9 ms | 42.6 ms |           36 ms |               0 |
| `/settings` | 3.4 ms |            26.1 ms | 44.9 ms |           40 ms |               0 |

This is a laboratory observation, not field Core Web Vitals. It excludes INP,
network throttling, production RPC/indexer/auth/media/storage latency, regional
edges, load, long-feed behavior, and capacity.

Compatibility-validator cost observations keep the tested program
transactions below the Solana packet/compute ceilings. The largest recorded
transaction in the current suite was an 892-byte subscription settlement; the
largest recorded compute use was 64,523 units. These are Agave
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
- Six required native RPC methods are explicitly unimplemented.
- Static source observations and isolated binary tests are not cluster,
  consensus, restart, replay, finality, fee, or failure evidence.
- Production WOKE supply, allocation, inflation, rewards, fees, validator
  economics, public-sale policy, and genesis ceremony are unapproved.
- The WOKE SDK now has operation-scoped publication signing and pre-publication
  verification, but concrete payment RPC decoding, compiled-message/blockhash
  equality, payment-transaction signing/broadcasting, wallet prompts, and
  sponsorship are absent.
- Native payment settlement, wallet onboarding, protocol-identity/passkey
  integration, production recovery UX, and real-funds operation are absent.
- Messaging state is volatile; group messaging is absent.
- Media processing exists, but flagship upload/publication is not connected.
- Search and several rich product semantics remain presentation/design
  surfaces rather than production services.
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

The development command starts implemented workspace processes. Production
provider-backed behavior still requires the variables documented in
`.env.example` and the deployment guide.

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

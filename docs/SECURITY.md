# Security

Last reviewed: 2026-07-29

## Document status

This document defines the security requirements for WokeSocial and WokeNet. It is a design
contract, not evidence that a control exists.

Status terms used throughout the project:

- **Planned**: required by design, but not yet implemented.
- **Implemented**: code or infrastructure exists, but verification evidence is
  incomplete.
- **Verified**: the control has current automated or reproducible manual evidence.
- **Accepted risk**: a named owner has documented the residual risk, scope, reason,
  expiry, and compensating controls.

The repository now contains implementation, configuration, CI workflows, and
tests for a substantial experimental foundation. Passing local evidence covers
canonical signature/hash/CID rejection, storage consent and corruption,
Anchor authorization/replay/sequence/overflow/recovery paths, finalized
indexing and PostgreSQL replay, exact-origin WebAuthn ceremonies, pairwise real
WASM encryption, signed relay/moderation boundaries, adversarial media
processing, and live ClamAV benign/malware scans. Hardened local OCI profiles
run unprivileged with read-only roots and explicit readiness. This evidence is
still partial: none of the complete production gates below is satisfied, and no
independent audit has occurred. A requirement expressed with `MUST` or
`SHOULD` describes the intended production gate.

The current dependency remediation is explicit rather than floating: pnpm
overrides pin patched `sharp` 0.35.3, `postcss` 8.5.23,
`serialize-javascript` 7.0.7, `brace-expansion` 5.0.8, `diff` 8.0.3, and
`uuid` 11.1.1. `minimatch` 3.1.5 carries a small checked-in compatibility patch
for the `brace-expansion` named export. With those locked inputs, the current
pnpm audit reports no known vulnerabilities. That point-in-time result does not
replace continuous review, provenance, or an SBOM.

There is one time-sensitive runtime blocker as of 2026-07-28. Node has
[announced a 22.x security release](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases)
whose highest severity is HIGH, but its
[latest v22 artifact index](https://nodejs.org/download/release/latest-v22.x/)
still exposes only 22.23.1. The repository therefore retains the latest
available exact Node 22.23.1 image digest for reproducibility, but production
artifact publication is blocked until the patched v22 build is available,
reviewed, and every Node image/toolchain pin is rotated. The media scanner was
separately upgraded from vulnerable ClamAV 1.5.2 to patched, digest-pinned 1.5.3
after the [official ClamAV security release](https://blog.clamav.net/2026/07/).

## Security objectives

WokeSocial is designed to preserve:

1. User control of identity, keys, social graph, content, and provider choice.
2. Confidentiality and authenticity of private messages and restricted content.
3. Integrity of signed manifests, WokeNet state, moderation labels, and indexer
   projections.
4. Availability during a failure or compromise of any single RPC, gateway,
   indexer, relay, cache, or storage provider.
5. Consent and clear intent for wallet prompts, permanent publication, data
   disclosure, and payment.
6. Operator accountability without making an operator database the canonical
   source of protocol truth.

The following are explicitly not security assumptions:

- A wallet, browser extension, RPC, gateway, relay, storage provider, or indexer
  is honest merely because the flagship client selected it.
- A content identifier makes content safe.
- TLS makes content returned by a third party authentic.
- A database row is canonical protocol state.
- IPFS guarantees availability or deletion.
- A simulated Solana transaction invoking WokeNet is necessarily the transaction
  a wallet signs.
- A disposable Solana local-validator test proves public-cluster deployment,
  provider independence, production authority, or release readiness.
- Decentralization eliminates moderation, privacy, fraud, or availability risks.

## Scope

The security boundary includes:

- Browser and the non-release Seeker Android client foundation.
- Wallet adapters, passkey authenticators, delegated device keys, and recovery.
- WokeNet’s Solana programs, program upgrade authority,
  transaction construction, and sponsorship.
- Solana cluster/genesis selection, external RPC providers, commitment/finality
  handling, public deployment records, and program authority.
- Mobile Wallet Adapter intents and callbacks, Android permissions and local
  storage, package signing, updates, and distribution.
- Signed protocol manifests and versioned schemas.
- Indexer, relay, feed, moderation, media, and notification services.
- PostgreSQL projections, Redis caches/queues, and local development services.
- IPFS, Arweave-compatible, and local content storage adapters.
- Direct and group messaging, encrypted attachments, and message relays.
- Build, CI, release, deployment, telemetry, backup, and incident systems.
- Operator consoles, moderation evidence, and support workflows.

End-user device compromise, malicious wallet software, and compromise of an
external provider cannot be fully prevented by the platform. The product MUST
reduce their impact, make sensitive actions understandable, and provide
revocation and recovery paths.

## Trust boundaries

| Boundary | Trusted for | Never trusted for | Planned controls |
| --- | --- | --- | --- |
| User device and authenticator | User-approved signing and local decryption while uncompromised | Global policy, server authorization, or permanent key availability | Origin-bound passkeys, scoped delegated keys, secure local storage, explicit transaction summaries, revocation |
| Browser to public edge | Transport to the configured origin | Manifest or protocol authenticity | TLS, HSTS, CSP, signature/hash verification, strict origin policy |
| Public edge to application services | Authenticated service requests | Canonical protocol state | Service identity, authorization, schema validation, rate limits, trace correlation |
| Service to PostgreSQL/Redis | Projection storage and disposable coordination | Identity or social-graph authority | Least-privilege roles, parameterized queries, migrations, replayable projections |
| Client/service to Solana RPC | Transport of requests and observations | Correctness, completeness, ordering before finality, transaction intent, or proof of public deployment | Multiple RPCs, exact genesis/program binding, method capability checks, commitment policy, response validation, simulation comparison, reconciliation |
| Android app to wallet through Mobile Wallet Adapter | User-authorized wallet connection and signing handoff | Callback authenticity without validation, requested-account stability, transaction intent, or Seeker model claims | Explicit intents, package/association checks where supported, bounded callbacks, account/network revalidation, decoded transaction summary, lifecycle/adversarial tests |
| Client/service to content providers | Retrieval or publication of bytes | Byte integrity, availability, privacy, or deletion | Local hashing, CID/hash verification, encryption before upload, redundant providers |
| Client to indexer/feed/relay | Discovery and low-latency convenience | Signatures, authorization, finality, or durable message truth | Signed objects, reconciliation, replaceable endpoints, bounded caches |
| Operator control plane | Approved deployment and incident actions | User signing authority or plaintext user secrets | SSO/MFA, least privilege, audit logs, separation of duties, break-glass review |
| CI and artifact registry | Reproducible build and artifact distribution while uncompromised | Source authenticity without independent provenance checks | Pinned dependencies/actions, isolated runners, SBOM, signatures, protected environments |

See [THREAT_MODEL.md](./THREAT_MODEL.md) for data flows, threats, and residual
risks.

## Data classification and handling

| Class | Examples | Allowed locations | Required handling |
| --- | --- | --- | --- |
| Public protocol data | Program IDs, public keys, public follows, signed public manifests | Solana/WokeNet program state, content providers, public APIs, caches | Version, sign, hash, validate, and document permanence |
| Public but deletable-by-policy content | Ordinary post bodies and media | Deletion-capable providers and indexer projections by default | Explicit storage policy, tombstones, provider deletion requests, no permanence claim |
| Restricted content | Paid, private-community, or audience-limited content | Encrypted blobs and authorized client storage | Encrypt before upload; never colocate public decryption keys |
| Private communications | Message bodies, attachments, safety numbers | End-to-end encrypted envelopes and encrypted local storage | No server plaintext; minimize metadata; explicit report disclosure |
| Sensitive account data | Email recovery address, device inventory, session metadata | Purpose-specific service database | Encrypt at rest, narrow access, retention limit, never place onchain |
| Moderation evidence | Reporter-selected messages, doxxing evidence, legal requests | Segregated evidence store | Explicit consent, encryption, access logging, retention and legal review |
| Operator secrets | Deployment credentials, database passwords, sponsor keys, webhook secrets | Secret manager or protected local development store | Never commit or log; rotate; scope per service/environment |
| Prohibited public data | Private keys, auth secrets, private messages, IP addresses, device fingerprints, private precise location | Nowhere onchain or in public manifests | Reject at validation boundaries and redact from logs |

Production schemas MUST identify data classification, purpose, retention, deletion
behavior, and access roles. Telemetry MUST default to collecting operational
metadata rather than user content.

## Identity, session, and key security

The credential-bound WebAuthn-PRF account-key wrapper, exact-origin/RP
user-verifying ceremonies, durable one-time challenge/session service,
atomic credential/wrapper registration, same-root service-passkey list/add/revoke,
authentication/session issuance that is atomic against revocation,
current-epoch WokeNet delegation enforcement, and delayed guardian-threshold
recovery program are implemented and tested. Protocol-identity creation from
the browser, WokeNet delegation/device-authority inventory, email assistance,
recovery notifications/product UX, and sponsorship remain **Planned** unless
explicitly identified.

### Wallet and passkey authentication

- Wallet authentication MUST use a domain-bound, human-readable challenge with a
  nonce, issuance time, short expiry, requested scopes, and chain/network.
- A wallet signature MUST NOT be treated as authorization for an unrelated
  transaction.
- Passkeys MUST be WebAuthn credentials bound to the exact production RP ID and
  approved origins. Development and production credential namespaces MUST be
  separate.
- A WebAuthn assertion MUST NOT be presented as a WokeNet transaction or
  portable-object signature. A compatible PRF result may wrap a locally
  generated Ed25519 key as
  specified by
  [ADR-0006](DECISIONS/0006-passkey-account-key-boundary.md); the PRF result and
  plaintext key MUST remain client-side.
- PRF support is optional. An unsupported authenticator MUST lead to an explicit
  wallet or reviewed recovery-kit path, never silent server custody.
- Authentication challenges MUST be single-use and atomically consumed.
- Cookie sessions, if used, MUST be `Secure`, `HttpOnly`, `SameSite=Lax` or
  stricter, narrowly scoped, rotated after authentication, and protected against
  fixation.
- Bearer tokens MUST be short-lived and never stored in browser-readable
  persistent storage when a safer origin-bound mechanism is available.

### Delegated and device keys

- A delegation MUST bind identity, device public key, protocol version, allowed
  actions, audience, issuance time, expiry, and revocation reference.
- Clients MUST display delegation scope in plain language before signature.
- High-impact actions such as wallet linking, recovery changes, program upgrades,
  large payments, and durable key delegation MUST require the root authority or
  an explicitly authorized stronger factor.
- Device private keys MUST be non-exportable where platform APIs permit and
  encrypted at rest otherwise. The server MUST never receive them.
- Revocation MUST take effect in authorization checks even when a cached
  delegation has not expired.
- Device inventory MUST show last use, scope, creation time, and revocation state
  without exposing secret material.

### Recovery

The localnet program implements versioned guardian policies, delayed requests,
distinct threshold approvals, current-root cancellation, arbitrary execution
after delay, exact-target signing, root rotation, and epoch/sequence
invalidation. It deliberately retains terminal request accounts. The client,
indexer portability surface, notification channels, rate limiting, guardian
UX, email assistance, and independent review remain launch gates.

- Recovery enrollment MUST be opt-in and must not make email the protocol
  identity.
- Recovery MUST have a visible delay, user notification, cancellation path, and
  replay-resistant state transition.
- Guardian approval thresholds and recovery delays MUST be part of signed,
  versioned configuration.
- A recovery operation MUST revoke or explicitly preserve each existing device
  key; silent carryover is forbidden.
- Support personnel MUST not be able to bypass protocol authorization.

### Operator and program authority

- Production WokeNet program upgrade authority MUST be a publicly documented multisig with
  independent signers, hardware-backed keys, quorum, and a time-delayed review
  process.
- No application hot wallet may control production program upgrades or user
  funds.
- Sponsor keys MUST be isolated from upgrade, treasury, and deployment keys and
  limited by balance, rate, transaction shape, and network.
- Stable releases MUST document a path to revoke upgrade authority and make the
  program immutable when governance accepts that tradeoff.
- Key ceremonies, signer replacement, emergency rotation, and authority
  verification MUST have reproducible runbooks and independently retained
  evidence.

## Solana transaction, RPC, and WokeNet program security

The repository contains partial local implementation and tests. Public
deployment, production signing UX, independent review, and release evidence
remain **Planned**.

Before a wallet or sponsor signs, the client or service MUST:

1. Resolve the selected Solana cluster and exact expected genesis hash.
2. Verify every program ID against environment configuration.
3. Decode every supported instruction and reject unknown instructions by default.
4. Validate writable and signer accounts, PDA derivations, recipients, token
   programs/mints/accounts where applicable, amounts, fees, and authority
   relationships.
5. Present a stable, human-readable action and cost summary.
6. Simulate the exact compiled message that will be signed.
7. Compare simulation accounts, instructions, compute use, and balance changes
   against policy.
8. Reconfirm that the compiled message was not substituted before signature.
9. Use a fresh blockhash and explicit commitment/finality policy.
10. Record a non-sensitive correlation ID for reconciliation without logging
    signatures as authentication secrets.

Programs MUST use explicit PDA seed domains, account ownership checks, signer and
mutability constraints, checked arithmetic, bounded allocations, versioned
accounts, and replay/idempotency protections. Tests MUST cover account
substitution, duplicate initialization, unauthorized closure, overflow,
malformed input, wrong program IDs, stale delegations, and unsupported token
mints.

Community membership requires distinct authority paths. Join/leave must resolve
to the member identity's current root or current `community` delegation;
remove/ban must resolve to the creator identity's current root or current
`community` delegation and an existing different member. Clients and programs
must bind the exact community/member PDA, action/state/roles, signed
membership-v2 manifest, identity sequence, membership-state sequence,
membership-policy sequence, and community-wide membership sequence. `banned`
is terminal. A proposal must snapshot that community-wide sequence, and a vote
must prove the membership became active no later than the snapshot.

The public indexer must not turn those events into a roster. Exact-address
status is permitted only for verified open public/unlisted parents after a
covering finalized checkpoint, and it must omit member/actor identities, signer
authority, moderation reason, and manifest location. This is data
minimization, not chain secrecy.

The legacy lamport-denominated payment ABI is permanently quarantined. Clients,
sponsors, and release tooling MUST reject attempts to execute or unpause it, and
legacy accounts/events MUST never grant entitlements. Portable signed metadata
may truthfully describe `{ kind: "sol" }` or an exact SPL asset; it MUST reject
`{ kind: "woke" }`. Any future `$WOKE` path requires a reviewed SPL or
Token-2022 mint, a new mint-aware ABI, exact token-account constraints, explicit
migration, and independent audit.

Sponsored Solana transactions MUST enforce authenticated subject limits, IP/device
signals used only under the privacy policy, per-action budgets, idempotency keys,
transaction-shape allowlists, simulation, daily loss ceilings, and an emergency
disable switch. Sponsorship MUST remain optional and replaceable, pay only the
Solana transaction network fee, and reject the quarantined payment ABI.

Public WokeNet deployment evidence MUST additionally:

- publish the exact Solana cluster, observed genesis hash, program ID,
  deployment slot, program-data address, executable artifact hash, source
  revision, toolchain, and upgrade authority;
- reproduce the reviewed SBF artifact and verify it against deployed bytes;
- fail closed when configured RPC endpoints lack required submission,
  simulation, confirmation, history, or program-account methods;
- cross-check sensitive reads and finalized observations across independently
  administered Solana RPC providers; and
- rehearse RPC failover, blockhash expiry, priority-fee policy, provider
  disagreement, upgrade, rollback, and authority-compromise response.

The current repository has local-validator program and client evidence, but no
recorded devnet or mainnet-beta deployment evidence.

## Application and API controls

All items in this section are **Planned**.

- Validate untrusted input at every boundary with shared, versioned runtime
  schemas. Unknown fields MUST follow explicit forward-compatibility rules.
- Encode output for its destination. User-generated rich text MUST pass an
  allowlist sanitizer; scripts, event handlers, tracking pixels, unsafe URLs, and
  active embeds are forbidden.
- Use parameterized database queries. Dynamic identifiers require allowlists.
- Prevent SSRF with parsed URLs, scheme restrictions, DNS/IP validation,
  redirect revalidation, response-size/time limits, and egress restrictions.
- Filesystem paths MUST be generated by the service, normalized, confined to a
  dedicated root, and never derived directly from a CID or upload filename.

### Seeker Android and Mobile Wallet Adapter

The current Expo/React Native project is a non-release foundation with
read-only feed and verified community discovery. It has no membership
transaction action: identity selection, manifest signing, simulation, MWA
approval, finality, and indexer catch-up remain unconnected. Before an Android
release:

- wallet connect, authorize, sign, disconnect, cancellation, timeout, background
  and resume flows MUST be tested on the approved Seeker/device matrix;
- MWA intents, deep links, callbacks, selected accounts, cluster, program ID,
  transaction bytes, and post-return state MUST be strictly revalidated;
- the app MUST request the minimum Android permissions and keep seeds, private
  keys, wallet auth material, message plaintext, and sensitive recovery data out
  of logs, telemetry, backups, clipboard, and screenshots where controllable;
- package ID, app links, signing certificate, dependencies, native modules, and
  release artifact provenance MUST be reviewed;
- an installable APK MUST be reproducible, signed through controlled custody,
  independently verified, and covered by secure update and rollback procedures;
  and
- store submission or direct distribution requires explicit security, privacy,
  accessibility, legal, and release approval.

A model-name check or claimed Seeker device status is presentation metadata only
and MUST NOT grant value or privileges.
- Shell execution SHOULD be avoided. Where unavoidable, use fixed executables and
  argument arrays, never interpolation.
- Cookie-authenticated mutations MUST use origin checks and CSRF tokens where
  SameSite alone is insufficient.
- Authorization MUST be object- and action-specific and MUST be evaluated after
  authentication, not inferred from client UI state.
- Rate limits MUST exist at edge, account, device, action, and expensive-resource
  boundaries. Redis may coordinate limits but loss of Redis MUST fail safely for
  sensitive actions.
- Errors returned to clients MUST be stable and useful without exposing secrets,
  stack traces, SQL, internal paths, or private moderation data.

The web application MUST adopt a nonce- or hash-based Content Security Policy,
frame protection, MIME sniffing protection, a restrictive permissions policy,
referrer policy, secure cross-origin rules, and HSTS after every production
subdomain is HTTPS-ready. CSP rollout MUST begin in report-only mode and be
verified before enforcement; broad `unsafe-inline` or `unsafe-eval` exceptions
are launch blockers.

## Content, media, and storage security

Canonical object/storage controls and a hardened media-worker subset are
implemented and tested. The worker performs exact offset/chunk/source hashing,
strict MIME/container/decode validation, symlink/hard-link defenses, bounded
metadata-free processing, unsigned content-addressed publication, and
client-independent preprocessed publication. Its production composition
requires a private patched ClamAV daemon, strong static operator credential,
fresh database provenance, unprivileged/read-only containers, and an
unpublished scanner port. Browser integration, multi-user authorization,
stronger codec isolation, production replication, and external review remain
open.

- Canonical serialization, signature verification, author/delegation validation,
  and content hashing MUST precede indexing or display.
- Content fetched from any gateway MUST be hashed locally and rejected if it
  differs from the signed manifest.
- Gateway HTML and SVG MUST never execute in the application origin.
- Upload handling MUST enforce byte limits while streaming, detect actual file
  type, reject polyglots where practical, strip image metadata, and quarantine
  files until malware and media processing complete.
- Derived media MUST retain a verifiable relationship to the source manifest.
- Media processors MUST run without cloud metadata access, operator secrets, or
  unnecessary network/file privileges.
- Clamd targets MUST resolve only to loopback, RFC 1918, or IPv6 ULA addresses;
  public and link-local addresses are rejected. The unauthenticated clamd TCP
  port MUST remain unpublished and isolated from unrelated workloads.
- Readiness and scan receipts MUST verify bounded `VERSION` data, enforce the
  configured maximum signature-database age, and identify adapter, engine,
  database version, and database timestamp without exposing malware signature
  names.
- Publication to permanent storage MUST require a distinct informed-consent step.
- Restricted content MUST be encrypted on the client before storage publication.
- Provider replication status MUST distinguish “submitted,” “verified,”
  “replicated,” “degraded,” and “unavailable.”
- Deletion MUST create a signed tombstone, remove content from official clients
  and projections, and attempt provider deletion without promising erasure from
  third-party or permanent copies.

## Private messaging

The relay transport portion is implemented with signed envelopes, bounded
retention/replay state, fail-closed key authorization, metadata-safe logs, and
real-loopback tests. The pairwise-only adapter selected by ADR-0007 now
delegates actual Olm ratchets, signatures, key agreement, and authenticated
encryption to pinned Apache-2.0 Matrix Rust crypto WASM. Its 13 independent
two-device cases cover current WokeSocial device binding,
encryption/decryption, replay/corruption/wrong-device rejection,
revocation/rotation, fixed errors, plaintext absence from directory/relay
artifacts, canonical sender-device signatures before stateful Olm processing,
honest-copy survival after relay metadata mutation, local-device revocation,
bounded/cancellable resolver and directory calls, malformed-Unicode rejection,
plaintext-copy zeroization, private construction, and fail-closed production
storage gating. The adapter exposes no room/group API. Production encrypted
persistence, browser WASM/CSP packaging, durable replay state, pre-key
retransmission, attachments, safety UX, deployed relay integration, and
independent review remain **Planned**.

- WokeSocial MUST use a maintained, independently reviewed messaging protocol
  and library; custom cryptographic constructions are forbidden.
- One-to-one production messaging requires authenticated device keys, forward
  secrecy where supported, replay protection, key rotation, safety-number UX,
  attachment encryption, and device revocation.
- Group messaging MUST remain disabled or clearly experimental until its protocol
  has independent review, interoperability vectors, and device-membership tests.
- Servers MUST handle only encrypted envelopes and the minimum routing metadata.
- Push notifications MUST not include message plaintext.
- A reporter may explicitly disclose selected decrypted messages; no hidden
  server-side decryption path may exist.
- Metadata that remains visible to relays and operators MUST be listed in the
  privacy and protocol documentation.

## Infrastructure, secrets, and service identity

Digest-pinned local infrastructure and hardened optional service profiles are
implemented; production secret injection, TLS, resource sizing, image signing,
SBOM/provenance, backup/restore, and provider deployment remain **Planned**.

- Separate disposable localnet, Solana devnet, staging, mainnet-beta, Android
  signing, and distribution credentials and data. Production credentials MUST
  never be available to pull-request jobs.
- Inject secrets at runtime from a provider-neutral secret interface. `.env`
  files are for local development only, ignored by Git, permission-restricted,
  and populated from documented placeholders.
- Use a distinct least-privilege database role and service identity for each
  workload. Migration roles MUST not be used by runtime services.
- Encrypt service traffic across untrusted networks and authenticate service
  identities.
- Deny public access to PostgreSQL, Redis, administrative endpoints, queues,
  telemetry collectors, and object storage control APIs.
- Restrict outbound traffic for workers that parse media or fetch URLs.
- Protect administrative actions with phishing-resistant MFA, role separation,
  just-in-time elevation, and immutable audit events.
- Backups MUST be encrypted with separately managed keys and regularly restored.
- Logs MUST redact credentials, authorization headers, cookies, private keys,
  seed phrases, message plaintext, recovery data, and private moderation
  evidence.

## Build and supply-chain security

All items in this section are **Planned**.

- Pin Node, pnpm, Rust, Anchor, Solana client/build tools, Android/Kotlin/Expo
  tooling and native modules, container bases, CI actions, and all package
  dependencies to reviewed compatible versions.
- Commit lockfiles and enforce frozen installs in CI.
- CI action references and base images MUST use immutable commit or digest pins.
- Pull-request workflows MUST not receive production secrets or broad write
  tokens. Workflow permissions MUST default to read-only.
- Run TypeScript lint/type checks/tests, Rust formatting/Clippy/tests, Anchor
  tests, secret scanning, dependency review, license policy, container scanning,
  and code scanning before release.
- Generate an SBOM and provenance for release artifacts. Sign immutable artifacts
  where the selected registry supports verification.
- WokeNet releases MUST use reproducible/verifiable social-program builds and
  publish source revisions, toolchains, SBF hashes, Solana genesis/program
  identifiers, deployment slot, program-data address, and authorities.
- WokeSocial Android releases MUST publish source revision, dependency lock,
  build environment, package ID, version, APK hash, signing-certificate digest,
  reproducibility result, and distribution channel.
- Dependency updates MUST be reviewed for install scripts, maintainer changes,
  transitive risk, protocol compatibility, and cryptographic impact.

## Logging, detection, and privacy

All items in this section are **Planned**.

Security telemetry SHOULD include:

- Authentication challenge failures and replay attempts.
- Delegation issuance, use outside scope, expiry, and revocation.
- Recovery start, approval, cancellation, and completion.
- Sponsor denials, budget use, transaction-shape mismatch, and loss ceilings.
- Program authority changes and deployed binary hashes.
- Indexer signature/hash failures, checkpoint divergence, and replay progress.
- Storage hash mismatches and provider availability.
- Administrative and moderation evidence access.
- Secret-scan, dependency, artifact-signature, and image-scan failures.

Events MUST use pseudonymous identifiers where possible, have a documented
retention period, be access-controlled, and avoid user content. Alert payloads
sent to third parties MUST not contain private content or credentials.

## Verification and release gates

No row is satisfied until evidence is linked from a release report.

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Source and dependency integrity | Frozen clean install, lockfile review, secret/dependency/code scans, SBOM | Partial: frozen install, exact patched overrides, a no-known-vulnerability audit result, and pinned CI/Gitleaks workflows exist; SBOM/release provenance and complete scan evidence remain |
| Web/API security | Header test, CSP report review, authz/CSRF/SSRF/XSS/SQLi tests, rate-limit tests | Partial: read-only indexer rate limiting and basic headers exist; the full adversarial/CSP suite does not |
| WokeNet program and deployment security | Formatting, Clippy, unit and Solana local-validator tests, reproducible SBF artifact, deployed-byte/authority verification, devnet rehearsal, independent audit findings resolved | Partial: SBF/local-validator evidence exists; no devnet/mainnet-beta deployment, verifiable public release, production authority, or independent audit exists |
| Transaction safety | Golden instruction decodes, substitution tests, simulation comparison tests, wallet/MWA UX review | Partial: exact account/data tests, substitution/allocation/replay tests, exact-byte version-0/legacy compilation, detached-signature verification, bounded strict RPC simulation/status parsing, fee and balance reconciliation, same-byte broadcast/rebroadcast, finalized transaction confirmation, and finalized-account proof validation exist; flagship signer flows, MWA transaction-intent testing, executable-artifact attestation, future mint-aware receipt/entitlement orchestration, and sponsorship policy remain open |
| Seeker Android release | Device matrix, intent/deep-link/callback tests, permission/privacy review, reproducible signed APK, signing provenance, update/rollback drill, store review | Partial foundation only: Expo/React Native source, MWA connection boundary, deployment checks, read-only feed, and unit tests exist; release evidence does not |
| Identity and recovery | WebAuthn origin tests, nonce/replay tests, delegation/revocation/recovery abuse tests | Partial: real browser WebAuthn, durable challenges/sessions, delegation epochs, and delayed guardian recovery adversarial paths pass; protocol onboarding, email/notification UX, full device lifecycle, and review remain |
| Content integrity | Canonical vectors, signature/hash/CID substitution tests, gateway failover tests | Partial: TypeScript canonical/signature/hash/CID and storage corruption tests pass; shared vectors and comprehensive failover do not |
| Messaging | Published protocol/library, interoperability vectors, device/replay/revocation tests, independent review | Partial: pinned real-WASM pairwise adapter and 13 envelope/device/replay/revocation/non-disclosure cases pass; persistent browser/relay interoperability and independent review remain |
| Infrastructure | Least-privilege review, restore drill, failover exercise, TLS and exposure scan | Partial local foundation: digest-pinned unprivileged/read-only service images, health/readiness, private ClamAV networking, and no-published-port checks pass; production review/drills/TLS/scans absent |
| Operations | Incident tabletop, key-compromise exercise, on-call and escalation verification | Planned |

The repository defines pinned commands for install, format, lint, type checks,
unit/build, container integration, browser, and local-validator checks. CI
workflows configure dependency review, audit, CodeQL, and secret scanning.
Container image scanning, SBOM/provenance, and a unified clean release-security
report remain requirements rather than completed checks.

## Vulnerability handling

A production launch requires:

- A private reporting address and published `security.txt`.
- Acknowledgement, triage, remediation, disclosure, and CVE assignment targets.
- A safe-harbor policy reviewed by counsel.
- An emergency contact path for active exploitation.
- A release process for supported versions and operator advisories.
- A public record of material program authority or protocol security incidents.

Reports containing user data or exploit material MUST use an encrypted channel
and receive access-limited handling. Vulnerability reporters MUST not be asked to
post sensitive evidence in public issues.

## Unverified launch blockers

The following remain explicit blockers until implementation and evidence exist:

- No clean independent-machine release attestation, SBOM, signed artifacts,
  verifiable social-program deployment, or reproducible signed Android release.
- No WokeNet program deployment is recorded on Solana devnet or mainnet-beta;
  public deployed-byte, authority, provider-diversity, failover, and incident
  evidence is absent.
- The latest available Node 22.23.1 pin is awaiting the announced HIGH-severity
  patched 22.x release; production image publication is blocked until rotation.
- CI/security workflows exist, but complete scan artifacts and release
  provenance have not been recorded.
- Browser service sessions, scoped delegations, rotation, revocation, and
  delayed guardian recovery subsets exist; protocol onboarding, complete
  device/email recovery UX, wider authorization, replacement mint-aware payment
  instructions, and a
  production authority model remain absent.
- The SDK has exact-byte version-0/legacy transaction compilation, strict RPC
  simulation/status decoding, detached-signature verification, fee/balance
  reconciliation, same-byte broadcast/rebroadcast, finalized transaction
  confirmation, and injected finalized-account proof validation. A complete
  generated account client, flagship wallet/passkey signer integration,
  executable-artifact attestation, future mint-aware receipt/entitlement proof
  orchestration, sponsor policy, and wallet/MWA signing UX remain absent. The
  legacy payment ABI remains permanently non-entitling.
- Manifest/storage integrity and a hardened media-worker/ClamAV subset exist;
  shared cross-language vectors, production storage orchestration, and stronger
  codec sandbox evidence remain absent.
- Pairwise encryption is implemented with real Matrix Rust crypto WASM but is
  not independently reviewed or production-integrated and has no persistent
  encrypted browser state.
- Basic read-only indexer headers, runtime query validation, and rate limiting
  exist locally; production deployment, authentication/authorization, and a
  focused adversarial API suite are absent.
- No production authority multisig, key ceremony, incident drill, or restore
  drill.
- The Android foundation has no verified Seeker-device run, reproducible signed
  APK, signing provenance, secure update/rollback evidence, store submission, or
  publication.
- No independent security audit.

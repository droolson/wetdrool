# WokeSocial Privacy and Data Lifecycle

**Status:** Planning baseline requiring qualified legal review  
**Last updated:** 2026-07-28

## 1. Scope and status

This document specifies privacy requirements for the protocol, flagship client, operated services, and local development environment. It is technical implementation support, not legal advice or a claim of GDPR, CCPA, COPPA, or other regulatory compliance.

The sovereign runtime is WokeNet, a protocol forked from Solana. Native
validator and RPC operation is Firedancer only and remains **Experimental**;
the Agave/Solana local harness is compatibility-oracle evidence, not native or
production evidence, and production activation remains blocked. The native
asset is WOKE with 9 decimals. `lamports` may remain only as the
Solana-compatible wire/base-unit identifier
(`1 WOKE = 1,000,000,000 lamports`). The canonical public origin is
`https://woke.social`; `sociallywoke.com` is redirect-only and must not receive
application data, authentication cookies, recovery links, or an independent
identity namespace.

Most user-facing privacy controls remain **Planned**. The implemented foundation
keeps post bodies offchain, models visibility for optional pronoun and gender
fields, requires explicit permanent-storage consent, keeps passkey PRF output
and signing seeds client-side, synchronizes only encrypted key wrappers,
implements delayed guardian recovery without email/PII onchain, and provides an
experimental pairwise encryption adapter with no server plaintext path. The
media worker strips metadata in managed profiles, publishes unsigned output,
and minimizes scanner evidence. Local analytics remain disabled.
These narrow technical choices are not privacy-law compliance evidence.
Production operators must publish their actual purposes, providers,
jurisdictions, retention periods, contacts, and lawful bases after qualified
legal review.

## 2. Privacy principles

1. Collect the minimum data needed for a named user function.
2. Keep sensitive personal information and secrets offchain.
3. Encrypt private or restricted content before it leaves the client.
4. Do not treat pseudonymous wallet or device identifiers as anonymous.
5. Do not infer protected identity traits.
6. Make analytics opt-in and development analytics off by default.
7. Separate protocol-canonical public state from replaceable service projections.
8. Give people usable export, revocation, deactivation, deletion-request, and provider-migration controls.
9. Explain immutable and replicated storage limits before publication, not only after deletion.
10. Do not send private content to third-party AI services by default.
11. Prevent logs, traces, crash reports, and support tools from becoming shadow identity databases.
12. Record evidence before describing a privacy control as implemented.

## 3. Data classes

| Class | Examples | Default treatment |
|---|---|---|
| Public protocol data | Identity root, public keys, public references, content hashes, public relationships intentionally selected for protocol publication | Public and durable; minimize fields and disclose permanence |
| Public signed content | Public profile and post manifests, author-selected media metadata | Content-addressed and verifiable; deletion-compatible storage by default |
| Restricted signed content | Private-community, paid, limited-audience content | Encrypt before storage; public references reveal no plaintext or key |
| End-to-end encrypted content | Direct/group messages and attachments | Ciphertext only outside authorized devices |
| Sensitive service data | Recovery email, account-support records, abuse evidence, provider billing identifiers | Offchain, encrypted, access-controlled, purpose-limited |
| Ephemeral coordination | Presence, typing, rate-limit keys, short-lived relay state | Short TTL; not canonical; no behavioral history by default |
| Local-only data | Unpublished drafts, local preferences, decrypted cache, device key material | Device protection; user-deletable; excluded from telemetry |
| Operator telemetry | Health metrics, structured logs, consented product analytics | Minimized, redacted, bounded retention, never authoritative |

Combining public fields can still create sensitive inferences. Indexers and clients must avoid building protected-trait profiles merely because source objects are public.

## 4. Data forbidden onchain

The following must never be placed in WokeNet accounts, instructions,
transaction memos, or public program events. Solana-format compatibility
fixtures must enforce the same prohibition:

- Email addresses
- Phone numbers
- IP addresses
- Legal names unless the person deliberately publishes one as public content
- Precise private locations
- Private-message plaintext or decryption keys
- Authentication secrets, passkey private material, session keys, or recovery secrets
- Device fingerprints
- Moderation evidence containing sensitive personal information
- Private profile fields
- Analytics identifiers
- Provider credentials

Client-side and service-side validation must reject forbidden fields before transaction construction. A warning is insufficient.

## 5. Data placement requirements

### 5.1 Onchain

Onchain state is limited to compact, high-value, verifiable protocol state and references. Even when a field is technically public elsewhere, it must not be placed onchain unless public durability is necessary for the protocol function.

Onchain deletion means revocation, closure where safe, or a tombstone; it cannot guarantee historical erasure from validators, explorers, archives, or transaction logs.

### 5.2 Public content storage

Public content uses signed, versioned manifests and content hashes. Ordinary posts use a provider policy compatible with deletion requests by default. IPFS is described as content addressing, not automatic permanence or automatic deletion.

Gateways must verify the expected hash or CID. A gateway response is untrusted until verified.

### 5.3 Permanent storage

Arweave or another intentionally permanent provider is opt-in per publication. Consent must be separate, informed, versioned, and recorded. The user must be able to publish through a deletion-compatible path instead.

Permanent storage must not be used by default for:

- Stories or expiring posts
- Private or restricted content
- Paid content plaintext
- Recovery or authentication data
- Moderation evidence
- Drafts
- Precise location

### 5.4 Private and restricted storage

Private-community, limited-audience, paid, and message content is encrypted before upload. Keys are distributed separately to authorized identities or devices. Content addressing proves bytes; it does not grant authorization.

Key destruction may reduce future access but cannot recall plaintext, screenshots, exports, recipient key copies, or previously decrypted caches.

### 5.5 Indexer projections

An indexer database is a replaceable projection, not canonical protocol truth. It may store:

- Verified public manifests and derived search/feed fields
- Current tombstone and revocation state
- Service-scoped moderation treatments
- Minimal operational checkpoints and validation errors

It must not silently convert private preferences, recovery data, or message content into public projections.

The implemented `public-match-v1` search projection is limited to current public display
names/bios, active handles, and verified posts whose visibility is `public`. Unlisted/restricted
posts and tombstoned posts are excluded in both memory and PostgreSQL implementations. Anchored
community references are also excluded until the indexer can verify a signed public-visibility
manifest. Canonical queries contain 3–120 normalized Unicode code points. The web client warns
that a query is transmitted to the selected indexer and retained in the URL; operators must
disclose and bound any reverse-proxy/application query logging before public use.

## 6. Identity and account privacy

### 6.1 Public identity

- A human-readable handle is distinct from a wallet address.
- Wallet addresses are not the default profile label.
- Chosen name is independent of legal name.
- Gender, sexuality, and pronouns are optional; visibility is explicit and enforced at the data layer.
- Multiple pronoun sets and custom localized forms are supported.
- No identity field is inferred from appearance, name, network, device, social graph, or content.
- Public identity does not imply legal-name verification.

### 6.2 Passkeys and delegated keys

- Passkey private material remains in the authenticator.
- The replaceable WebAuthn service stores public credential metadata,
  one-time ceremony/session records, and encrypted key wrappers; it never
  receives PRF output or a plaintext Ed25519 seed.
- Service-account IDs and credential metadata remain pseudonymous personal data
  subject to bounded retention, access control, export, and deletion policy.
- Any embedded WokeNet signing-key design must document custody,
  extraction resistance, backup, recovery, and device compromise. Agave/Solana
  compatibility tooling must never become a production custodian.
- Delegated session keys are device-bound, least-privileged, expiring, and revocable.
- Private keys and secrets never enter logs, analytics, crash reports, support tools, or ordinary database columns.
- Connected-device views show creation, last use at a suitably coarse level, scope, and revocation state.

### 6.3 Email-assisted recovery

Email assists recovery but is not the protocol identity.

- Email is encrypted at rest and access-controlled.
- It is never public, onchain, or included in a content manifest.
- Recovery communications do not reveal sensitive profile attributes in subject lines or lock-screen previews.
- Recovery has a delay and cancellation path.
- Removing email-assisted recovery schedules deletion of the recovery address unless another disclosed obligation requires temporary retention.
- Production retention and provider handling require qualified legal review and operator disclosure.

### 6.4 Current and historical names

Current-profile, mention, notification, and official search views use the current chosen name. Obsolete names are removed from current search projections and caches after a verified update.

Signed historical revisions may remain independently retrievable. The official client must not surface obsolete identity data in ordinary views. If a person intentionally opens history, a historical-data warning appears before the older value.

## 7. Messaging privacy

### 7.1 Content

The experimental pairwise adapter uses the pinned Matrix Rust crypto WASM Olm
engine, authenticates sender-signed outer envelopes before state mutation, and
passes 13 real independent-device non-disclosure and adversarial tests.
It has only volatile test/development state, no production browser persistence,
no deployed relay integration, and no attachment/reporting product. It must
remain disabled for production messaging. Group messaging stays
**Experimental** and no room/group API is exposed. Plaintext server fallback is
prohibited.

Relay, indexer, database, monitoring, and moderator tooling must not have message plaintext or conversation keys.

### 7.2 Metadata

End-to-end encryption does not hide all metadata. Depending on the chosen relay and transport, the following may remain visible:

- Relay connection IP address
- Approximate connection time and duration
- Envelope size
- Sender or recipient routing pseudonyms
- Device count
- Delivery and retry timing
- Abuse/rate-limit signals

Before messaging is enabled, the product must publish the exact metadata retained by each configured relay and its retention. Presence and typing are optional, ephemeral, and disabled by user choice.

### 7.3 Abuse reports

A reporter may voluntarily disclose selected messages. The interface previews exact plaintext, attachments, participants, timestamps, and metadata to be shared. Unselected conversation history is excluded.

The disclosed evidence becomes restricted moderation data, not public content. Its retention follows the reviewed moderation-evidence schedule.

## 8. Analytics, cookies, and telemetry

### 8.1 Analytics

- Product analytics are opt-in.
- Analytics are disabled by default in development and test.
- Refusal does not disable essential product functions.
- Consent is purpose-specific and reversible.
- Revocation stops future collection and triggers deletion of linkable analytics data where technically and legally possible.
- Analytics never include private messages, drafts, recovery data, full wallet addresses, precise location, protected identity fields, raw content bodies, or moderator evidence.
- Protected traits are not inferred for segmentation.

### 8.2 Cookies and local storage

The product distinguishes:

- Essential security/session storage
- Preference storage
- Optional analytics storage
- Third-party embedded-provider storage

Optional storage is disabled until consent. The preference center lists purpose, provider, duration, and revocation effect.

### 8.3 Logs, traces, and errors

Structured logging and OpenTelemetry-compatible instrumentation must:

- Use pseudonymous request or trace identifiers.
- Redact authorization headers, cookies, keys, signatures where sensitive, email, private content, and full request bodies.
- Avoid full wallet addresses unless a security event explicitly requires them; use scoped hashing or truncation where possible.
- Apply bounded retention and least-privilege access.
- Prevent error tracking from automatically attaching DOM content or form values.
- Include automated redaction tests.

## 9. Data inventory and default retention requirements

The values below are planned privacy-protective defaults, not a legal determination. Production deviations require a documented purpose, approved review, and updated user notice.

| Data | Planned default | Deletion or expiry behavior |
|---|---|---|
| Onchain identity/reference data | Network lifetime | Revoke or tombstone; historical network copies may remain |
| Deletion-compatible public manifest | While published | Official suppression on tombstone; provider deletion request |
| Intentionally permanent manifest | Permanent by design | Tombstone and official suppression only; original bytes may persist |
| Indexer public projection | While valid and discoverable | Remove from active/search/cache projection after tombstone |
| Relay presence/typing | At most 5 minutes | TTL expiry; no history |
| Undelivered encrypted message envelope | At most 30 days by default | Delete on delivery acknowledgement or TTL |
| Delivered relay envelope | At most 24 hours after acknowledgement | Automatic deletion |
| Rate-limit and anti-abuse counters | 24 hours normally; up to 30 days for substantiated abuse defense | TTL or reviewed case retention |
| Security/operational logs | 30 days by default | Automatic deletion; longer incident hold requires approval |
| Consented product analytics | 90 days at event level by default | Aggregate or delete; consent revocation request supported |
| Recovery email | While recovery is enabled | Delete after removal plus a short documented safety delay |
| Local drafts | Until user deletes or configured local expiry | Immediate local deletion and cache purge |
| Moderation report | Through decision and appeal window | Default 365 days after closure, then delete or de-identify |
| Restricted child-safety/legal evidence | Jurisdiction-specific | Separate reviewed schedule and legal hold controls |
| Backups of replaceable projections | 30 days by default | Rotation; tombstones replayed before restore becomes active |

Retention configuration must be testable. “Indefinite” is not an acceptable default for service-private data.

## 10. Publication consent and audience

Before publication, the user sees:

- Audience and discoverability
- Content and media included
- Identity and signing key used
- Storage providers
- Whether the provider is deletion-compatible or intentionally permanent
- Public metadata such as timestamp, language, replies, content warnings, and accessibility fields
- Onchain action and fee or sponsorship
- Native WOKE amount where applicable, shown with fixed 9-decimal semantics;
  interfaces may expose `lamports` only as a clearly labeled technical base unit
- Edit and deletion limitations

Audience controls are signed into the appropriate manifest. A visual-only audience control that uploads plaintext publicly is forbidden.

## 11. Stories, events, location, and media

### 11.1 Stories

Stories default to deletion-compatible storage with an explicit expiry. Official clients and indexers stop delivery and discovery at expiry. The product explains that recipients, providers, or third-party archives may retain copies.

### 11.2 Events and location

- Precise private location is never onchain.
- Event creators choose public, approximate, attendee-only encrypted, or external-location disclosure.
- Location previews show the audience before publication.
- Image location metadata is stripped by default.
- Attendance and paid-ticket records are not presented as private if protocol or payment records expose them.

### 11.3 Media processing

- Client computes a pre-upload hash.
- Metadata stripping occurs before public publication.
- Workers use short-lived, least-privilege access.
- Temporary plaintext processing copies have a bounded TTL and are deleted after successful processing or failure.
- Malware-scanning hooks receive the minimum required data.
- Processed output hash is verified by the client or independent verifier.

The implemented worker verifies chunk and complete-source hashes, accepts only
bounded allowlisted media, and produces metadata-free managed derivatives or
validates an explicit preprocessed assertion. Its packaged local authorization
represents one process-local operator and sees raw upload bytes, declared
accessibility metadata, timing, size, and type. ClamAV receives only the streamed
file, not a user identity or worker path; published scan evidence includes
engine/database provenance but removes malware signature names. A client must
still sign the returned manifest and independently verify output receipts.

## 12. Deactivation, deletion, and immutable-storage reality

### 12.1 Deactivation

Deactivation is reversible and suppresses the profile and content from official discovery without revoking identity keys or publishing an irreversible tombstone. The interface explains ongoing protocol visibility.

### 12.2 Account deletion flow

**PRIV-DEL-001 — Planned.** The deletion flow must:

1. Authenticate with a current trusted method.
2. Preview affected identities, devices, keys, content, communities, subscriptions, drafts, and provider copies.
3. Distinguish reversible deactivation from deletion.
4. Cancel active delegated keys and sessions.
5. Stop optional analytics and notification delivery.
6. Delete local drafts and eligible decrypted caches.
7. Publish required revocations and tombstones.
8. Suppress content in official client, indexer, feeds, search, and caches after tombstone ingestion.
9. Send deletion requests to configured deletion-capable storage providers.
10. Request deletion of service-private recovery and support data, subject to disclosed holds.
11. Produce a receipt listing completed, queued, failed, impossible, and third-party-controlled actions.
12. Provide retry for failed provider requests without republishing content.

### 12.3 What deletion cannot guarantee

The product must state plainly that deletion cannot guarantee removal from:

- WokeNet transaction history, account history, archives, or explorers,
  including copies exported through Solana-compatible tooling
- Arweave or another intentionally permanent store
- IPFS nodes or gateways outside operator control
- Independent indexers, relays, clients, scrapers, or archives
- Recipient devices, screenshots, downloads, or backups
- Previously disclosed moderation or legal evidence under a valid hold

Official suppression and tombstones remain meaningful: compliant clients stop serving the material, current views respect revocation, hashes can be marked deleted, and deletion-capable providers can remove controlled copies.

### 12.4 Restore and backup behavior

Restoring an indexer or cache from backup must replay tombstones and revocations before it serves traffic. Deleted material must not reappear because an older projection was restored.

## 13. Data export and portability

**PRIV-EXP-001 — Planned.** A person can export:

- Identity and public-key references
- Current and historical profile manifests with warnings
- Authored public content and tombstones
- Social relationships according to their privacy classification
- Community configuration and memberships where authorized
- Local/private preferences in an encrypted user-controlled package
- Message ciphertext and locally available plaintext only after strong reauthentication
- Provider configuration
- Moderation actions and appeals involving the person, with third-party data minimized
- Creator transaction and entitlement records

The export is versioned, machine-readable, documented, and integrity-verifiable. It does not expose another person’s private information merely because they interacted with the exporter.

Migration to another client or indexer must not require the flagship company’s proprietary API.

## 14. Age gating and minors

Age-gating architecture must minimize collection. Exact birth date must not be onchain. Production choices about minimum age, age assurance, parental consent, retention, and jurisdiction require qualified legal and child-safety review.

The product must not use appearance-based age estimation as a default identity control. Any external age-assurance provider requires a data-flow disclosure, a replaceability assessment, and a documented deletion path.

## 15. Regional processing and providers

Production documentation must identify:

- Service entity and contact
- Processing purposes and categories
- Storage, relay, analytics, support, email, RPC, and media providers
- Processing and backup regions
- Cross-border transfer mechanisms where applicable
- Subprocessor change process
- Retention deviations
- Data-request process
- Incident notification procedure

Regional configuration cannot change protocol truth silently. A service may decline to process content under applicable law while identifying that as service-scoped treatment.

## 16. Security and access controls for personal data

Required safeguards include:

- Encryption in transit and at rest for service-private data
- End-to-end encryption for message content
- Least-privilege service and moderator roles
- Strong authentication for sensitive exports and deletion
- Secret management outside source control
- Key rotation and compromised-device revocation
- Rate limiting and abuse monitoring
- Auditable access to recovery data and restricted moderation evidence
- Input validation, safe URL handling, output encoding, and secure headers
- Backups with tested deletion/tombstone replay
- Incident-response and breach-assessment procedures

Security controls are specified in separate security and threat-model documents; this section defines their privacy outcomes.

## 17. User-facing disclosures

Disclosures must use plain language and appear at the decision point:

- Wallet or passkey custody and recovery
- Public identity and social-graph visibility
- Permanent-storage consent
- Story expiry limits
- Paid/private-content copy risks
- Message metadata
- Third-party feed data sharing
- Analytics and cookies
- Alternate provider trust
- Account deletion limits

Consent is not valid when bundled, preselected, coerced through loss of an equivalent deletion-compatible feature, or contradicted by actual behavior.

## 18. Verification requirements

The privacy model remains **Planned** until all applicable checks pass.

### 18.1 Automated acceptance criteria

- **PRIV-TST-001:** Forbidden personal-data fixtures are rejected before WokeNet
  transaction construction in both native Firedancer and explicitly
  labeled Solana-format compatibility paths.
- **PRIV-TST-002:** Logs, traces, analytics, and error reports contain no seeded secrets, emails, message plaintext, or private profile fields.
- **PRIV-TST-003:** Pronoun and identity-attribute visibility is enforced by API and indexer queries.
- **PRIV-TST-004:** Permanent publication cannot proceed without item-specific recorded consent.
- **PRIV-TST-005:** Stories select deletion-compatible storage by default and stop official delivery at expiry.
- **PRIV-TST-006:** Restricted and paid storage returns ciphertext to an unauthorized fetch.
- **PRIV-TST-007:** Relay and database inspection cannot recover E2EE message plaintext.
- **PRIV-TST-008:** Tombstones remove content from official feed, search, cache, and indexer views.
- **PRIV-TST-009:** Restoring an old projection does not resurrect tombstoned content.
- **PRIV-TST-010:** Removing recovery email removes it after the configured reviewed delay.
- **PRIV-TST-011:** Consent withdrawal stops new analytics collection and starts the documented deletion flow.
- **PRIV-TST-012:** Export omits unrelated third-party private data and verifies package integrity.
- **PRIV-TST-013:** Message-report preview and submission contain exactly the selected evidence.
- **PRIV-TST-014:** Retention jobs expire presence, envelopes, logs, analytics, and backups according to configuration.
- **PRIV-TST-015:** Media metadata stripping removes seeded private location fields.

### 18.2 Reproducible manual acceptance

- A person can understand the difference between deactivation, tombstone, provider deletion, key destruction, and impossible erasure.
- A person can decline permanent storage and still publish through a deletion-compatible path.
- A person can inspect and revoke each device and delegated key.
- A person can export and migrate their identity without a proprietary API.
- A privacy reviewer can trace each service-private data class to purpose, storage, access, retention, and deletion.
- A keyboard-only user can manage consent, export, deactivation, and deletion.

## 19. External review and launch blockers

Production launch requires:

- Qualified privacy and product counsel review for actual operating regions.
- Child-safety specialist and legal review of age gating and evidence handling.
- A complete production data inventory and data-processing map.
- Named subprocessors, regions, contacts, and retention configuration.
- Verified user-request, deletion, export, consent, and incident procedures.
- Security review of passkey custody, recovery, E2EE, storage encryption, and operator access.
- No unresolved high-severity personal-data exposure.

Until those conditions and technical verification pass, privacy features must not be described as production-compliant.

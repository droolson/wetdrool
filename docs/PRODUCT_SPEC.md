# WokeSocial Product Specification

**Status:** Product requirements baseline; implementation subsets tracked separately  
**Last updated:** 2026-07-28  
**Primary domain:** `woke.social` (`sociallywoke.com` is redirect-only)

## 1. Status and evidence policy

This document defines intended product behavior. It is not evidence that the behavior exists.

At the time this baseline was written, the repository contained no application
implementation, protocol implementation, tests, or deployment configuration.
The repository now has verified local foundation and experimental
protocol/storage/indexer/web subsets. None of those narrow subsets satisfies a
complete product requirement here unless its full acceptance criteria pass.
[`../TASKS.md`](../TASKS.md) is the current evidence record.

The following status terms are normative:

- **Planned:** Required, but no implementation evidence has been recorded.
- **Experimental:** Implemented behind an explicit feature flag, with known unmet production gates.
- **Implemented, unverified:** Code exists, but the required automated test or reproducible manual check has not passed.
- **Verified:** The implementation and its required checks pass in a clean environment.
- **Externally blocked:** Repository work is complete, but a named credential, provider, audit, legal review, DNS change, or funded deployment is still required.

Documentation, screenshots, mock data, disabled controls, and successful API-shaped responses are not implementation evidence. A feature may be marked **Verified** only when its acceptance criteria pass against the real implementation tier named by the test.

## 2. Product vision

WokeSocial is a polished, inclusive, LGBTQ+ affirming, trans-owned social
network powered by WokeNet, a sovereign Solana-protocol-compatible
network. People should be able to own and move their identity, social graph,
public content relationships, communities, and choice of algorithm without
needing to understand cryptocurrency.

The flagship client must feel like a trustworthy consumer application rather
than a wallet or blockchain explorer. A person may browse before owning WOKE,
create a recoverable passkey-first account, use a familiar handle, and
understand every transaction before approving it.

WokeNet has its own native currency, WOKE (`$WOKE`), with nine decimals.
It is not an SPL token and has no mint address. The product remains
noncustodial: ordinary reading never requires WOKE, and no production network,
public sale, bridge, exchange, lending, yield, or token-gated identity feature
is authorized by this specification.

The product is open to anyone who follows its community and safety standards. It must not require disclosure of gender, sexuality, legal name, or a wallet address in the visible interface.

## 3. Product principles

1. **User agency:** People control identity presentation, audience, feeds, safety settings, portability, and provider choices.
2. **Protocol before platform lock-in:** A proprietary database or hosted API must never be the sole authority for identity, public social relationships, or signed public content.
3. **Replaceable conveniences:** RPC, indexer, relay, storage, media, and recommendation services must be replaceable without abandoning the identity.
4. **Humane cryptography:** Wallets, signatures, storage hashes, and sponsored transactions are explained in user terms and hidden when no decision is required.
5. **Privacy by default:** Sensitive personal information stays offchain; private content is encrypted before leaving the client.
6. **Safety with due process:** Personal controls are immediate; community and service enforcement is scoped, logged, reviewable, and appealable.
7. **Honest permanence:** The product never promises erasure from a public blockchain, permanent store, recipient device, or independently operated indexer.
8. **Accessible by construction:** WCAG 2.2 AA, keyboard operation, reduced motion, contrast, captions, and localization are launch requirements.
9. **No token gating or speculative product:** WOKE is the network’s native fee
   and settlement currency; ordinary profiles and posts are neither NFTs nor
   conditioned on owning it, and the flagship is not an exchange, lending, or
   yield product.
10. **Evidence over claims:** Production-readiness language follows verified build, test, security, accessibility, and operational evidence.

## 4. Product roles

- **Visitor:** Browses public content, profiles, communities, protocol documentation, safety information, and service status without signing in or holding WOKE.
- **Member:** Maintains an identity, profile, follows, posts, feeds, messages, settings, and safety controls.
- **Creator:** Optionally publishes offerings, paid content, subscriptions, events, and noncustodial payment destinations.
- **Community moderator:** Acts only within granted permission scopes and a published community policy.
- **Community administrator:** Configures membership, roles, governance, moderation providers, and portable community settings.
- **Client or indexer operator:** Runs compatible software from public specifications and can select lawful service policies.
- **Third-party developer:** Builds a compatible client, feed, indexer, relay, or storage adapter without a proprietary API.

One person may hold several roles. Roles must not reveal protected identity attributes or legal identity by default.

## 5. Primary product outcomes

### 5.1 Explore without crypto

**PS-EXP-001 — Partially implemented and tested.** A visitor can load the
static marketing, explainer, onboarding, settings, and product-state surfaces
without a wallet or network provider. Connected home/post routes expose bounded
error and unavailable states; complete offline cached network reading remains
open.

**Acceptance criteria**

- No wallet connection, email, passkey, or WOKE balance is required to view public cached content.
- A degraded-network state explains what is unavailable without showing a blank screen.
- Wallet addresses are not used as the primary visible identity label.

### 5.2 Create and recover an identity

**PS-ID-001 — Partially implemented and tested.** The replaceable service-account
layer supports exact-origin/RP, user-verifying passkey registration and
discoverable sign-in, client-only Ed25519 seed generation, and ciphertext-only
PRF wrapper synchronization. It deliberately does not yet claim to create the
protocol identity. Existing WokeNet-compatible wallet onboarding, confirmed
WokeNet identity creation, email-assisted recovery, and the complete
device/recovery product remain open.

**Acceptance criteria**

- Each path states who can recover the account, what is stored, and what can be revoked.
- A new passkey user can explore and complete a profile without first acquiring WOKE.
- Email is never written to a public manifest or onchain account.
- Device-bound delegated session keys expire and can be individually revoked.
- Linking or unlinking one wallet does not silently replace the identity root.
- Recovery has a delay, a cancellation path, and notifications to existing trusted devices.
- Transaction prompts identify the action, affected account, estimated fee, and whether sponsorship is used.

### 5.3 Publish and verify a post

**PS-PUB-001 — Implemented and verified for the connected text-post slice.** A
real local-validator flow canonicalizes and signs a text-post manifest,
publishes it to local content-addressed storage, anchors its hash/reference,
projects it through PostgreSQL, renders it in the production web feed, then
clears and exactly rebuilds the projection. Flagship interactive publication
remains disabled until its authentication and transaction adapters land.

**Acceptance criteria**

- The client signs the canonical manifest and verifies the signature and content hash before display.
- Publication progress distinguishes local signing, storage publication, WokeNet confirmation, and indexing.
- A recoverable error can retry without producing a duplicate post.
- The post remains independently verifiable without the flagship database.
- A local-validator end-to-end test proves the complete flow without mocked blockchain success.

### 5.4 Move between providers

**PS-PORT-001 — Partially implemented and tested.** The client validates and
persists alternate RPC, content gateway, indexer, and WebSocket relay endpoint
profiles with protocol/credential restrictions and trust explanations. Live
failover is verified in service clients, but end-user migration across every
configured provider remains open.

**Acceptance criteria**

- Invalid or unhealthy endpoints fail safely and do not overwrite the last working configuration.
- Switching indexers does not require a new identity.
- Public profile and social-graph data can be reconstructed from protocol data.
- The client visibly indicates degraded verification or freshness when a provider is behind.

## 6. Identity and inclusive profile requirements

### 6.1 Identity presentation

**PS-INC-001 — Planned.** A chosen display name is independent of a legal name. The product does not request a legal name in ordinary onboarding.

**PS-INC-002 — Planned.** A profile may contain zero, one, or multiple pronoun sets, including custom localized text. Each set has a visibility control.

**PS-INC-003 — Planned.** Gender and sexuality fields are optional, flexible, and private by default. The service never infers them from appearance, name, behavior, connections, or content.

**PS-INC-004 — Planned.** Chosen-family relationship labels are supported without forcing a legal or biological relationship model.

**PS-INC-005 — Planned.** Current-profile surfaces use the current chosen name. Search suggestions, notifications, mentions, caches, and current-profile views must stop presenting an obsolete name after a verified update.

Signed historical revisions may remain retrievable from independent or immutable systems. When the official client exposes a historical revision, it must place the historical-data warning before the obsolete identity data and must not surface that data in ordinary current-profile views.

**PS-INC-006 — Planned.** Identity terminology is localization-ready, supports right-to-left presentation, and does not assume English pronoun grammar.

**Acceptance criteria**

- A profile can be completed while every identity-attribute field is blank.
- Pronoun visibility is enforced in API responses and rendered views, not only hidden with CSS.
- A profile update invalidates current-view caches and search projections for the replaced chosen name.
- Harassment reports support targeted deadnaming and targeted misgendering without treating accidental mistakes as automatically equivalent.
- No verification flow asks a reviewer or model to infer gender or sexuality from an image.

### 6.2 Handles and wallet privacy

**PS-ID-002 — Partially implemented and local-validator tested.** Human-readable
ASCII v1 handles are globally collision-safe onchain, distinct from wallet
addresses, exactly released/reclaimed through events, and projected by memory
and PostgreSQL indexers. Client claim UX remains disabled pending authenticated
transactions.

- Collision and impersonation behavior must be explained before handle claim.
- Wallet details are available only in an intentional account or transaction detail view.
- Copy-address actions include network and recipient context.
- The interface must never imply that a handle alone proves legal identity.

## 7. Content and interaction requirements

### 7.1 Content types

The product plans support for:

- Short and long text
- Safely formatted rich text
- Images and image carousels
- Video and vertical short-form video
- Audio
- Polls
- Stories or expiring posts
- Events and livestream signaling
- Replies, quotes, reposts, reactions, bookmarks, and external shares
- Creator offerings, subscription-gated content, and paid event metadata

All content types remain **Planned** until their relevant unit, integration, accessibility, and end-to-end checks pass.

### 7.2 Composer

**PS-CMP-001 — Partially implemented and tested.** The device-local composer
validates plain text, media references and image alt text, content warnings,
audience/community, reply/remix controls, storage policy, safe preview,
save/restore, and two-step discard. Rich text, polls, uploads, captions,
scheduling, real publication progress, and retry remain open; publish is
deliberately disabled without the required receipts.

**Acceptance criteria**

- User-generated HTML is sanitized; scripts, tracking pixels, unsafe embeds, and dangerous URL schemes are rejected.
- An image publish flow requests alt text and permits an explicit decorative-image choice.
- Video publishing requires a caption file, transcript, or an explicit documented exception.
- A draft survives a refresh or temporary network outage and can be deleted locally.
- Scheduled drafts remain local unless the member explicitly enables a scheduling service.
- Closing during publication does not falsely report success.
- A failed storage or chain step identifies what succeeded and offers an idempotent recovery action.
- Audience and permission choices are shown in preview and signed into the relevant manifest.

### 7.3 Storage policy and permanence

**PS-STO-001 — Planned.** Ordinary public posts default to a deletion-compatible storage policy. Permanent publication is never the default.

**PS-STO-002 — Planned.** Publishing any content to Arweave or another intentionally permanent path requires a separate, just-in-time confirmation that:

1. names the permanent provider;
2. explains that deletion may be impossible even after account deletion;
3. previews the exact public content and metadata;
4. is not bundled into general terms;
5. records the signed consent version and timestamp; and
6. can be declined without losing the ability to use a deletion-compatible option.

**PS-STO-003 — Planned.** Stories and expiring posts must not use permanent storage by default. Expiration removes them from official discovery and delivery, but the UI must explain that recipients or third parties may retain copies.

**PS-STO-004 — Planned.** Restricted, private, and paid content is encrypted before storage. Public manifests must not contain decryption keys. Content addressing is not treated as access control.

**PS-STO-005 — Planned.** Edits create signed revisions. Deletion creates a tombstone and official suppression; it never silently rewrites signed history.

**Acceptance criteria**

- The ordinary composer selects a deletion-compatible local or configured provider by default.
- Permanent storage cannot be selected through a pre-checked control or inherited consent.
- The official client and indexer hide a tombstoned object and its cached media after ingesting the tombstone.
- A deletion receipt distinguishes client/indexer suppression, provider deletion requests, key destruction, immutable references, and unresponsive third parties.
- Gateway fallback verifies the expected hash or CID before rendering.
- A paid-content test proves that an unauthenticated storage fetch yields ciphertext, not plaintext.

## 8. Feeds, search, and discovery

### 8.1 Feed types

**PS-FEED-001 — Partially integrated; provider engine implemented and tested.**
The replaceable feed service implements chronological, following, community,
media, bounded-window trending, explainable recommendation, and third-party
order reconciliation with local safety enforcement. The flagship has every
required feed surface and a connected home slice, but live source/provider
integration for every surface remains open.

Every recommendation feed must provide:

- “Why am I seeing this?” with contributing signals
- Topic-frequency controls
- Explicit negative feedback
- Personalization reset
- Behavioral-personalization opt-out
- Chronological fallback
- Block, mute, keyword, and sensitive-content enforcement

The initial recommendation model may use declared interests, follows, freshness, community membership, explicit feedback, and bounded popularity. It must penalize repetitive content, suspected spam, rage-bait signals, and low-quality repost loops. It must not infer protected identity traits.

**Acceptance criteria**

- A deterministic fixture produces a documented ranking with an explanation for every item.
- Resetting personalization deletes or resets the relevant private preference state.
- Disabling behavioral personalization changes the feed without disabling chronological access.
- Blocked accounts and muted keywords do not reappear through quotes, recommendations, or third-party feed results in the official client.
- A third-party feed is labeled with provider identity, policy, data shared, and an immediate disable control.

### 8.2 Search and discovery

**PS-SRCH-001 — Planned.** Search supports public handles, current profile fields, posts, communities, events, and discoverable creators while respecting tombstones, visibility, blocks, and current-name rules.

- Search results state which indexer produced them.
- Deleted or access-revoked content is removed from official results once the relevant update is ingested.
- Search must not expose private profile fields, wallet addresses by default, recovery email, private-community content, or message content.

## 9. Social graph, communities, and governance

### 9.1 Social interactions

**PS-SOC-001 — Planned.** Members can follow/unfollow, block, mute, reply, quote, repost, react, bookmark, and share subject to the target’s permissions.

- Block takes effect immediately in the local client while protocol propagation completes.
- Private preferences such as mutes and bookmarks must not be made public merely because a protocol object exists for them.
- Duplicate, replayed, or unauthorized interactions fail without producing misleading counts.

### 9.2 Communities

**PS-COM-001 — Planned.** Communities support public, restricted, and private modes; rules; join requests; roles; scoped permissions; moderators; pinned posts; resource pages; events; polls; governance; optional treasury configuration; portable configuration; and community-selected moderation providers.

**Acceptance criteria**

- A private community does not leak private posts or a membership roster through the official public API.
- Every moderator action records actor, permission scope, target, policy version, reason category, timestamp, and appeal eligibility.
- Exported community configuration is documented, versioned, and accepted by a clean compatible instance.
- A person without the required role cannot perform an administrative action even by calling the API directly.
- Emergency safety action expires or enters mandatory review on schedule.

### 9.3 Governance

**PS-GOV-001 — Planned.** Communities may select one-member-one-vote, capped reputation weighting, delegated voting, moderator council, or configurable quorum and supermajority rules. Token wealth is not the default voting weight.

- The selected model and anti-sybil tradeoffs are visible before joining or voting.
- Proposal state and vote authorization are independently verifiable.
- Governance cannot override personal blocks, reveal private identity attributes, or retroactively change signed content.

## 10. Messaging, notifications, and real-time experiences

### 10.1 Direct messages

**PS-MSG-001 — Partially implemented and experimentally tested.** A
pairwise-only adapter delegates real Olm device/session cryptography to pinned
Matrix Rust crypto WASM, binds engine keys to current WokeSocial device
authorization, authenticates sender-signed outer routing metadata before Olm
state mutation plus the encrypted inner context, and rejects replay, relay
mutation, corruption, wrong-device delivery, authorization changes, and local
or remote revocation in 13 real-WASM cases. Production encrypted persistence, browser packaging,
attachments, safety verification, relay integration, and product controls
remain open.

**PS-MSG-002 — Planned.** Group messaging must remain **Experimental** until the selected mature group-encryption implementation passes its security gates. A plaintext, server-readable, or cosmetic-encryption substitute is forbidden.

**Acceptance criteria**

- Relay and database inspection cannot recover message or attachment plaintext.
- A revoked device cannot decrypt subsequently rotated conversation keys.
- Replayed envelopes are rejected.
- Safety verification changes visibly after an identity-key change.
- Message requests and blocks are enforced before delivery notifications.
- A reporter may select and voluntarily disclose specific messages; unrelated conversation history is not attached.
- The metadata still visible to relays and recipients is explained before messaging is enabled.

### 10.2 Notifications and relays

**PS-RT-001 — Implemented and tested as a nonauthoritative transport.**
Replaceable relays validate signed advisory presence, typing, notifications,
live reactions, community updates, encrypted-message envelopes, and encrypted
livestream signaling; bound retention, backpressure, failover, reconnect,
deduplication, and gaps are real-loopback tested. Message encryption itself is
not claimed.

- Clients reconcile durable events against signatures, manifests, and protocol references.
- Presence and typing data are ephemeral and disabled when the user opts out.
- Multiple relay URLs and failover are user-configurable.

## 11. Safety and moderation experience

The complete moderation policy and operational model are defined in [MODERATION.md](./MODERATION.md).

Product surfaces must include:

- Block, mute, keyword filters, reply/mention/message controls
- Sensitive-content controls and content warnings
- Shared blocklists with a preview before activation
- Safety mode and anti-dogpile controls
- Reports with reporter-selected evidence
- Appeals and action status
- Community rules and moderator action history
- Doxxing-risk warnings, bot labels, and coordinated-harassment signals
- Specific workflows for nonconsensual intimate media and child-safety escalation
- Crisis-resource hooks that do not infer a diagnosis or identity

**PS-SAFE-001 — Planned.** A report acknowledgement must never claim that content was removed when it was only queued, labeled, hidden locally, or unavailable from one indexer.

**PS-SAFE-002 — Planned.** Irreversible service enforcement based on automation requires human review and an appeal path, except for cryptographically invalid payloads or clearly automated technical abuse.

## 12. Creator economy and payments

**PS-PAY-001 — Experimental local compatibility subset; native-network
activation blocked.** The program implements noncustodial native WOKE tips and
weekly subscription settlement with deterministic recipient splits, fee
snapshots, permanent replay receipts, and entitlement state. Production use is
disabled because native Firedancer cannot yet submit, simulate, confirm, and
serve the indexed RPC history required by the application. Allowlisted
non-native token tips, paid memberships, and paid tickets remain planned.

**Acceptance criteria**

- The application never takes custody through an application-controlled hot wallet.
- Recipient, exact genesis-bound network, asset, base-unit amount, fees, splits,
  and recurrence are shown before signature.
- Native WOKE has no mint address. Any future token asset requires an exact
  mint, token-program, and decimals allowlist; recipient or asset substitution
  is rejected.
- Duplicate submission, replay, rounding, fake entitlement, and simulation mismatch tests pass.
- WokeNet production execution remains disabled until the native
  Firedancer, genesis, security, legal/economic, authority, and funded
  configuration gates are documented and pass.

The product does not include an exchange, lending, yield, investment,
token-sale, or speculative-promotion feature.

## 13. Media requirements

**PS-MED-001 — Partially implemented and tested.** The noncustodial worker
implements authenticated resumable uploads, exact chunk/source hashing, strict
MIME/container/decode checks, bounded metadata-free image/video/audio
processing, thumbnails, responsive images, MP4/HLS/posters, waveform metadata,
validated caption/alt-text references, real ClamAV scanning, content-addressed
publication, storage health, and an independent preprocessed path. Browser
upload/client hashing, production multi-provider replication, signed client
publication, and end-to-end accessibility UX remain open.

**Acceptance criteria**

- Claimed MIME type and detected file type mismatches are rejected.
- Image metadata identified by the privacy policy is stripped before publication.
- The client independently verifies the processed output hash.
- Cancellation stops outstanding uploads or explains any provider copies already created.
- Third-party clients can publish already processed compliant media without the flagship worker.
- Video is lazy-loaded and does not prevent a usable initial render.

## 14. Required product surfaces

All surfaces below are **Planned**. A route existing by itself does not satisfy the requirement.

| Area | Required surfaces |
|---|---|
| Public | Marketing homepage; about and principles; protocol/decentralization explainer; safety/moderation explainer; developer documentation; service status |
| Access | Onboarding; sign in; account recovery |
| Feeds and discovery | Home; following; chronological; community feeds; custom-feed marketplace; explore; search |
| Publishing | Composer; post detail/reply thread; vertical video viewer; stories viewer |
| Communication | Notifications; direct messages; group messages |
| Communities | Directory; detail; administration; governance proposals; events |
| Creators | Creator page; monetization |
| Identity | User profile; edit profile |
| Settings and safety | Settings; privacy; safety center; blocks/mutes; reports/appeals; connected devices; delegated keys |
| Portability and infrastructure | Wallet/funding; storage preferences; data export; account migration; account deletion |

Every surface must provide relevant loading, empty, permission-denied, validation-error, service-error, offline, and retry states. Destructive actions require clear scope and recovery information.

## 15. Accessibility, localization, and responsive behavior

**PS-A11Y-001 — Automated route coverage implemented; conformance review
pending.** Two hundred three desktop/mobile browser cases pass, including 90
axe A/AA scans over 45 route fixtures, keyboard navigation, high contrast, and
local state flows. The connected post-detail route has semantic browser
coverage but is not yet in the axe matrix. The documented manual
assistive-technology matrix remains required before a WCAG 2.2 AA conformance
claim.

Required behavior includes semantic HTML, complete keyboard operation, visible focus, skip links, screen-reader names, focus trapping, reduced motion, contrast, text resizing, captions, transcripts, alt text, announced form errors, non-drag alternatives, non-color-only meaning, adequate touch targets, right-to-left readiness, and localization-ready strings.

**Acceptance criteria**

- Automated accessibility tests have no serious or critical violation on required screens.
- A documented keyboard-only run completes onboarding, profile editing, posting, following, community participation, reporting, messaging, feed switching, export, and deletion.
- Zooming text to 200% does not hide essential controls or require two-dimensional scrolling in ordinary reading layouts.
- Motion honors `prefers-reduced-motion` without losing state or meaning.
- Theme selection includes light, dark, high contrast, and system preference.

## 16. Performance and resilience

**PS-RES-001 — Planned.** The application provides fast initial rendering, virtualized long feeds, responsive images, lazy video, route-level code splitting, offline-friendly cached reading, resilient drafts, and retryable publication.

**Acceptance criteria**

- Loss of the primary RPC, gateway, indexer, or relay produces a useful degraded state and attempts a configured fallback.
- Cached public reading remains available offline with a clear freshness timestamp.
- A stale indexer cannot present unverified data as current.
- Publication retry is idempotent across blockhash expiration and transient provider failure.
- Representative Core Web Vitals and mobile performance measurements are recorded in the final verification report.

## 17. Privacy and legal experience

The technical privacy requirements and deletion model are defined in [PRIVACY.md](./PRIVACY.md).

Product requirements include consent-based analytics, development analytics disabled by default, cookie controls, data export, local draft deletion, deactivation, key revocation, tombstones, provider deletion requests, permanence disclosures, age-gating architecture, and clearly labeled legal-review placeholders.

No product copy may claim GDPR, CCPA, COPPA, or other legal compliance solely because these technical controls exist. Qualified legal review is an external launch dependency.

## 18. Out of scope

- A public token sale, speculative WOKE promotion, or token-gated ordinary identity/content
- NFTs for ordinary profiles or posts
- Custodial wallets or application-controlled custody of creator funds
- Exchange, lending, yield, or investment products
- Private-message plaintext available to relays, indexers, analytics, or moderators
- Appearance-based identity verification
- A proprietary service required to interpret public protocol objects
- Automatic publication to permanent storage without item-specific consent
- WokeNet production deployment or spending real funds as part of ordinary development

## 19. Product verification gates

The product cannot be described as production-ready until:

1. Essential flows work without manual database editing.
2. Required mobile and desktop surfaces are polished.
3. Loading, empty, offline, error, and degraded-provider states are present.
4. Onboarding requires neither prior crypto knowledge nor an initial WOKE balance.
5. The 20 required end-to-end journeys pass, including local-validator and keyboard-only coverage.
6. Alternate RPC, gateway, indexer, and relay settings work in integration tests.
7. Moderation, privacy, accessibility, security, protocol, build, and operational gates pass.
8. Experimental features are visibly labeled and excluded from production claims.
9. Known limitations and external configuration are listed in `FINAL_REPORT.md`.

## 20. Current status summary

| Capability group | Status | Evidence |
|---|---|---|
| Public experience and onboarding | Partial | Complete route surface, 203 passing desktop/mobile browser cases, and real passkey service-account registration/sign-in; wallet and protocol-identity onboarding remain fail-closed |
| Identity, profile, and recovery | Partial | Identity/profile/handle/rotation/delegation plus delayed guardian-threshold recovery pass the compatibility oracle; durable passkey ceremonies, atomic credential/wrapper registration, same-root service-passkey list/add/revoke, and sessions pass, while protocol onboarding, WokeNet delegation lifecycle, recovery product UX, sponsorship, and native Firedancer execution remain open |
| Signed publishing and social graph | Verified text-post vertical slice; broader interactions partial | Nine finalized transactions, signed CAS manifest, exact PostgreSQL replay, root/delegated social program tests |
| Feeds, search, and discovery | Partial | Seven-mode replaceable feed contract with 29 tests and complete web surfaces; production source integration remains |
| Communities and governance | Partial | Community/membership plus immutable one-member-one-vote proposal, vote, and finalization accounts pass 16 validator flows; other models, execution, and enabled web mutations remain open |
| Moderation and appeals | Partial | Strict signed provider intake/active labels/restricted reads plus an encrypted append-only PostgreSQL case/appeal ledger, retention/legal holds, due/expiry transitions, and transparency aggregation pass; production object authorization/SSO and complete specialist product workflows remain blocked |
| One-to-one encrypted messaging | Experimental subset | Pairwise real-WASM Olm adapter passes 13 envelope/device/revocation/lifecycle adversarial cases; volatile storage and absent browser/relay/product integration keep it non-production |
| Group encrypted messaging | Experimental design only | UI is disabled; no group cryptography is claimed |
| Media, stories, events, and livestream architecture | Partial | Hardened resumable media worker, real processing, ClamAV scanning, unsigned manifests, routes, and encrypted signaling exist; browser publication, stories/events/live product flows remain gated |
| Creator payments and entitlements | Experimental compatibility subset | Native WOKE tips and weekly subscriptions, permanent receipts/entitlements, IDL-aligned SDK instruction/proof helpers, and indexer projections are implemented against the compatibility oracle; flagship UX, broader economy features, and native Firedancer execution remain blocked |
| Portability and provider replacement | Partial | Alternate endpoint validation, open indexer/storage/feed/relay/moderation contracts, replay, and relay failover pass |
| Accessibility, performance, and resilience | Partial | Production build, automated desktop/mobile/axe matrix, and reproducible unthrottled loopback TTFB/DOM/load/LCP/CLS observations pass; manual WCAG, field Core Web Vitals, INP, load/capacity, and resilience gates remain |

This table must be updated only when links to passing evidence are available.

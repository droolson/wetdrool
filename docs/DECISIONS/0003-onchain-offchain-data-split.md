# ADR-0003: Onchain and Offchain Data Split

- **Status:** Accepted design; implementation pending
- **Date:** 2026-07-28
- **Owners:** Protocol, privacy, and security architecture

## Context

Solana provides public verifiability but has cost, account-size, transaction,
privacy, and deletion constraints. Content storage offers capacity and
portability but cannot independently establish protocol authorization or
settlement.

## Decision

Store only compact facts that require shared public verification onchain.
Store content bodies as signed, versioned, content-addressed objects offchain.
Keep sensitive and private data encrypted and off public ledgers.

| Data | Placement |
| --- | --- |
| Identity root, authority rotation, scoped delegation, revocation | Onchain |
| Handle ownership | Onchain compact claim |
| Public follow/community/governance state selected for portability | Onchain account/event |
| Profile/post/media/policy bodies | Signed offchain manifest |
| Manifest digest, locator commitment, author, nonce, revision pointer | Compact onchain reference when anchoring is required |
| Large media | Content-addressed providers; never Solana accounts |
| Payments and entitlement settlement | Onchain; terms body remains signed offchain |
| Public tombstone intent | Signed object and onchain reference for anchored content |
| Email, phone, IP, legal identity, recovery contacts, device fingerprints | Private offchain only |
| DMs, attachment keys, drafts, private preferences, private memberships | Encrypted client/relay/operator storage only |
| Moderation evidence and appeals detail | Encrypted, access-controlled operator/community records |

Bookmarks and mutes are private by default. Blocks and community membership are
public only through explicit user/community policy; encryption does not justify
placing relationship metadata onchain.

## Publication rule

The client validates, canonicalizes, hashes, signs, publishes, and locally
re-verifies an offchain object before anchoring its digest. If storage succeeds
but anchoring fails, a recoverable receipt permits idempotent retry. Onchain
state never claims that missing or hash-invalid bytes are verified content.

## Revision and deletion rule

Content is immutable. Edits create linked revisions. Deletion creates a
tombstone, suppresses official projections, and requests provider erasure or
unpinning where possible. It does not claim to erase ledger history, independent
replicas, or permanent storage. Permanent publication requires separate,
explicit consent.

## Consequences

- Availability and integrity are separate: a valid reference can temporarily
  lack retrievable bytes.
- Indexers must verify both chain authorization and offchain bytes.
- Metadata analysis remains a risk for public edges and timing.
- Provider redundancy is required for availability, but replication reduces the
  likelihood of complete deletion.
- UI needs honest permanence, privacy, pending, and unavailable states.

## Rejected alternatives

- **Raw content/media onchain:** costly, privacy-hostile, size constrained, and
  effectively undeletable.
- **Only offchain signed state:** insufficient for shared namespace,
  authorization rotation, replay-safe public settlement, and portable anchors.
- **Encrypted PII onchain:** ciphertext and metadata are permanent and key
  compromise makes disclosure irreversible.
- **IPFS as automatic permanence:** content addressing does not guarantee
  retention.

## Verification

Schema tests must reject forbidden public fields and oversized bodies; program
tests must reject raw/oversized data; integration tests must cover missing,
corrupt, duplicated, tombstoned, and permanently published content.

# ADR-0010: Verified community manifests and privacy-safe discovery

- Status: Accepted
- Date: 2026-07-29
- Owners: Protocol, indexer, application, privacy, and security

## Context

The Solana program already creates a stable community PDA and commits a
manifest URI, manifest digest, governance version, and governance-strategy
digest. The indexer previously projected only that account-shaped shell. It did
not verify the referenced signed community manifest, so the flagship client
could not safely display a name, description, visibility, or discovery result.

The schema-version-1 community object also allowed several governance
descriptions that were not executable by the current program. Treating those
descriptions as equivalent to the onchain strategy would make signed metadata
and executable behavior disagree.

Community slugs are human-readable labels, not globally unique protocol
identifiers. Private and restricted communities must not become discoverable
merely because a public Solana event contains a community PDA.

## Decision

### Exact governance binding

New community manifests use schema version 2 and the single strategy currently
implemented by the program:

```json
{
  "model": "one-active-member-one-vote",
  "version": 1,
  "quorumBasisPoints": 5000,
  "approvalBasisPoints": 5001,
  "abstainTreatment": "quorum-only",
  "execution": "outcome-record-only"
}
```

Its onchain commitment is SHA-256 over:

1. the UTF-8 domain `wokenet:community-governance-strategy:v1`;
2. one NUL byte; and
3. the RFC 8785 canonical JSON bytes of the strategy object.

Portable responses encode those 32 bytes using the protocol's multibase
base64url form (`u...`). Anchor instructions and events carry the same raw
`[u8; 32]` value. A verifier must reject a manifest unless both its strategy
version and exact digest match the finalized `CommunityCreated` event.

The projection retains that creation-time pair as
`manifestGovernanceVersion`/`manifestGovernanceStrategyHash`. The separate
`governanceVersion`/`governanceStrategyHash` pair follows later finalized
governance updates. A later update never rewrites or invalidates the verified
creation manifest; clients show that the current anchor differs instead of
misrepresenting the manifest declaration as current state.

Schema-version-1 community objects remain readable as immutable history but
cannot be created by current builders or promoted to a verified discovery
projection.

### Immutable creation manifest

The current program has no community-manifest replacement instruction.
Accordingly, only a community manifest whose replacement sequence is exactly
`1` may verify against `CommunityCreated`. Later portable replacement objects
do not mutate the community projection. A future metadata update requires a
versioned onchain instruction/event and an explicit transition rule.

Community creation is root-only in v2. The signed envelope's key ID must be
exactly `<creatorIdentityId>#root/<manifestAuthority>`, where
`manifestAuthority` is the creation event's immutable authority. The projection
keeps that value separately from `latestActionAuthority`, which records the
signer of the latest finalized creator-authorized community action. That value
may be a scoped delegate and is not a persistent community controller or a
substitute for resolving the creator identity's current root. A verifier must
never rebind the historical manifest signature to a later action signer.

The signed payload's 16-byte nonce must exactly match the
`CommunityCreated.communityNonce` bytes used in the community PDA. Current SDK
publication therefore requires callers to persist and reuse an explicit nonce
and `createdAt` value. Retrying the same input resolves to the same signed
object and community address; silently generating either value during a retry
would create a different protocol object.

The SDK derives the exact community PDA before chain submission and requires
the chain writer to reconcile that account before invoking Anchor's
non-idempotent `init`. The writer returns `absent` only when creation is safe,
returns an existing pending or finalized confirmation only when every immutable
creation field matches, and throws on conflicts. The SDK also rejects a valid
Solana confirmation address when it is not the derived PDA. This makes a
landed-but-response-lost transaction retryable without blindly rerunning
`init`.

### Ingestion and replay

`CommunityCreated` is a manifest-bearing event. The indexer applies the same
bounded, retryable verification pipeline used for other anchored manifests:

- an unavailable object remains a non-displayable pending shell;
- a malformed, mismatched, or unauthorized object reaches a terminal
  rejection or quarantine;
- only a canonical signed schema-v2 object with the expected author, network,
  payload hash, URI, creation authority, signed/PDA nonce, creation sequence,
  and governance commitment is promoted;
- durable raw events retain enough disposition state for deterministic replay;
- old accepted community events that predate verification are requeued by the
  migration while their unverified shells remain non-displayable.

The PostgreSQL projection is disposable. Destroying and rebuilding it from
finalized Solana events and referenced content must reproduce the same verified
community view.

### Discovery and privacy

Protocol identity is the base58 community PDA. Detail routes use that address;
slugs are display and search fields and may collide.

- Directory and search contain verified `public` communities only.
- Direct detail lookup may return verified `public` or `unlisted` communities.
- `private` and `restricted` communities return the same not-found response as
  an unknown address.
- Public endpoints never return membership lists.
- Proposal and vote lookups apply the same parent-community visibility gate, so
  protected or unverified communities cannot leak a participation roster through
  known governance addresses.
- Unverified shells never become directory, detail, or search results.
- Directory pagination is bounded and deterministic by finalized creation slot
  and community address.
- Search declares deterministic ranking recipe `public-match-v2`.

Every response remains a noncanonical projection and includes its configured
network and finalized indexer checkpoint. Clients strictly validate the
response, visibility, proof-bearing fields, bounds, and network before display.
Malformed or over-broad provider data produces an explicit unavailable state,
not sample content.

## Consequences

### Benefits

- A displayed community name is cryptographically tied to its finalized Solana
  creation event, PDA nonce, immutable creation authority, and exact executable
  governance strategy.
- Private, restricted, unlisted, and unverified states have explicit
  fail-closed behavior.
- Address-based routing avoids ambiguous slug ownership.
- Any compatible indexer can rebuild and serve the same portable public
  projection.

### Costs and limits

- The current metadata is immutable after creation.
- Only one governance strategy is expressible by current community builders.
- Private/restricted community publication remains disabled until encrypted
  metadata and authenticated access are implemented.
- A Solana `CommunityCreated` event still exposes the community PDA, creator
  identity, manifest CID, and hashes. Returning not-found from the official API
  prevents discovery amplification; it does not make a protected community's
  existence secret from chain observers.
- Member-signed open-community membership now has a separate predeployment
  protocol/program/SDK/indexer contract under ADR-0011, but wallet-backed
  joining, community feeds, richer moderation roles, lifecycle status, and
  governance transaction UX remain separate product slices.
- Local-validator evidence does not establish a public Solana deployment.

## Rejected alternatives

- **Display the onchain shell:** it contains no verified user-facing metadata.
- **Trust a slug as identity:** slugs are neither unique nor onchain authority
  roots.
- **Index every community event publicly:** this leaks the existence and
  metadata of protected communities.
- **Return memberships with public detail:** membership can be sensitive and is
  not required for discovery. ADR-0011 permits only a separate exact-PDA status
  lookup with no roster or identity fields.
- **Hash an informal governance label:** it does not bind the exact executable
  thresholds and abstention semantics.
- **Accept offchain-only metadata replacement:** the current program exposes no
  canonical transition to authorize it.

## References

- [ADR-0002: Canonical serialization and hashing](0002-canonical-serialization-and-hashing.md)
- [ADR-0003: Onchain/offchain data split](0003-onchain-offchain-data-split.md)
- [ADR-0004: Indexer projection and replay](0004-indexer-projection-and-replay.md)
- [ADR-0009: WokeNet on Solana](0009-wokenet-on-solana.md)
- [ADR-0011: Member-signed community membership](0011-member-signed-community-membership.md)
- `packages/protocol/src/governance.ts`
- `apps/indexer/`
- `packages/indexer-client/`

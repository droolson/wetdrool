# `@wokesocial/protocol`

This package is the portable, implementation-independent WokeSocial signed-object layer. It provides strict v1 Zod schemas, typed builders, canonical serialization, stable object IDs, Ed25519 envelopes, authorization requirements, and immutable transition validation.

The package validates claims. It does not turn a signed claim into authoritative network state. Indexers and clients must still reconcile the claim with finalized WokeNet state, community policy, and content-addressed storage.

The distributable Draft 2020-12 signed-envelope schema is available at
`@wokesocial/protocol/schema/v1` and checked in under
`schemas/wokesocial-signed-envelope-v1.schema.json`. `schema:check` derives
it from the canonical Zod registry and fails on drift.

JSON Schema covers transport structure. It cannot replace RFC 8785
canonicalization, Ed25519 proof and payload-hash verification, UTF-8 byte
limits, cross-field refinements, intrinsic root-signing rules, or live
identity/delegation/community authorization. Consumers must use the runtime
protocol verifier for those boundaries.

## v1 envelope

Every payload carries:

- `protocol: "wokesocial"`
- `protocolVersion: "1.0"`
- `schemaVersion: 1` for most current families and frozen historical
  profile/community/community-membership objects; current profiles,
  communities, and community memberships use `schemaVersion: 2`
- a canonical WokeNet ID,
  `wokenet:v1:<genesis-hash-base58-32>:<program-id-base58-32>`
- an author identity bound to that network
- a root or delegated signing-key ID bound to that author
- an exact-millisecond UTC creation time
- a 16-byte multibase nonce
- a strict object-type discriminant and strict content object
- bounded noncritical `extensions`

`canonicalizePayload` uses RFC 8785-style JSON canonicalization after rejecting non-JSON values, unsafe numbers, non-NFC strings, cycles, unsupported critical extensions, and unknown fields. `getObjectId` is:

```text
wokesocialobj:v1:<type>:<multibase-base64url-sha256(canonical-payload)>
```

The signature covers a canonical, domain-separated proof descriptor containing the protocol signature domain, proof version, algorithm, key ID, network, object type, and payload hash. The envelope CID is the CIDv1/raw SHA-256 CID of the canonical envelope bytes.

The `post` and `tombstone` schemas, builders, and type names remain stable.
Profile reads are explicitly versioned, while its builder emits only the
current protected shape. The canonical WokeNet namespace has a pinned v1 post
golden vector; objects produced with the pre-migration `solana:` namespace are
intentionally incompatible and rejected.

## Object catalog

| Type | Purpose | Required delegated scope | External enforcement |
| --- | --- | --- | --- |
| `profile` | Portable current-profile manifest | `profile.write` | Select the finalized current pointer/revision |
| `post` | Original public or restricted content | `content.publish` | Validate any onchain publication reference |
| `tombstone` | Deletion, supersession, or compromise notice | `content.delete` | Prove target ownership or explicit third-party authority |
| `handle-claim` | Claim or release a 3–30 character handle | `identity.handle` | Namespace availability and finalized claim order |
| `delegation` | Scoped, time-bounded delegated key statement | `identity.delegate` | Root-rotation epoch, revocation, and scope state; root signature is intrinsic |
| `follow-edge` | Follow/unfollow event | `social.follow` | Target existence and winning replacement |
| `block-edge` | Content, interaction, or full block | `safety.block` | Target existence and winning replacement |
| `mute-preference` | Private identity, object, or keyword mute | `preferences.mute` | Private storage and winning replacement |
| `post-revision` | Immutable edit linked to an original and prior revision | `content.publish` | Complete revision lineage and current-view selection |
| `reply` | Content with a typed reply target | `content.publish` | Target existence and reply policy |
| `quote` | Commentary with a typed quote target | `content.publish` | Target existence and quote policy |
| `repost` | Reference-only repost | `content.publish` | Target existence and visibility/access |
| `reaction` | Add/remove named or emoji reaction | `social.react` | Target existence and winning replacement |
| `bookmark` | Explicitly private bookmark event | `preferences.bookmark` | Private/restricted storage and winning replacement |
| `media-manifest` | Original media, variants, captions, waveform, and scan statement | `content.media` | Byte retrieval, digest/CID checks, processor trust |
| `community` | Portable community configuration | `community.create` | Namespace, authority, current revision, federation, and treasury state |
| `community-membership` | Member-consented join/leave or moderator removal/ban | `community.membership` for self actions; `community.admin` for moderation | Open-membership policy or community authority, exact account state, and replacement lineage |
| `community-role` | Named role and bounded permission set | `community.admin` | Community authority and current role revision |
| `community-rule-set` | Versioned rules and appeal policy | `community.rules` | Community authority and exact version lineage |
| `moderation-label` | Signed advisory label | `moderation.label` | Provider policy, subject state, and supersession |
| `report` | Restricted report with encrypted evidence references | `safety.report` | Case workflow, reviewer authority, evidence retention |
| `appeal` | Restricted appeal of a report or label | `safety.appeal` | Appeal window, reviewer authority, and outcome |
| `governance-proposal` | Bounded proposal, choices, actions, quorum, and window | `governance.propose` | Eligibility, snapshot, quorum, timing, and execution |
| `governance-vote` | Replaceable vote and claimed weight | `governance.vote` | Eligibility, proposal choices/window, and verified weight |
| `creator-offering` | Noncustodial subscription, membership, ticket, or access offer | `payments.offer` | Issuer, accepted assets, capacity, and current terms |
| `subscription-entitlement` | Issuer-signed payment-backed entitlement | `payments.entitlement` | Finality, amount/asset, replay prevention, issuer, and validity |
| `tip-receipt` | Payer-signed payment intent/receipt | `payments.tip` | Finality, recipient/splits, amount/asset, and replay prevention |
| `event` | Versioned physical, virtual, or withheld-location event | `event.publish` | Host authority, access, ticket capacity, and current revision |
| `notification-preference` | Private category/channel and quiet-hours preferences | `preferences.notification` | Private storage, delivery endpoints, and current revision |

`authorizationRequirementFor` returns the signing mode, required scope, and external checks for each type. `verifyEnvelope` always performs schema, network/author/key binding, intrinsic authorization, hash, and signature validation. If an external authorizer is supplied, it also receives the complete payload, object ID, and declared enforcement requirements.

`delegation` and current schema-v2 `community` objects are intrinsically
root-only. Frozen schema-v1 community objects remain readable with their
historical root-or-delegation rule. For current community memberships,
member-authored join/leave actions use `community.membership`; moderator-authored
remove/ban actions use `community.admin` and require independent community
authority. All other delegated signatures still require an external decision
that the key existed, held the required scope, matched the current root-rotation
epoch, and was not revoked at `createdAt`.

## Revisions and deletion

Payloads are immutable; updates create new objects.

- Replaceable objects carry a positive `replacement.sequence`. Sequence 1 has no predecessor. Later objects must name the exact prior object ID and increment by one.
- `assertValidReplacementTransition` also preserves network, author, time order, type, and semantic subject for author-owned objects.
- `assertValidCommunityMembershipTransition` preserves the exact network, community address, member, prior object ID, gapless sequence, and increasing timestamp while allowing a separately authorized moderator to become the action author. Its fail-closed state table is `active -> left|removed|banned`, `left|removed -> active`, with a moderator ban also permitted from `left|removed`; `banned` is terminal.
- `assertValidPostRevisionTransition` preserves the original post, exact previous revision, and gapless revision number.
- Dedicated helpers validate community rule-set versions, moderation-label supersession, and entitlement renewals.
- `assertValidDeletionTombstone` validates the exact target ID, network, creation order, and author ownership by default. Passing `allowAuthorizedThirdParty` only acknowledges that the caller has separately established legal/community authority; it does not establish that authority.

An indexer must resolve forks using finalized protocol state and documented policy. A database row is never canonical merely because it has the greatest sequence.

## Restricted and encrypted references

`contentReferenceSchema` and `mediaReferenceSchema` can include:

```ts
{
  protection: {
    kind: 'encrypted',
    encryptionFormat: 'an independently specified format',
    keyEnvelope: { id: 'wokesocialobj:v1:...' },
    accessPolicy: { id: 'wokesocialobj:v1:...' }
  }
}
```

This is metadata about already encrypted bytes. This package does not encrypt, decrypt, derive keys, or assert that an `encryptionFormat` is safe. It deliberately provides no field for plaintext decryption keys. The referenced key envelope and access policy need separate specifications and implementations. Reports require encrypted evidence references; bookmarks, mute settings, and notification preferences are marked private so callers do not accidentally treat them as public manifests.

## Communities, federation, and governance

Current schema-v2 community objects support public, unlisted, private, and
restricted visibility. Their bounded configuration includes:

- the exact `one-active-member-one-vote` governance strategy accepted by the
  current onchain program, including fixed quorum, approval, abstention, and
  outcome-record-only execution semantics;
- bounded cross-network federation allow/block lists and an optional policy document;
- an optional WokeNet treasury account using the Solana-compatible 32-byte public-key representation, policy reference, and bounded asset allow-list.

The frozen schema-v1 community read path retains historical owner,
role-consensus, token-weighted, reputation-weighted, delegated-voting,
moderator-council, consensus, and supermajority declarations. Current builders
reject those legacy shapes. These fields are portable policy declarations. This
package cannot verify membership snapshots, treasury ownership, federation
behavior, quorum, votes, or proposal execution. Those checks belong to
finalized onchain state and independently operated indexers/clients.

Current schema-v2 community memberships bind an exact Solana-compatible
community account address to one network-local WokeNet identity. The first
action must be a member-authored `join`; self-authored `join`/`leave` actions
produce `active`/`left`, while separately authored moderator `remove`/`ban`
actions produce `removed`/`banned` and require a bounded nonblank reason.
`active` carries exactly `roles: ["member"]`; every inactive state carries
`roles: []`. Frozen schema-v1 authority-assigned memberships remain readable
but cannot be emitted or signed through the current creation API.

## Compatibility and limits

All known objects and nested records are strict. Unknown protocol/schema versions, object types, fields, algorithms, proof fields, and critical extension pointers are rejected. Noncritical extensions must use reverse-domain names, contain JSON values, fit within 32 KiB, and are covered by both object ID and signature.

Notable representation limits include:

- canonical network IDs:
  `wokenet:v1:<genesis-hash-base58-32>:<program-id-base58-32>`;
- canonical identity IDs:
  `wokesocialid:v1:<network-id>:<identity-address-base58-32>`;
- legacy `solana:` network, identity, and signing-key namespaces are rejected;
- decoded Solana-compatible public keys: exactly 32 bytes;
- decoded Solana-compatible transaction signatures: exactly 64 bytes;
- amounts: unsigned 128-bit decimal strings;
- finalized slots: unsigned 64-bit decimal strings;
- no floating-point protocol numbers;
- body text: 10,000 UTF-8 bytes;
- profile bio: 2,000 UTF-8 bytes;
- public optional profile and location values are inline;
  followers-only/private values require encrypted content references and never
  permit inline plaintext;
- media per post: 10;
- extension entries: 32.

Profile, community, and community-membership schema compatibility is versioned
within protocol version `1.0`:

- `schemaVersion: 1` contains the frozen historical profile, community, and
  authority-assigned community-membership shapes. The read and verification
  APIs continue to accept them so existing signed objects retain their
  canonical bytes, IDs, signatures, and historical authorization semantics.
- `schemaVersion: 2` is current for profile, community, and community-membership
  creation. Profile privacy requires encrypted content references for
  followers-only/private profile and location values.
  Communities require the exact one-active-member-one-vote governance
  commitment and root-key authorization. Memberships require member consent for
  self actions, explicit moderator authorship for removal/ban, exact role/state
  semantics, and an immutable replacement lineage.
- `buildProfilePayload`, `buildCommunityPayload`,
  `buildCommunityMembershipPayload`, `buildPortablePayload`, and `signPayload`
  enforce the current creation surface.
  `portablePayloadSchema`, `signedEnvelopeSchema`, `decodeCanonicalEnvelope`,
  and `verifyEnvelope` provide the versioned read path. Code that validates
  new-object submissions directly should use `currentPortablePayloadSchema` or
  `currentSignedEnvelopeSchema`.

The protocol package intentionally does not infer network activation from an
object's self-declared version. The open indexer fixes one immutable
`INDEXER_PROFILE_V2_ACTIVATION_SLOT` per WokeNet: a historical profile-update
event without the appended commitment may reference readable legacy v1 only
before that slot. Current root and delegated WokeSocial instructions accept
only schema version 2 and append it to the onchain event. Explicit commitments
must be v2 at every slot; at or after activation the commitment is mandatory and
the referenced envelope must also be v2. Live verification and exact-source
rebuild apply the same gate.

Adding a field to a v1 strict object is a breaking schema change. New optional semantics belong in a noncritical extension or a new schema/protocol version. A consumer must refuse an unrecognized critical extension rather than silently interpreting the rest of the object.

## Commands

```bash
pnpm --filter @wokesocial/protocol lint
pnpm --filter @wokesocial/protocol typecheck
pnpm --filter @wokesocial/protocol test
pnpm --filter @wokesocial/protocol build
```

The test suite covers every declared object type through real canonical signing and verification, whole-surface tamper rejection, strict/forward-compatibility failures, authorization context, root-only delegation, encrypted references, revision/deletion rules, numeric and Solana-compatible wire-width boundaries, and a pinned WokeNet compatibility vector.

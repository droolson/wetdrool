# WokeSocial Protocol: WokeNet on Solana

## Document status

- **Specification status:** Draft v0.1 for the future protocol v1
- **Implementation status:** Experimental core subset implemented and tested
- **Conformance vectors:** TypeScript unit fixtures exist; shared
  Rust/TypeScript golden vectors are not created
- **Development-localnet program ID:** `9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD`
- **Public WokeNet deployment:** None; tests use a disposable Solana local
  validator
- **Last verified:** 2026-07-29

Normative words such as **MUST**, **MUST NOT**, **SHOULD**, and **MAY** describe
the intended complete contract. The repository currently implements only the
subset identified in this document. A protocol v1 release still requires
matching distributable JSON Schemas, a stable generated Anchor IDL,
Rust/TypeScript golden vectors, complete local-validator conformance tests, and a
tagged specification release.

## Scope

The protocol defines:

- stable identities and authorized signing keys;
- public social-graph and community facts;
- signed portable content and policy objects;
- content references, revisions, and tombstones;
- rules for canonical bytes, hashes, identifiers, and signatures;
- an event stream from which indexers can rebuild;
- portable provider and moderation assertions;
- only under a separately approved mint-aware design, noncustodial payment
  settlement references.

The protocol does not make a hosted indexer, relay, database, feed algorithm,
media processor, recovery vendor, or moderation provider authoritative.

## Design principles

1. Put compact authorization facts and any future approved mint-aware
   settlement facts onchain; put signed content bodies offchain.
2. Sign bytes that independent implementations can reproduce exactly.
3. Bind every signature and identifier to a protocol version and network.
4. Use immutable objects plus explicit revisions and tombstones.
5. Make replays safe through unique nonces, deterministic PDAs, and instruction
   constraints.
6. Keep private preferences, messages, evidence, and personal information out of
   public protocol state.
7. Preserve unknown noncritical data and reject unknown critical behavior.

## Protocol registry

Before a v1 release, the repository must contain a machine-readable registry for:

| Registry | Initial values | Change rule |
| --- | --- | --- |
| Protocol versions | `1.0` | New major version for incompatible behavior |
| Object types | Types listed in this document | Additive after schema and conformance review |
| Signature algorithms | `Ed25519` | Security review and cross-language vectors required |
| Digest algorithms | `sha2-256` | New algorithm identifier and migration rules required |
| Content codecs | Canonical JSON and raw binary media | New codec requires deterministic byte rules |
| Delegation scopes | `profile`, `post`, `social`, `community`, `moderation`, reserved future `payment`, `message-directory`, `recovery-admin` | Least-privilege review; legacy payment instructions never become executable through a scope |
| Event types | Program events listed below | Event version bump for incompatible field changes |
| Moderation taxonomy | Versioned separately | Published migration and label semantics |
| Extension names | Reverse-DNS names | Collision-free ownership and criticality declaration |

No reserved value is usable merely because it appears in this draft; the
machine-readable registry and implementation must agree.

## Network and identifier rules

### Network identifier

A WokeNet deployment is identified by:

```text
wokenet:v1:<base58-genesis-hash>:<base58-program-id>
```

The literal `wokenet:v1` binds the application protocol namespace and version;
it does not name a separate blockchain. Human labels such as `localnet`,
`devnet`, or `mainnet-beta` are display/configuration hints, not cryptographic
deployment identifiers. Clients MUST compare the observed Solana genesis hash
and configured program ID before reading or signing. Pre-migration `solana:`
identifiers are invalid and MUST NOT be silently reinterpreted.

### Identity identifier

An identity URI is:

```text
wokesocialid:v1:wokenet:v1:<base58-genesis-hash>:<base58-program-id>:<base58-identity-pda>
```

The identity PDA remains stable when its root authority rotates. Wallet
addresses and delegated keys are attributes of the identity, not its public
display name.

### Portable object identifier

A portable object payload does not serialize its own identifier. Its identifier
is derived from its canonical unsigned payload:

```text
digest = SHA-256(JCS(payload))
id     = wokesocialobj:v1:<object-type>:<base64url-no-padding(digest)>
```

The `object-type` segment MUST match `payload.type`. References to a portable
object use the full identifier and SHOULD also carry a storage content
identifier.

### Other primitive encodings

| Value | Encoding |
| --- | --- |
| Solana public key, PDA, signature, and cluster genesis hash | Canonical base58; decoded length validated |
| Digest in JSON | Multibase base64url without padding, prefixed with `u` |
| Random nonce | 16 cryptographically random bytes, multibase base64url without padding |
| Timestamp | UTC RFC 3339 with exactly millisecond precision: `YYYY-MM-DDTHH:mm:ss.sssZ` |
| Integer | JSON integer in the interoperable safe range, unless the schema requires a decimal string |
| Token/base-unit amount | Unsigned base-10 string; no sign, separators, exponent, or leading zero except `0` |
| Language | Well-formed BCP 47 tag |
| MIME type | Lowercase registered type/subtype with separately validated parameters |
| URL | Absolute `https` URL unless a schema explicitly permits a content-addressed URI |

## Canonical serialization

Protocol v1 uses the JSON Canonicalization Scheme (JCS, RFC 8785) for portable
JSON payloads and proof descriptors.

Before canonicalization, an implementation MUST:

1. Validate the object against the exact schema version.
2. Reject duplicate JSON keys, invalid Unicode scalar values, `NaN`, infinity,
   negative zero, and numbers outside the schema's allowed range.
3. Require user-visible strings to be Unicode NFC. Canonicalization does not
   silently normalize them.
4. Enforce byte limits after UTF-8 encoding, not only character counts.
5. Reject unknown fields listed as critical and preserve all accepted unknown
   fields when relaying or reserializing.

The canonical byte sequence is UTF-8 JCS output without a byte-order mark or
trailing newline.

Binary media is never converted to JSON for hashing. Its digest is over the
exact validated binary bytes.

See
[ADR-0002](DECISIONS/0002-canonical-serialization-and-hashing.md).

## Signed object envelope

### Payload

Every signed portable object payload has these common fields:

```json
{
  "protocol": "wokesocial",
  "protocolVersion": "1.0",
  "schemaVersion": 1,
  "type": "post",
  "network": "wokenet:v1:<genesis-hash>:<program-id>",
  "author": "wokesocialid:v1:wokenet:v1:<genesis-hash>:<program-id>:<identity-pda>",
  "signingKey": "wokesocialid:v1:wokenet:v1:<genesis-hash>:<program-id>:<identity-pda>#delegation/<base58-public-key>",
  "createdAt": "2026-07-28T12:00:00.000Z",
  "nonce": "u<base64url-16-random-bytes>",
  "critical": [],
  "extensions": {},
  "content": {}
}
```

`content` is validated by the object-type schema. `extensions` keys use
reverse-DNS ownership, for example `org.example.feature`. A JSON Pointer listed
in `critical` means that a verifier MUST understand that field's semantics or
reject the object.

### Proof

The detached proof is not part of the portable object ID. It is stored beside
the payload:

```json
{
  "payload": {},
  "proof": {
    "algorithm": "Ed25519",
    "keyId": "wokesocialid:v1:wokenet:v1:<genesis-hash>:<program-id>:<identity-pda>#delegation/<base58-public-key>",
    "payloadHash": "u<base64url-sha256>",
    "signature": "u<base64url-signature>"
  }
}
```

The proof procedure is:

1. `payloadBytes = JCS(payload)`.
2. `payloadHash = SHA-256(payloadBytes)`.
3. Construct this proof descriptor without a signature:

   ```json
   {
     "domain": "woke.social/protocol/signed-object",
     "version": 1,
     "algorithm": "Ed25519",
     "keyId": "<payload.signingKey>",
     "network": "<payload.network>",
     "objectType": "<payload.type>",
     "payloadHash": "u<base64url-sha256>"
   }
   ```

4. `signingBytes = JCS(proofDescriptor)`.
5. Sign `signingBytes` using the key named by `keyId`.
6. Encode the signature as multibase base64url without padding.
7. Store `JCS({"payload": payload, "proof": proof})`.

A verifier MUST recompute the hash and object ID, require
`proof.keyId == payload.signingKey`, validate the signature, and validate that
the key was authorized for the object's required scope.

Protocol object signatures initially support Ed25519 only. Passkeys may protect
or authorize access to an account key, but WebAuthn assertions are not silently
treated as protocol object signatures. Adding P-256 or another algorithm
requires an explicit registry update and golden vectors.

### Key-validity time

For an anchored object, key validity is evaluated at the finalized slot of the
onchain reference. A verifier MUST reject a key that:

- was not delegated by that slot;
- lacked the required scope;
- had expired before the slot's chain time, subject to documented clock rules;
- was revoked at or before that slot; or
- does not belong to `payload.author`.

For an unanchored object, a client may verify against current finalized key state
but MUST label the result as unanchored and MUST NOT infer an authoritative
creation time from `createdAt`.

## Content addressing and storage receipts

The default content identifier for a signed JSON envelope is a CIDv1 using the
`raw` multicodec and `sha2-256` over the exact canonical envelope bytes. Its
textual form is the 59-character canonical base32-lowercase form. The exact
wire prefilter is
`^bafkrei[a-h][a-z2-7]{50}[aeimquy4]$`; implementations then parse the CID and
require version 1, `raw`, a SHA-256 multihash, a 32-byte digest, and an
unchanged canonical string. Case folding, alternate codecs/hashes, different
lengths, and noncanonical base32 padding are not accepted.

An onchain manifest locator is at most 200 visible ASCII bytes and uses exactly
one of these forms:

- `ipfs://<canonical-cid>`;
- `local://<canonical-cid>`;
- `ar://<43-character-transaction-id>/<canonical-cid>`, where the transaction
  ID matches `[A-Za-z0-9_-]{43}`; or
- `https://<credential-free-host>[:1-65535]/<one-or-more-nonempty-segments-ending-in-cid>`.

HTTPS host labels contain only ASCII letters, digits, or interior hyphens; path
segments are nonempty, and query strings, fragments, credentials, IPv6
authorities, and the characters `<`, `>`, `"`, `'`, and `\\` are rejected.
The program, protocol package, SDK, materializer, verifier, and storage
boundaries share this grammar. A malformed locator or inconsistent explicit
CID is terminal `manifest-uri` before provider I/O.

For media, the CID is over the exact validated file or deterministic rendition.
A media manifest carries each rendition's CID, SHA-256 digest, byte length,
MIME type, dimensions or duration, and accessibility metadata.

An Arweave transaction ID, HTTP URL, IPFS gateway URL, or local path is a
location hint, not an integrity identifier. A storage receipt records:

- object ID;
- canonical envelope CID;
- provider identity and adapter version;
- provider-specific locator;
- publication timestamp;
- byte length and digest;
- permanence policy and the user's recorded consent when applicable;
- replication and last verification status.

Consumers MUST download bytes, enforce size limits, recompute the content
identifier, then verify the signed envelope. A successful HTTP response or
provider receipt alone is insufficient.

The `"protocol": "wokesocial"` and `"network": "wokenet:v1:..."` values are the
frozen WokeSocial and WokeNet prelaunch v1 wire identifiers. They were renamed
before launch, so their current forms are canonical rather than old-brand
compatibility exceptions. `sociallywoke.com` is only a legacy redirect hostname
and is never an application origin.

## WokeNet program model

WokeNet is the WokeSocial Anchor program and associated portable protocol
deployed to Solana. Solana defines the account, PDA, SBF, transaction, fee, and
validator runtime. WokeNet is not a fork, validator, or separate ledger. See
[ADR-0009](DECISIONS/0009-wokenet-on-solana.md).

### PDA derivation

Every v1 PDA begins with two seeds:

```text
b"wokesocial", [0x01]
```

All integer seeds use fixed-width little-endian bytes. All digest seeds are full
32-byte SHA-256 values. Human-readable strings are never used directly as
unbounded seeds.

| Account | Remaining seeds | Status | Purpose |
| --- | --- | --- | --- |
| Protocol configuration | `b"config"` | Implemented | Version and aggregate counts for the current subset |
| Identity | `b"identity"`, `origin_authority_pubkey`, `identity_nonce[16]` | Implemented | Stable root whose PDA continues to include the immutable creation authority after root-authority changes |
| Follow edge | `b"follow"`, `follower_identity_pda`, `subject_identity_pda` | Implemented | Reusable, sequenced public follow state |
| Post reference | `b"post"`, `author_identity_pda`, `post_nonce[16]` | Implemented | Immutable manifest hash and locator commitment |
| Tombstone | `b"tombstone"`, `author_identity_pda`, `post_reference_pda` | Implemented | One deletion-intent record for the named author/post pair |
| Handle claim | `b"handle"`, `SHA-256(normalized_ascii_handle)` | Implemented | Globally unique v1 handle; the account also stores the exact normalized string so a digest collision cannot alias two handles |
| Delegation | `b"delegation"`, `identity_pda`, `delegate_pubkey`, `delegation_sequence_u64_le` | Implemented | Scoped, expiring, revocable device/session key bound to the issuing root-rotation epoch |
| Recovery policy | `b"recovery_policy"`, `identity_pda` | Implemented | Current-root-administered, sequenced guardian set, threshold, and checked slot delay |
| Recovery request | `b"recovery_request"`, `identity_pda`, `request_nonce[16]` | Implemented | Permanently retained request with immutable policy/root/identity/epoch/target snapshots, distinct approvals, and terminal state |
| Public block edge | `b"block"`, `blocker_identity_pda`, `subject_identity_pda` | Implemented | Reusable, sequenced public block state |
| Community | `b"community"`, `creator_identity_pda`, `community_nonce[16]` | Implemented | Stable community root with manifest and governance-strategy commitments |
| Community membership | `b"membership"`, `community_pda`, `member_identity_pda` | Implemented | Reusable membership state with member/moderator/admin role bits |
| Community role | `b"role"`, `community_pda`, `SHA-256(role_key)` | Planned | A separate extensible role/permission commitment; the current membership account stores only closed v1 role bits |
| Reaction | `b"reaction"`, `reactor_identity_pda`, `post_reference_pda`, `reaction_code_u8` | Implemented | Reusable add/remove state for one of four closed v1 reaction codes |
| Governance proposal | `b"proposal"`, `community_pda`, `proposal_manifest_sha256[32]` | Implemented | Immutable policy reference, eligible-member-count snapshot, bounded voting window, strategy/threshold snapshot, checked tallies, and terminal outcome |
| Governance vote | `b"vote"`, `proposal_pda`, `voter_identity_pda` | Implemented | One immutable vote per eligible identity and proposal; no token or wealth input |
| Payment configuration | `b"payment_config"` | Legacy, quarantined | Paused-by-default lamport ABI; cannot execute or be unpaused |
| Creator offering | `b"subscription_offering"`, `creator_identity_pda`, `offering_nonce[16]` | Legacy, quarantined | Historical weekly offering and split layout; not `$WOKE` |
| Payment receipt | `b"payment_receipt"`, `payer_identity_pda`, `receipt_nonce[16]` | Legacy, quarantined | Historical replay/accounting layout; not deployable payment evidence |
| Entitlement | `b"subscription_entitlement"`, `offering_pda`, `beneficiary_identity_pda` | Legacy, quarantined | Historical paid-through layout; cannot grant product access |

The implemented derivations have deterministic domain tests and are exercised
by the Anchor local-validator suite. The program uses the fixed development ID
`9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD`; no PDA in this table is evidence
of a devnet or mainnet-beta deployment. Planned rows remain seed designs until
implemented and tested.

### Handle rules

Protocol v1 handles are intentionally conservative:

- 3–30 ASCII characters;
- first character `[a-z0-9]`;
- remaining characters `[a-z0-9_]`;
- lowercase only;
- no leading/trailing underscore and no repeated underscores;
- global uniqueness enforced by the full 32-byte SHA-256 PDA seed and exact
  normalized-string comparison in account state.

A configurable reserved-name registry requires a versioned configuration
migration and is not part of the current account layout. Clients may warn about
locally reserved names, but must not represent that policy as onchain
enforcement.

Unicode is fully supported in display names. Unicode handles may be introduced
only with a separately versioned normalization and confusable-defense design.

### Implemented and planned instructions

| Instruction group | Current instructions | Status and invariants |
| --- | --- | --- |
| Protocol | `initialize_protocol` | Implemented: one-time configuration PDA creation and checked aggregate counters |
| Identity/profile | `create_identity`, `deactivate_identity`, `update_profile`, `update_profile_delegated`, `rotate_root_authority` | Implemented: stable origin-authority/nonce identity PDA, root-authorized one-way deactivation, dual-signed root rotation, checked rotation/identity/profile sequences, bounded hash/URI, and current-epoch profile delegation. Deactivation requires the exact config/identity PDAs, current root signer, supported account version, active state, and expected identity sequence; it advances the sequence once and clears `active` without closing or reassigning the identity |
| Social graph | `follow`, `unfollow`, `follow_delegated`, `unfollow_delegated` | Implemented: root variants remain stable; delegated variants require the exact follower identity/delegate account, current root-rotation epoch, `social` scope, inclusive slot expiry, and non-revoked state; all variants reject self-follow, validate relationships, and use checked actor/edge sequences |
| Content | `publish_post`, `tombstone_post`, `publish_post_delegated`, `tombstone_post_delegated` | Implemented: root variants remain stable; delegated variants require the exact author identity/delegate account, current root-rotation epoch, `post` scope, inclusive slot expiry, and non-revoked state; all variants preserve immutable post PDAs, hash/URI bounds, checked author sequences, and one tombstone PDA |
| Delegation | `create_delegation`, `revoke_delegation` | Implemented: closed scopes, expiry, explicit revocation, checked state/identity sequence, and invalidation on any root-rotation epoch change |
| Handles | `claim_handle`, `release_handle` | Implemented: current-root authority, exact normalized string plus full SHA-256 PDA seed, checked identity sequence on both transitions, collision detection, release to the current root authority, and bounded 3–30-byte state |
| Recovery | `configure_recovery_policy`, `disable_recovery_policy`, `request_recovery`, `approve_recovery`, `cancel_recovery`, `execute_recovery` | Implemented onchain primitive: root-only policy administration, guardian-created requests and distinct approvals, current-root cancellation, checked delay/threshold, arbitrary executor, required target-root signature, and rotation-epoch delegation invalidation |
| Public blocks | `set_block`, `set_block_delegated` | Implemented: root variant remains stable; delegated variant requires exact identity, current root-rotation epoch, `social` scope, inclusive slot expiry, and non-revoked state; both reject self-block and reuse a checked actor/edge state |
| Communities | `create_community`, `update_community_governance`, `set_community_membership` | Implemented subset: creator-root or community-scoped delegation for membership, manifest/governance commitments, reusable member state, and closed role bits; stored roles do not yet grant authorization |
| Reactions | `set_reaction`, `set_reaction_delegated` | Implemented: root variant remains stable; delegated variant requires exact identity, current root-rotation epoch, `social` scope, inclusive slot expiry, and non-revoked state; both enforce four closed reaction codes, target-post validation, tombstone rejection on add, reusable remove/re-add state, and checked sequences |
| Governance proposals/votes | `create_proposal`, `cast_vote`, `finalize_proposal` | Implemented conservative subset: one active member/one immutable vote, full-digest proposal uniqueness, numeric eligibility snapshot, checked actor/membership/proposal/community sequences, bounded slots, fixed strategy-compatible quorum/approval, and permissionless one-time finalization |
| Legacy payments (quarantined) | `initialize_payment_config`, `update_payment_config`, `rotate_payment_authority`, `create_subscription_offering`, `retire_subscription_offering`, `send_woke_tip`, `settle_subscription` | Historical lamport ABI with regression tests. It must remain paused, cannot execute or be unpaused, and is not `$WOKE`. A future asset requires a real mint and new mint-aware ABI |

### Delayed guardian recovery

Recovery is additive: it does not change any existing v1 account layout or
instruction/event discriminator. `RecoveryPolicy` is a 264-byte account with
`version`, configuration and identity keys, `policy_sequence`, a bounded
guardian vector, `threshold`, `delay_slots`, update slot, active flag, and PDA
bump. A policy has 2–5 distinct nonzero guardians, excludes the current root,
requires a threshold from 2 through the guardian count, and bounds its delay
from 2 through 1,000,000 slots. Only the identity's live root signer may
configure or disable it. Either transition advances both the policy sequence
and the identity sequence, so every pending request under the previous
configuration becomes stale.

`RecoveryRequest` is a 272-byte account. A policy guardian creates it and
becomes its first approval. The account permanently snapshots:

- the policy PDA and sequence;
- the current root authority;
- the identity sequence and root-rotation count;
- the target root authority and 16-byte nonzero request nonce;
- the threshold, guardian count, request slot, and checked execution slot.

Approvals use the guardian's index in the snapshotted policy as a five-bit
bitmap. The program rejects non-guardians, duplicate guardians in a policy,
duplicate approvals, out-of-range or inconsistent bit/count state, substituted
policy/request/identity PDAs, zero or unchanged target roots, stale policy,
root, identity-sequence, or rotation-epoch snapshots, and checked slot or
counter overflow.

The live current root may cancel any still-pending request for its identity,
including one already stale after an ordinary rotation or policy change.
Cancellation advances the identity sequence and records a terminal slot. Once
the delay has elapsed and the distinct-approval threshold is met, any executor
may submit execution, but the exact snapshotted target root must also sign.
Execution performs the same root-authority, identity-sequence, and
root-rotation-count transition as ordinary rotation. Existing delegations name
their issuing root and rotation epoch, so all delegations from the displaced
root fail immediately.

Recovery policy accounts are retained and may be reconfigured or disabled by a
later current-root action. Recovery request accounts are never closed or
reinitialized: `Cancelled` and `Executed` are immutable terminal states, which
keeps a nonce from becoming reusable and makes replay explicit. This is an
onchain delayed-guardian recovery primitive only. It does not implement
passkeys, email recovery, vendor identity proofing, or custodial key storage,
and no such offchain mechanism is authoritative over the program.

### Executable community governance

The only executable strategy in the current program is committed by
`SHA-256("wokesocial:governance:one-active-member-one-vote:v1;quorum-bps=5000;approval-bps=5001;abstain=quorum-only")`,
whose digest is
`2e67b50438203806e3ee22b80f058398240aede19f76a26cb0a629d0eab390d3`.
It fixes quorum at 5,000 basis points and approval at 5,001 basis points.
Proposal creation fails if the community commits to another strategy or the
caller supplies different thresholds.

`create_proposal` requires the community creator identity's current root or a
current-epoch, unexpired, non-revoked `community` delegation. It validates the
proposal manifest, checks both the creator identity sequence and the
community's last creator sequence, snapshots the community's governance
version/hash and active-member count, and accepts only a window that:

- opens no earlier than the creation slot and at most 100,000 slots later;
- lasts from 2 through 1,000,000 slots; and
- uses the half-open interval `[opens_at_slot, closes_at_slot)`.

The full proposal-manifest digest is part of the PDA. The account is never
closed, so the same digest cannot be proposed twice for one community even
after rejection. A strategy update after creation does not rewrite or
invalidate an existing proposal's immutable strategy snapshot.

The member-count snapshot is deliberately conservative rather than a historical
membership Merkle root. A voter must present the deterministic membership PDA,
the membership must currently be active with the v1 member bit, and its last
update slot must be no later than the proposal creation slot. Its recorded
community-authority sequence must also be strictly earlier than the proposal's
creator sequence, which preserves ordering when both transactions land in the
same slot. These checks reject members added or reactivated after the snapshot.
They also disqualify a member whose role record changed after the snapshot, even
if the member bit remained set; a future richer snapshot design must use a new
additive account family. The voter signs with the identity's current root or a
current `social` or `community` delegation. The vote PDA is permanently unique for
`(proposal, voter_identity)`, so votes cannot be replaced, multiplied by
delegates, or weighted by token holdings, balances, stake, or payment.

Anyone may call `finalize_proposal` at or after the close slot, exactly once.
Checked `u64` counts and `u128` cross-products avoid division and overflow:

```text
participating = yes + no + abstain
decisive      = yes + no
quorum_met    = participating * 10_000 >= eligible * quorum_bps
approval_met  = decisive > 0
                && yes * 10_000 >= decisive * approval_bps
accepted      = quorum_met && approval_met
```

Abstentions therefore count toward quorum but not approval. An abstention-only
or zero-participation proposal has a false approval result and is rejected
without a zero-denominator operation. Proposal and vote accounts remain as
replay evidence and have exact v1 allocations of 463 and 195 bytes.

The deployed-shape v1 `Community` account has no active/deactivated field, and
its 392-byte layout is preserved exactly. For this implemented subset, a valid
versioned Community PDA is active by definition; only the creator identity has
an enforceable active bit. Community deactivation must not be inferred from
existing fields. A future lifecycle feature requires a separately versioned,
additive community-status account (for example `CommunityLifecycleStatus`) and
an explicit migration/indexer rule. Likewise, the exact 91-byte
`ProtocolConfig` layout has no governance counters, so proposal/vote totals are
not appended there.

Account closing MUST name the expected beneficiary, require the same authority
as creation or a stricter governed authority, and preserve any event or
tombstone needed for replay. Closing must never make an identifier reusable in a
way that permits impersonation.

`release_handle` closes the claim to the identity's current root-authority
signer only after exact PDA, identity, normalized-string, digest, and expected
identity-sequence checks. `HandleReleased` preserves the released identity,
handle, digest, sequence, authority, and slot for ledger replay. A later claim
may reuse the address, so clients must distinguish current account ownership
from historical identity and must not imply that an earlier holder endorses a
later one.

The v1 `PostReference` allocation has no reserved bytes. Reply, quote, and
repost targets therefore remain offchain signed-manifest relationships in this
version. Adding target fields to the existing account would break
deserialization of deployed v1 accounts; compact onchain targets require a
separately versioned post-reference or relation account with an explicit
migration and corresponding indexer support.

### Events

Every program event includes:

- `event_version: u16`;
- `protocol_config: Pubkey`;
- relevant identity or community PDAs;
- the instruction-specific nonce or target digest;
- the new state version or revision;
- fields sufficient to locate and validate the affected account.

The indexer adds source provenance:

```text
network genesis hash
program ID
slot
blockhash
transaction signature
instruction index
event index
commitment/finality
```

The implemented Anchor IDL currently emits `ProtocolInitialized`,
`IdentityCreated`, `IdentityDeactivated`, `ProfileReferenceUpdated`, `PostReferencePublished`,
`FollowStateChanged`, `PostTombstoned`, `RootAuthorityRotated`,
`DelegationCreated`, `DelegationRevoked`, `BlockStateChanged`,
`CommunityCreated`, `CommunityGovernanceUpdated`,
`CommunityMembershipChanged`, `ReactionStateChanged`, `HandleClaimed`,
`HandleReleased`, `ProposalCreated`, `VoteCast`, `ProposalFinalized`,
`RecoveryPolicyConfigured`, `RecoveryPolicyDisabled`, `RecoveryRequested`,
`RecoveryApproved`, `RecoveryCancelled`, `RecoveryExecuted`,
`PaymentConfigInitialized`, `PaymentConfigUpdated`,
`PaymentAuthorityRotated`, `SubscriptionOfferingCreated`,
`SubscriptionOfferingRetired`, `WokeTipSettled`, and
`SubscriptionSettled`.
Handle events bind the claim PDA, identity, acting current
root authority, exact normalized handle, full SHA-256 digest, checked identity
sequence, and transition slot. The other event fields bind the configuration
and relevant accounts, event version, sequence or nonce, authority, manifest or
strategy data where applicable, and source slot. The resulting Anchor surface
has 33 event types. `IdentityDeactivated` binds the configuration, identity,
current root authority, incremented identity sequence, event version, and
transition slot. The six recovery events bind the version,
policy/request/identity relationships, relevant signer, snapshot sequences,
threshold/approval state, target or previous/new root, and transition slot.
Successful recovery execution also emits the existing `RootAuthorityRotated`
event. The production indexer decoder is pinned to this exact 33-event surface:
its drift gate compares the complete name set, discriminators, ordered fields,
and relevant enum variants against the generated IDL. It ingests all six
recovery events into deterministic memory and PostgreSQL policy/request
projections. Those projections are explicitly non-canonical: a projected
`pending` request means no terminal event was observed and is not an assertion
that the current WokeNet accounts still make the request executable.
`IdentityDeactivated` is decoded and materialized exactly by both memory and
PostgreSQL projections. It advances only the current active identity at the
next sequence and records immutable deactivation provenance. Historical
authorization remains position-aware; new identity-authorized actions fail
after retirement. A profile reference that was already durably pending may
hydrate after deactivation only as retained historical state; it cannot
reactivate the identity or restore public person discovery.

`ProposalCreated` records the immutable strategy, thresholds, eligibility
count, manifest, authority, window, and checked creator/community/proposal
sequences. `VoteCast` records the immutable choice, voter/membership/authority,
checked sequences, and all post-vote counts. `ProposalFinalized` records the
final counts, participating and decisive denominators, threshold results,
terminal outcome, permissionless finalizer, sequence, and slot. The quarantined
legacy payment flows emit seven versioned events covering configuration,
authority, offering, tip, and subscription transitions. Their projections
retain raw finalized-event provenance for migration/regression purposes and
must not assert a usable `$WOKE` asset, current paid access, or permission to
execute the legacy ABI.
Current names and layouts remain experimental until the wider cross-language
conformance fixtures are stabilized.

## Portable object model

### Object placement, authorization, revision, and deletion

| Object | Canonical representation | Required signer/authority | Revision rule | Deletion semantics |
| --- | --- | --- | --- | --- |
| Identity | WokeNet identity account and events | Root authority or valid recovery execution | Monotonic state version | Root-authorized v1 deactivation is one-way and leaves the account/history intact; identity URI is never reassigned |
| Profile | Signed profile manifest plus latest onchain reference | `profile` delegation or root | New immutable manifest points to previous ID | Tombstone/suppress old profile; history may remain replicated |
| Handle claim | WokeNet PDA | Identity authority | Release then new claim under anti-impersonation policy | Release does not erase history |
| Delegation | WokeNet account/event | Root or scoped recovery authority | Add/revoke; never mutate a key into broader scope | Revocation retained in replay history |
| Follow edge | WokeNet PDA/event for public portable follows | `social` delegation or root | Create/remove idempotently | Removal event closes active edge; history remains |
| Block edge | Optional public WokeNet edge; otherwise encrypted private export | `social` delegation or root | Create/remove | Official clients enforce active edge; private lists remain private |
| Mute preference | Encrypted client data/export only | User device | Mutable local preference | Local/provider purge |
| Post | Signed post manifest plus optional onchain reference | `post` delegation or root | Immutable | Author tombstone and provider deletion requests |
| Post revision | Signed post with `revisionOf` and `previousRevision` | Same identity as original | Append-only chain; forks explicitly represented | Tombstone any revision or logical thread |
| Reply | Signed post with `replyTo` | `post` delegation or root | Same as post | Same as post |
| Quote | Signed post with `quoteOf` | `post` delegation or root | Same as post | Quoted content's tombstone respected independently |
| Repost | Signed interaction; optional onchain reference | `social` or `post` delegation | Unique active assertion per actor/target | Retraction assertion or onchain removal |
| Reaction | Signed interaction; optional onchain PDA | `social` delegation | Replace/retract explicitly | Retraction/removal |
| Bookmark | Encrypted private client data/export by default | User device | Mutable | Local/provider purge; never public by default |
| Media manifest | Signed portable manifest | `post` delegation or referenced post author | New rendition manifest references predecessor | Tombstone plus provider deletion where possible |
| Community | WokeNet root plus signed metadata | Community creation permission/root authority | Monotonic config version | Deactivate; identifier not reassigned |
| Community membership | WokeNet account/event for portable public membership; encrypted record for private membership | Member and/or configured community permission | State transition with version | Leave/remove; private history minimized |
| Community role | Onchain permission commitment plus signed role document | Authorized community admin | New version/hash | Retire role; audit events remain |
| Community rule set | Signed policy object referenced onchain | Authorized community admin | Immutable revision chain | Replace/tombstone; prior signed rules remain auditable |
| Moderation label | Signed provider assertion | Key authorized by named provider | Superseding assertion or expiry | Retraction label; consumers apply policy |
| Report | Encrypted operator record; optional non-sensitive receipt hash | Reporting user | Append-only evidence choices and status | Retention policy and reporter deletion rights where lawful |
| Appeal | Encrypted operator/community record; optional receipt | Affected identity | Append-only decision trail | Retention policy; never expose sensitive evidence publicly |
| Governance proposal | WokeNet root plus signed proposal body | Community creator root or current `community` delegation | Immutable terms; a different full manifest digest is a new proposal | No current cancel/close path; terminal record remains |
| Governance vote | WokeNet vote state/event | Snapshot-eligible active member root or current `social`/`community` delegation | Immutable one-per-identity vote; replacement is not supported | Vote and finalized tally history retained |
| Future creator offering | Signed terms plus an optional replacement-ABI commitment | Future approved `payment` delegation or root | New terms version; no retroactive rewrite | Retire offering; legacy offering records remain non-entitling |
| Future subscription entitlement | Replacement-ABI settlement or independently verifiable approved receipt | Future program-validated payer/recipient | Period-specific | Expiry/refund status; legacy entitlement records never grant access |
| Future tip receipt | Replacement WokeNet program event | Payer | Immutable | Cannot erase approved settlement; quarantined legacy events are regression data only |
| Event | Signed social-event manifest; future paid-ticket settlement requires the approved mint-aware ABI | `post`/community authority | Immutable revisions | Cancel/tombstone; future payment/refund metadata retained |
| Notification preference | Encrypted client/operator preference | User device/session | Mutable | Immediate local/provider purge |
| Deletion tombstone | Signed object and, for anchored content, WokeNet PDA/event | Original author or defined community authority | Immutable; correction is a separate scoped assertion | Official clients/indexers suppress named targets |

Public membership and block visibility are explicit choices. A client MUST NOT
publish a private membership, bookmark, mute, or block list merely to improve
portability.

## Core manifest schemas

The profile, post, and tombstone snippets below match the current strict Zod
schemas in `packages/protocol`. They are illustrative instances, not a substitute
for distributable JSON Schemas or conformance fixtures. Media-manifest support
remains a planned extension.

### Profile schema transition

Portable profile history has two readable shapes within protocol version
`1.0`. Schema v1 is frozen for verification of existing signed bytes; the
current creation surface emits only schema v2, whose protected pronoun, gender,
chosen-family-label, and location values must use encrypted references.

Each WokeNet deployment fixes one immutable
`INDEXER_PROFILE_V2_ACTIVATION_SLOT`. A historical profile-update event without
the appended schema commitment may reference a legacy schema-v1 profile only
before that slot. An event with an explicit commitment must declare schema v2
at every slot, and an event at or after activation must carry that commitment
and reference a schema-v2 envelope. The indexer's live verifier and exact-source
rebuild use the same event-slot gate. The portable reader remains able to
decode v1 so historical IDs and signatures do not change, but that
compatibility is not permission to publish a new v1 profile.

The current WokeSocial program requires
`profile_schema_version = CURRENT_PROFILE_SCHEMA_VERSION = 2` in both root and
delegated update instructions and appends the value to
`ProfileReferenceUpdated`. The legacy event prefix remains decodable only for
historical pre-activation data. The manifest digest, locator, and schema
commitment are therefore bound by the same canonical onchain event.

### Profile content

```json
{
  "displayName": "Alex Rivera",
  "bio": "Community organizer and photographer.",
  "pronouns": [
    {
      "visibility": "public",
      "value": "they/them"
    }
  ],
  "gender": {
    "visibility": "followers",
    "valueReference": {
      "cid": "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
      "digest": "uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "bytes": 96,
      "mediaType": "application/octet-stream",
      "protection": {
        "kind": "encrypted",
        "encryptionFormat": "wokesocial-sealed-profile-value-v1",
        "keyEnvelope": {
          "id": "wokesocialobj:v1:media-manifest:uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        },
        "accessPolicy": {
          "id": "wokesocialobj:v1:community-rule-set:uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        }
      }
    }
  },
  "chosenFamilyLabels": [
    {
      "visibility": "public",
      "value": "chosen sibling"
    }
  ],
  "links": []
}
```

Chosen name is independent of legal name. Pronouns, gender, chosen-family
labels, and location use the same strict visibility union. Only a `public`
attribute may contain an inline `value`. A `followers` or `private` attribute
must contain a `valueReference` whose required protection is
`{"kind":"encrypted", ...}` with a named encryption format, key envelope, and
access policy. Raw protected plaintext, an unprotected reference, and the
legacy `genderVisibility` field are invalid. Gender, sexuality, pronouns, legal
identity, and other sensitive attributes are optional and never inferred.

### Post content

```json
{
  "format": "plain",
  "body": "Hello, decentralized world.",
  "media": [],
  "language": "en",
  "contentWarnings": [],
  "accessibility": {
    "altTextReminderAcknowledged": false,
    "captionReferences": []
  },
  "visibility": {
    "kind": "public"
  },
  "authorLabels": [],
  "replyPolicy": "anyone",
  "quotePolicy": "allowed"
}
```

At least one of an inline bounded `body`, `bodyReference`, or media item is
required. The current `markdown` value is a declared format, not an implemented
renderer contract; clients must continue to treat arbitrary HTML, scripts,
unsafe embeds, tracking pixels, and dangerous URL schemes as forbidden.

### Planned media manifest content

The following is a future schema sketch and is not accepted by the current
portable-payload union:

```json
{
  "sourceDigest": "u...",
  "mediaType": "image",
  "renditions": [
    {
      "role": "display",
      "cid": "bafy...",
      "sha256": "u...",
      "byteLength": "248193",
      "mimeType": "image/avif",
      "width": 1280,
      "height": 960,
      "durationMs": null
    }
  ],
  "accessibility": {
    "altText": "Two friends holding signs at a sunny community march.",
    "captions": [],
    "transcript": null
  },
  "processing": {
    "profile": "wokesocial-media-v1",
    "metadataStripped": true,
    "processor": "self"
  },
  "storagePolicy": {
    "class": "deletion-compatible",
    "permanentStorageConsent": false
  }
}
```

Clients verify MIME type from bytes, not filename or response headers. Each
rendition is independently hashed and bounded.

### Tombstone content

```json
{
  "target": {
    "id": "wokesocialobj:v1:post:ujOrBjnUJaGYhNMmIlg-7sf4OeeDi5JvznJnZo_DF6PM",
    "cid": "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"
  },
  "reason": "author-deleted",
  "explanation": "Removed by the author."
}
```

Public tombstones SHOULD use broad, nonsensitive reason codes. Detailed
moderation evidence or personal explanations are not included.

The canonical suppression signal for an anchored post is the authenticated
finalized `PostTombstoned` event and its target. Optional legacy tombstone
object/CID/payload-hash fields are all-or-none detached audit metadata. A
conforming indexer does not fetch those optional bytes and MUST NOT let their
absence, corruption, or provider outage delay suppression, identity-sequence
advancement, or checkpoint progress.

## Authorization

### Root authority

An identity account names its current root authority. Its recovery commitment
lives in the separately versioned deterministic `RecoveryPolicy` PDA so the
existing identity layout remains unchanged. Root authority actions are
intentionally rare. Routine posting and social actions use scoped, expiring
delegated keys.

### Delegated key

A delegation records:

- identity PDA and delegated Ed25519 public key;
- an explicit set of scopes;
- creation slot;
- optional not-before and expiry bounds;
- revocation slot when revoked;
- device label hash only if it cannot be used as a public fingerprint;
- monotonically increasing delegation version.

Delegations cannot create broader delegations unless a separately reviewed
scope expressly allows it. The reserved future `payment` scope and
`recovery-admin` are never implied by another scope; the former cannot enable
the quarantined ABI.

### Community authority

Community permissions are evaluated from a versioned role policy commitment.
Emergency moderation permissions are narrow, time-bounded, logged, and require
mandatory review. The executable v1 governance subset is strictly one active
member/one vote; token balance is never a governance weight.

### Replay resistance

- Nonce-addressed creation instructions use a 16-byte client nonce committed
  into a PDA; governance proposals instead commit their full 32-byte manifest
  digest, making duplicate semantic proposal creation permanent and explicit.
- Signed payload nonces prevent byte-identical accidental replay.
- Future approved mint-aware payment instructions bind payer, exact token
  program/mint/accounts, recipient, amount, offering, period, fee policy, and a
  unique receipt nonce. The legacy ABI is rejected before transfer.
- Message envelopes use a conversation/session-specific monotonic or
  cryptographically unique replay identifier defined by the selected audited
  messaging protocol.
- A transaction retry reuses the same semantic nonce so duplicate execution
  fails or resolves idempotently.

## Revisions and conflict rules

Portable content is immutable. An edit publishes a new object with:

- `revisionOf`: the first object in the logical revision family;
- `previousRevision`: the revision the author observed while editing.

If two revisions name the same predecessor, the history has a fork. Clients do
not silently choose by wall-clock time. The author may publish another revision
that explicitly selects or merges a branch. An onchain latest-reference update,
when used, must carry a monotonic state version and expected previous digest to
prevent lost updates.

Profile and policy references use compare-and-set semantics:

```text
expected_current_digest -> new_digest
```

The program rejects a stale expected digest.

## Deletion and revocation

Deletion has three distinct effects:

1. **Protocol intent:** a signed and, when applicable, onchain tombstone states
   that official consumers should no longer display the target.
2. **Projection suppression:** compliant indexers remove the body from normal
   queries and retain only minimal provenance needed to avoid resurrection.
   Optional tombstone-manifest bytes are detached, non-gating audit metadata.
3. **Provider deletion:** clients/operators request unpinning or erasure from
   providers that support it.

Deletion cannot guarantee removal from independent replicas, screenshots,
archives, a public WokeNet ledger, or permanent storage. Clients must present this limit
before permanent publication. A tombstoned object must not reappear after an
indexer rebuild.

Key revocation does not retroactively invalidate objects validly signed and
anchored before revocation unless the revocation explicitly identifies a
compromise interval under a versioned security policy. Consumers must display
that distinction.

## Indexer conformance

A conforming indexer:

1. verifies the configured genesis hash and program ID;
2. begins at the published deployment slot;
3. ingests versioned accounts/events idempotently;
4. tracks confirmed observations separately from finalized state;
5. fetches referenced bytes through one or more providers;
6. validates size, CID/digest, schema, signature, authorization, and tombstones;
7. stores source provenance on every projection row;
8. can delete projections and reproduce them from public inputs;
9. exposes checkpoint, lag, schema range, and verification status;
10. never labels missing or invalid bytes as a verified post;
11. persists exact accepted, pending, or terminal disposition for every
    manifest-bearing raw event;
12. drains due pending hydration in bounded batches independently of new chain
    events or checkpoint movement; and
13. during rebuild, skips provider I/O for an accepted manifest only when its
    durable accepted disposition and the complete event order prove it obsolete
    through a later profile pointer or tombstone, while retaining its raw
    sequence/reference/checkpoint effects.

Detailed replay behavior is in
[ADR-0004](DECISIONS/0004-indexer-projection-and-replay.md).

For profile history, conformance also requires a published, immutable
per-network `INDEXER_PROFILE_V2_ACTIVATION_SLOT`. Live ingestion and every
rebuild must accept legacy schema v1 only before that event slot and require
schema v2 at or after it. Two indexers that use different cutoffs are not
conformant projections of the same WokeNet history.

## Relay protocol boundary

A relay may carry:

- notification hints for public signed objects;
- typing and presence with short TTLs;
- live reactions and livestream signaling metadata;
- opaque end-to-end encrypted message envelopes;
- acknowledgements and delivery retry metadata.

A relay MUST NOT define final public state. Public notifications identify the
signed object or onchain event to reconcile. Message relay retention and visible
metadata must be published in a capability document.

`apps/relay` implements this advisory boundary with strict signed event and
subscription envelopes, bounded in-memory replay/retention state, fail-closed
key authorization, privacy-safe health/policy/metrics surfaces, and a
multi-endpoint client with verification, failover, reconnect, deduplication,
and relay-local gap detection. A production composition must inject current
finalized identity/delegation authorization; the standalone service otherwise
remains locked. Its explicit unverified loopback mode is never a production
authorization path.

No message-encryption scheme is selected or implemented by the relay. Messaging
is non-production until a proven library/protocol, device lifecycle,
one-to-one test suite, safety-number UX, attachment encryption, backup
behavior, and metadata analysis exist. Group messaging remains independently
feature-gated.

## Moderation assertions

A signed moderation-label object includes:

- provider identity and signing key;
- versioned taxonomy identifier;
- subject object or identity;
- label code and severity;
- scope and audience;
- created and optional expiry time;
- confidence category without fabricated precision;
- source category, not private evidence;
- superseded-label reference;
- appeal route descriptor.

Labels are assertions, not edits to a user's signed object. Clients disclose the
provider and combine:

1. personal blocks, mutes, keyword rules, and safety settings;
2. community rules and labels;
3. selected moderation providers;
4. the client/indexer operator's published lawful policy.

Sensitive evidence remains encrypted and offchain. Automated labels may
prioritize review, but irreversible enforcement requires the documented review
and appeal path except for cryptographically invalid payloads or clearly
automated technical abuse.

## Feed-provider interface

A feed response is nonauthoritative and carries:

- provider ID and endpoint;
- algorithm ID and semantic version;
- source indexer/checkpoint;
- ordered object IDs;
- per-item explanation factor codes;
- filtering policy and moderation providers applied;
- bounded opaque pagination cursor scoped to provider/version/checkpoint and
  carrying every deterministic ordering tie-break;
- response creation and expiry time.

The client re-applies blocks, mutes, tombstones, and sensitive-content controls.
It retains chronological and following-feed fallbacks and allows behavioral
personalization to be disabled.

### Current open-indexer convenience mapping

This subsection describes the current implemented read subset; it does not
replace the normative provider interface above or make an indexer response
canonical protocol state.

- `/v1/feed/home` remains a separate consumer-safe response for the configured
  default network.
- `/v1/feed` accepts an explicit network or resolves the operator-configured
  default and fails closed when neither exists. Each successful response declares
  `canonical: false`, projection provenance, recipe, checkpoint metadata, resolved
  network, and a null or exact public viewer scope.
- Chronological and following recipes return verified, public, non-tombstoned
  projections. Following is a public graph filter, not authentication, ownership
  proof, or authorization for nonpublic content.
- Each bounded opaque cursor carries the finalized-time/object-ID ordering
  position and is cryptographically scoped to the resolved network, recipe, and
  exact following viewer. A cursor cannot be reused across those scopes, and
  `nextCursor: null` is terminal.
- The reference web client requests fixed-size chronological pages, validates
  response size, shape, provenance, network/viewer scope, and cursor continuity,
  and exposes following only as an explicitly unauthenticated public-graph
  preview. It re-applies device-local exact-identity hiding.
- Media-only posts preserve verified media references in the read model, but the
  reference client does not yet fetch or play those references through a gateway.

Authenticated following, recommendation-provider integration, cross-device
safety, independent-provider conformance, public-cluster evidence, and complete
offline caching remain outside this implemented subset.

## Payments: quarantined legacy ABI and future replacement

No `$WOKE` mint exists. SOL and lamports are not `$WOKE`.

The portable signed-object asset schema is separate from executable program
instructions. It accepts `{ kind: "sol" }` for SOL or exact SPL token metadata
and rejects `{ kind: "woke" }`. This truthful metadata support does not create a
mint, authorize the legacy ABI, or establish an entitlement.

The checked-in payment account family and instructions are a legacy
lamport-denominated ABI. They are quarantined: the policy MUST remain paused,
the instructions MUST NOT execute or be unpaused, flagship clients MUST NOT
expose them, and their receipts/entitlements MUST NOT grant paid product access.
Tests of this ABI are historical regression evidence only.

Any future mint-aware payment instructions and receipts MUST:

- use integer base units and checked arithmetic;
- name the exact SPL or Token-2022 mint, token program, decimals, authorities,
  recipient token accounts, splits, fees, offering, period, and refund-policy
  hash;
- reject every unconfigured mint, token program, extension, and token account;
- derive or validate associated token accounts without recipient substitution;
- bind a unique receipt nonce to prevent duplicate settlement;
- compare simulation results to the transaction presented for signing;
- wait for finalized state before granting durable entitlement;
- never route funds through an application-controlled custodial hot wallet;
- use a new ABI/version and explicit migration boundary rather than re-enabling
  the legacy instructions.

### Quarantined legacy lamport ABI

The current program retains a deliberately narrow historical subset that used
System Program lamport transfers for direct tips and one-week creator
subscription accounting. It does not implement `$WOKE`, SPL/Token-2022
transfers, delegated payment signing, linked-wallet payment sources, gifts,
monthly or annual periods, automatic renewal, escrow, refund execution,
receipt/account closing, paid communities, paid events, or deployable payment
operation.

The frozen historical design allowed `PaymentConfig` creation only once by the
deployed program's verified upgrade authority, required the proposed payment
policy authority to cosign bootstrap, and started disabled. It specified exact
sequence updates, a maximum fee of 1,000 basis points, an explicit fee
destination, and dual-signed authority rotation. The current quarantine rejects
bootstrap, updates, rotation, execution, and unpause before any payment state or
balance changes. The retained IDL events are:

- `PaymentConfigInitialized`
- `PaymentConfigUpdated`
- `PaymentAuthorityRotated`
- `SubscriptionOfferingCreated`
- `SubscriptionOfferingRetired`
- `WokeTipSettled`
- `SubscriptionSettled`

The four payment account domains are:

| Account | PDA seeds after `["wokesocial", 1]` | Allocated bytes | Historical local-validator rent-exempt minimum |
| --- | --- | ---: | ---: |
| `PaymentConfig` | `["payment_config"]` | 133 | 1,816,560 lamports |
| `CreatorSubscriptionOffering` | `["subscription_offering", creator_identity, offering_nonce]` | 622 | 5,220,000 lamports |
| `PaymentReceipt` | `["payment_receipt", payer_identity, receipt_nonce]` | 457 | 4,071,600 lamports |
| `SubscriptionEntitlement` | `["subscription_entitlement", offering, payer_identity]` | 210 | 2,352,480 lamports |

The frozen legacy rules required the payment source to be the payer identity's
current root authority and a system account. They required tip/offering
destinations to resolve to recipient identity root system accounts and defined
alias/substitution checks, root-epoch staleness, and terminal retirement. These
rules survive only as historical layouts and regression constraints; the
runtime rejects the ABI before transfer.

Identity retirement does not implicitly release a handle, dissolve a
community, or retire a subscription offering. Because those cleanup actions
require an active identity in protocol v1, clients must complete them before
deactivation. Otherwise the resources and identifiers remain reserved or
frozen with their history intact; post-retirement cleanup requires a future,
explicitly versioned protocol transition rather than an indexer inference.

The historical offering layout was immutable after creation and committed its
manifest hash/URI, price, weekly interval, refund-policy hash, maximum protocol
fee, creator root epoch, and one to three canonically ordered recipient
identity/destination splits totaling 10,000 basis points. Refund behavior was
metadata only; no current instruction can create the offering, custody, or
return funds.

Historical fee/split regression logic uses checked `u128` intermediates. The
recorded formula is `floor(gross * fee_bps / 10_000)` with Hamilton
largest-remainder allocation and public-key-byte tie breaks. The current
runtime rejects the legacy instruction before allocation or any System Program
transfer.

The historical `PaymentReceipt` layout was permanent and shared one PDA
namespace across tip/subscription kinds. It specified snapshots of policy,
terms, payer root epoch, fee, allocation, refund commitment, and time with no
close path. The quarantined runtime creates no new payment receipt.

The legacy `SubscriptionEntitlement` layout is keyed by offering and beneficiary
identity. Its historical transition rules referenced an expected sequence,
604,800-second periods, a settlement count, a receipt, and a 52-week prepayment
bound. The quarantine prevents new transitions, and any retained historical
record must not grant product access. A replacement mint-aware ABI must define
new receipt and entitlement semantics.

A future `$WOKE` implementation additionally requires a real mint record,
reviewed mint/freeze authorities and extensions, distribution/tokenomics/legal
review, updated SDK/indexer/UI behavior, devnet rehearsal, adversarial tests,
independent audit, and explicit release approval.

## Privacy rules

The following MUST NOT appear in public accounts, events, signed public
manifests, public CIDs, or public logs unless a person deliberately publishes an
otherwise public field with informed consent:

- email addresses, phone numbers, IP addresses, and precise private locations;
- legal names, device fingerprints, WebAuthn attestation data, and recovery
  contacts;
- private messages, authentication secrets, private keys, and decryption keys;
- private memberships, bookmarks, mutes, blocks, notification preferences, and
  drafts;
- moderation evidence containing sensitive personal information.

Encryption does not make public-chain metadata private. A ciphertext, recipient
list, or key identifier can still reveal relationships and therefore does not
belong onchain merely because its body is unreadable.

## Versioning and forward compatibility

- `protocolVersion` uses `major.minor`.
- `schemaVersion` is an integer scoped to an object type.
- A minor protocol version may add optional noncritical fields or registry
  values.
- A major version is required for changed canonicalization, identifier,
  authorization, signature, or deletion behavior.
- All fields, including unknown accepted fields, are covered by the object hash
  and signature.
- An unknown item in `critical` causes rejection.
- An unknown noncritical extension may be stored and relayed unchanged, but a
  client does not invent semantics for it.
- Onchain accounts and events begin with an explicit version discriminator.
- Indexers publish the protocol, account, event, and object schema ranges they
  understand.
- Indexers publish the immutable network activation slot used to decide whether
  a historical profile event without the appended schema commitment may still
  reference schema v1. New root and delegated profile updates commit schema v2
  onchain, and explicit commitments other than v2 are rejected.

A migration plan must define dual-read/dual-publish windows, downgrade behavior,
and tombstone preservation before a new major version activates.

## Error classes

Implementations should expose stable machine-readable error codes in these
families:

| Family | Examples |
| --- | --- |
| `NETWORK_*` | Genesis mismatch, unsupported program, stale RPC |
| `SCHEMA_*` | Unknown critical field, size bound, invalid encoding |
| `HASH_*` | Payload digest or CID mismatch |
| `SIGNATURE_*` | Invalid proof, key mismatch, unsupported algorithm |
| `AUTH_*` | Missing scope, expired/revoked key, wrong community permission |
| `CHAIN_*` | Simulation mismatch, blockhash expiry, finality rollback |
| `STORAGE_*` | Provider unavailable, replication shortfall, permanent-consent missing |
| `PRIVACY_*` | Forbidden public field, unsafe audience, plaintext private content |
| `PAYMENT_*` | Legacy ABI disabled/unpause rejected; future mint/recipient/token-account mismatch, overflow, duplicate receipt |
| `RATE_LIMIT_*` | Sponsor, relay, upload, or API limits |

User interfaces translate these into actionable, nontechnical recovery states
without hiding the underlying verifiable reason.

## Required conformance fixtures

Protocol v1 cannot be released until the repository contains cross-language
golden vectors for:

- every common primitive encoding;
- JCS key ordering, Unicode, numeric edges, and rejected inputs;
- payload hashes, object IDs, proof descriptors, and Ed25519 signatures;
- valid, expired, insufficient-scope, and revoked delegations;
- every PDA derivation and seed boundary;
- every account and event version;
- every object schema, revision chain, and tombstone;
- content CID and media-digest verification;
- legacy execute/unpause rejection with unchanged state/balances, plus future
  mint-aware rounding, overflow, wrong token program/mint/account/recipient, and
  duplicate receipt;
- indexer replay, duplicate event, fork rollback, corrupt manifest, and missing
  provider behavior;
- unknown critical and noncritical extension handling.

Rust and TypeScript must consume the same checked-in fixture bytes. Generating
fixtures independently in each test suite is insufficient.

## Current protocol readiness

| Gate | Status | Evidence |
| --- | --- | --- |
| Versioned machine-readable schemas | Implemented for the current TypeScript v1 registry | Strict Zod schemas and builders cover all 29 current portable object families; a checked-in Draft 2020-12 signed-envelope artifact is generated from that registry and fails CI on drift. Rust consumption and cross-language conformance remain incomplete |
| Canonicalization library wrappers | Implemented for the current TypeScript object subset | RFC 8785/JCS wrapper tests cover deterministic bytes, NFC rejection, exact canonical-envelope decoding, and stable IDs |
| Cross-language golden vectors | Not implemented | None |
| Anchor program and IDL | Experimental local implementation | SBF build generates an IDL and TypeScript type for 41 instructions, 33 events, and 19 account families under development program ID `9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD`; legacy, identity-deactivation, recovery, and quarantined payment discriminators are frozen by tests |
| Account-size and transaction-cost analysis | Implemented for the current local subset | Serialization tests assert all 19 account layouts. The local-validator harness enforces transaction-size, compute, balance-conservation, substitution, replay, recovery, governance, and legacy payment bounds. These measurements are local Solana evidence only |
| Local-validator tests | Experimental local coverage | Flows cover root and delegated identity/social actions, handles, governance, delayed guardian recovery, and fail-closed legacy-payment quarantine including rejected bootstrap/execute/rotation/unpause with unchanged state and balances. No successful payment flow exists; the full cross-language, passkey/email product, future mint-aware, devnet, and mainnet-beta matrix remains incomplete |
| Public Solana deployment | Not performed | No WokeNet program is recorded on devnet or mainnet-beta |
| `$WOKE` mint and mint-aware ABI | Not implemented | No mint exists; the legacy lamport ABI cannot execute or be unpaused |
| SDK verification path | Partial | Operation-scoped signed provider-neutral publication plus eight IDL-aligned instructions, including one-way identity deactivation and quarantined legacy payment builders, exact-byte version-0/legacy transaction compilation, detached-signature verification, bounded strict Solana RPC parsing, same-byte broadcast/rebroadcast, finalized transaction confirmation, and injected finalized-account verification use explicit endpoint/genesis/program context. A complete generated client, flagship wallet/Mobile Wallet Adapter integration, executable-artifact attestation, replacement mint-aware ABI, and product wallet UX remain absent |
| Storage adapters and local CID verification | Implemented subset | Memory/local CAS, multi-provider quorum, IPFS HTTP/Kubo, and Arweave-compatible permanent-storage adapters are tested; no funded live Arweave uploader is configured |
| Rebuildable indexer | Experimental connected implementation | Finalized Solana RPC ingestion, exhaustive decoding/projection of all 33 current-IDL events, network-scoped checkpoints and identity references, canonical onchain profile-v2 commitment, exact CID/URI validation, accepted/pending/terminal disposition, checkpoint-independent bounded hydration, one-way identity deactivation with historical-only late profile hydration, non-gating tombstone metadata, suppression-aware destructive replay, read APIs including the bounded noncanonical feed mapping, PostgreSQL durability, and sixteen ordered migrations are implemented. Fork/reorg, independent-provider reconciliation, and production-scale rebuilds above 50,000 events remain incomplete |
| Alternate-provider conformance | Partial | Storage quorum/failover and real-loopback multi-relay failover/reconnect/deduplication are tested; independent RPC/indexer/feed conformance remains absent |
| Independent security review | Not performed | None |

No client or service may claim protocol-v1 conformance until these artifacts
exist and the relevant automated suites pass.

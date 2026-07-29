# ADR-0011: Member-signed community membership

- Status: Accepted for the predeployment protocol; product mutation flow
  remains incomplete
- Date: 2026-07-29
- Owners: Protocol, program, SDK, indexer, application, privacy, and security

## Context

The first community account shape let the community creator assign a member
state. That was useful for exercising governance, but it could not prove that a
person consented to join or leave. It also conflated member actions with
moderation, allowed a provider projection to look more authoritative than the
signed transition, and had no privacy-safe way to read one known public
membership without exposing a roster.

WokeSocial is a Solana dapp. WokeNet is its portable protocol, Anchor program,
and exact deployment namespace on Solana; it is not a chain, validator, RPC
network, or Firedancer deployment. Solana validators and RPC providers remain
external dependencies.

## Decision

### Portable membership object

`community-membership` schema version 2 binds:

- one exact WokeNet network;
- one exact Solana community account;
- one member identity;
- an action and its resulting state;
- exact roles; and
- an immutable replacement lineage.

The first transition must be a member-authored `join`. A member-authored
`join` produces `active` with exactly `roles: ["member"]`; a member-authored
`leave` produces `left` with `roles: []`. A separately authored `remove` or
`ban` requires a bounded nonblank moderation reason and produces `removed` or
`banned` with `roles: []`.

Schema version 1 authority-assigned membership objects remain readable and
verifiable as historical bytes. Current builders and signing APIs cannot create
them. Profile, community, and community-membership are the three object
families whose current creation schema is version 2; the portable registry
still contains 29 object families in total.

### Onchain transitions and authority

The membership PDA is deterministic for `(community, member identity)`.
`join_community` and `leave_community` authorize the member identity's current
root or a current-epoch, unexpired, non-revoked `community` delegation. This is
member consent: neither a community creator nor an indexer may manufacture a
join or leave.

Self-join is limited to communities whose finalized onchain visibility is
`public` or `unlisted` and whose effective membership policy is `open`.
Joining creates or reactivates the reusable membership PDA. Leaving requires an
active membership.

`moderate_community_membership` authorizes the community creator identity's
current root or a current `community` delegation. It can act only on an
existing member-bound PDA:

- `remove` is valid only from `active`;
- `ban` is valid from `active`, `left`, or `removed`; and
- a creator cannot moderate their own membership through this instruction.

The state machine is:

```text
absent -> active
active -> left | removed | banned
left -> active | banned
removed -> active | banned
banned -> terminal
```

Every transition validates the exact membership-state sequence, community
membership-policy sequence, community-wide membership sequence, and acting
identity sequence. It commits the exact signed membership-v2 manifest hash and
URI, increments the relevant counters, and emits
`CommunityMembershipChanged`. A stale snapshot, substituted account, repeated
action, overflow, unauthorized signer, or transition out of `banned` fails.

Governance proposals snapshot the community-wide membership sequence. A vote
requires an active membership whose `activeSinceMembershipSequence` is no
later than that snapshot. Eligibility therefore does not depend on transaction
slot ordering and cannot be acquired by joining after proposal creation in the
same slot.

### SDK and finality boundary

The SDK derives the exact member-bound PDA and builds the exact Anchor account
order and Borsh data for join, leave, remove, and ban. Its own-membership
publication path signs and stores the portable object before submitting the
matching program transition. A chain writer must reconcile the PDA before
submission and verify finalized state afterward, so a landed transaction whose
RPC response was lost can be retried without silently consuming another
sequence.

These SDK primitives do not select a WokeSocial identity, connect a browser
wallet or Mobile Wallet Adapter, approve fees, or establish product membership
on their own. A client must show the exact deployment, identity, action,
sequence snapshots, rent/fees, and absence of a `$WOKE` transfer; obtain
explicit wallet approval; wait for finalized confirmation; and then wait for
an indexer checkpoint covering that finalized transition.

### Privacy-safe projection

The public indexer offers only:

```text
GET /v1/community-memberships/{membershipAddress}?network=<exact-network>
```

This is an exact-address status lookup, not a roster. It returns a record only
when all of the following are true:

1. the parent community has a verified schema-v2 manifest;
2. its finalized visibility is `public` or `unlisted`;
3. its effective membership policy is `open`;
4. the exact membership-v2 manifest and program-event binding verify; and
5. the projection checkpoint covers the finalized update slot.

The response contains the community and membership addresses, portable
action/state/roles, non-identity sequence proofs, finalized transaction
provenance, update time/slot, and covering checkpoint. It never contains the
member identity, actor identity, signing authority, moderation reason, or
manifest location. There is no list, search, community-roster, actor, or member
filter endpoint.

Missing, unverified, private, restricted-policy, malformed, and
checkpoint-incomplete records return the same not-found response. This reduces
official-indexer amplification; it does not hide public Solana transactions or
prevent a party that already knows a community and identity from deriving the
deterministic PDA.

### Product and release boundary

The native Android client targets Solana Seeker and currently adds verified
community discovery only. It remains read-only for community membership. The
identity-selection, manifest-signing, simulation, Mobile Wallet Adapter
transaction approval, finalized-account verification, and indexer-catch-up
flow are not connected, so the app exposes no join/leave/moderation action.

The web product likewise has no completed wallet-backed community mutation
journey. No public WokeNet deployment exists. This decision and its local code
are predeployment evidence only; the release decision remains **NO-GO for
production**.

## Consequences

### Benefits

- A join or leave proves member authorization instead of creator assignment.
- Moderation remains explicit and cannot be disguised as a member action.
- A terminal ban has one unambiguous meaning across portable objects, program
  state, SDK reconciliation, and indexer projection.
- Optimistic sequence checks make stale UI and response-loss retries fail
  predictably.
- Governance eligibility uses a total order that remains sound within one
  Solana slot.
- An exact known public membership can be checked without providing a public
  roster or returning identity fields.

### Costs and limits

- Approval-required, closed, private, and restricted-community membership flows
  still need a separately designed authenticated/encrypted protocol.
- The current role surface is exactly `member`; richer scoped roles require a
  new versioned authorization design.
- Public membership activity remains observable on Solana.
- The public endpoint is a noncanonical convenience projection and can omit,
  delay, or censor a result.
- Flagship wallet and Seeker/Mobile Wallet Adapter mutation journeys remain
  incomplete.
- The community, membership, and proposal account/event ABIs changed under the
  development-localnet program ID. Migration `0018` refuses prior rows/events;
  disposable PostgreSQL state and the disposable local-validator ledger must
  both be recreated before using this version. There is no in-place public or
  irreplaceable-state migration.
- Local-validator tests do not establish devnet, mainnet-beta, Seeker-device,
  independent-audit, or production evidence.

## Rejected alternatives

- **Keep creator-assigned membership:** it cannot demonstrate member consent.
- **Treat an offchain join request as membership:** it is not finalized program
  state.
- **Let moderation call join or leave:** it would blur actor intent and
  authorization.
- **Allow re-entry after ban:** it would make a supposedly terminal safety
  decision ambiguous.
- **Publish a community roster:** it creates unnecessary social-graph and
  moderation privacy risk.
- **Trust an optimistic transaction or indexer response:** neither proves the
  exact finalized account transition.
- **Implement this as a WokeNet chain or Firedancer topology:** WokeNet is a
  Solana dapp/program namespace and operates no validator network.

## References

- [ADR-0004: Indexer projection and replay](0004-indexer-projection-and-replay.md)
- [ADR-0009: WokeNet on Solana](0009-wokenet-on-solana.md)
- [ADR-0010: Verified community discovery](0010-verified-community-discovery.md)
- `packages/protocol/src/community-schemas.ts`
- `programs/social_protocol/src/instructions/join_community.rs`
- `programs/social_protocol/src/instructions/leave_community.rs`
- `programs/social_protocol/src/instructions/moderate_community_membership.rs`
- `packages/sdk/src/community-membership.ts`
- `apps/indexer/migrations/0018_member_signed_community_memberships.sql`
- `packages/indexer-client/src/community.ts`

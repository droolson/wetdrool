# Open indexer

The indexer is a replaceable, non-canonical projection of finalized WokeNet
Solana-format events. It validates the configured genesis hash and
program, decodes the generated Anchor IDL event surface, verifies portable
manifests, and stores deterministic query models in PostgreSQL.

## Event compatibility

`pnpm --filter @wokesocial/indexer check:anchor-events` compares the checked-in production
decoder with `target/idl/social_protocol.json`. The check is exhaustive: the event-name set,
all 32 discriminators, every field in order, and enum variants must match. A new, removed, or
changed event fails the check. The six recovery event layouts and `RecoveryRequestState` variants
are included in this exact drift gate, as are the seven payment events, `PaymentKind`, and
`SubscriptionInterval`.

Program-owned `Program data:` with an unknown discriminator is never skipped. It is dead-lettered
as `unsupported-anchor-event`, and the finalized checkpoint stays behind that transaction until
the decoder is upgraded and replay succeeds.

## Phase-2 projections

Migration `0002_phase2_projection.sql` adds:

- protocol configuration anchors;
- root-authority history and current rotation epochs;
- scoped, expiring, revocable delegations;
- blocks;
- communities and governance history;
- community memberships and role masks;
- reactions; and
- optional transaction indexes for deterministic same-slot replay when RPC supplies them.

Signing-key authorization is evaluated at the event position, not against only the latest identity
row. Root history and delegation create/revoke positions make historical replay stable. A
delegation must match the root epoch at that position, include the required profile or post scope,
be unexpired, and precede any revocation.

The indexer evaluates delegated portable-manifest signatures at their exact event position.
On-chain delegated actions are projected from finalized program output, while root history,
delegation epochs, scopes, expiry, and revocation prevent a delegated envelope from substituting
for a root-authorized action.

Community manifest CIDs and hashes are anchored and exposed with `manifestVerified: false`. The
portable protocol package does not yet define a community envelope schema, so this indexer does not
invent one or claim signature/schema verification.

Migration `0003_handle_projection.sql` adds current global handle claims. Claim and release events
are bound to the exact normalized 3–30 byte handle, its SHA-256 digest, claim address, identity,
current root authority, and increasing per-identity sequence. Released claims remain durable
projection history but are excluded from active lookup; a later finalized claim may safely reuse
the exact released address/digest pair. Network-scoped unique constraints prevent simultaneous
duplicate handle names or claim addresses.

Migration `0004_governance_projection.sql` adds proposals and immutable per-proposal votes. The
projection enforces the canonical one-active-member/one-vote strategy, fixed quorum and approval
thresholds, the membership snapshot at proposal creation, exact account relationships, monotonic
community/voter/proposal sequences, half-open voting windows, post-event tallies, and deterministic
finalization arithmetic. Invalid events roll back both the projection mutation and the raw event
insert, so checkpoints cannot advance past substituted or contradictory governance state.

Proposal manifests are preserved as anchored URI/hash metadata with `manifestVerified: false`.
The portable protocol does not yet define a proposal envelope schema, so the indexer does not fetch
or interpret those manifests.

Migration `0007_recovery_projection.sql` adds the current projected recovery policy and retained
request lifecycles. The projection validates canonical policy/request PDAs, policy and identity
sequences, guardian snapshots and distinct approval bits, exact terminal relationships, and the
paired `RootAuthorityRotated`/`RecoveryExecuted` events in one transaction. Raw finalized events
remain the replay source.

Recovery rows are convenience views, never authorization decisions. In particular, projected
`pending` means only that no terminal event has been observed; it does not mean the request is
currently executable. Clients must read the WokeNet identity, policy, and
request accounts before signing or submitting recovery transactions.

Migration `0008_network_scoped_solana_addresses.sql` upgrades every projection
key whose value is a Solana-compatible address. Delegations, block edges,
communities, memberships, reactions, governance proposals and votes, and
recovery policies and requests can therefore reuse the same PDA or account
address on networks with different genesis hashes without colliding. Legacy
rows receive their network from their owning identity or community during the
forward migration. Raw-address API lookups require both an exact 32-byte base58
public key and an explicit canonical
`wokenet:v1:{genesis}:{program}` network identifier.

Migration `0009_network_scoped_identity_references.sql` binds each identity ID to its network and
address and replaces projection-table identity references with composite `(network_id, identity_id)`
foreign keys. A projection row therefore cannot attach an otherwise valid identity from another
genesis, including during direct database writes or populated-schema upgrades.

Migration `0010_payment_projection.sql` adds network-scoped payment configuration, subscription
offerings and recipient splits, permanent payment receipts and allocations, and renewable
subscription entitlements. Projection transitions require canonical PDAs, exact current identity
roots and rotation epochs, monotonic policy/offering/entitlement sequences, immutable receipt
nonces, current fee and offering snapshots, and exact weekly windows. Recipient amounts are
recomputed with the program’s Hamilton remainder rule and must conserve every lamport.

Receipts and entitlements retain finalized transaction/log provenance. They are convenience
projections only: the API does not infer a broader settlement outcome, refund status, or current
eligibility from their presence.

Migration `0011_public_search.sql` adds stored normalized search columns, exact/prefix B-tree
indexes, and `pg_trgm` GIN indexes for the bounded public-search projection. Search includes only
current profile display names and bios, one deterministic canonical active handle per identity,
and verified non-tombstoned public posts. It never indexes private messages, recovery state,
private profile fields, obsolete profile revisions, or community anchors. Communities remain
excluded until the indexer can verify a signed community manifest whose visibility is public.

The deterministic `public-match-v1` order ranks exact public identifiers and canonical handles
before current public text, then uses recency and Unicode code-point order for ties. Identifiers
are eligible only by exact or prefix match. Normalization is NFKC, collapses Unicode Separator
runs, trims surrounding spaces, and folds ASCII `A-Z` only; non-ASCII text is intentionally
case-sensitive so JavaScript behavior cannot vary with the database locale. The normalized query
must contain 3–120 Unicode code points and cannot contain control characters. Contains matching is
enabled only when the normalized term has an ASCII alphanumeric run of at least three characters,
which guarantees an extractable `pg_trgm` key; other valid terms, including punctuation-only,
emoji-only, and short `@` handle terms, remain exact/prefix-only on B-tree indexes.

Both HTTP routes cap results at 50, reject unknown input, apply a stricter search rate limit, and
echo the normalized query. Results and the projection checkpoint come from one repeatable-read
snapshot. PostgreSQL search has a dedicated two-connection read pool, an equal fail-fast
concurrency cap, and a 750 ms statement timeout; capacity exhaustion and cancellation return a
retryable `503` without consuming ingestion connections. Large operators should still measure
their own data and publish query-log retention before enabling public traffic.

## Rebuild safety

`OpenIndexer.rebuild` verifies and orders the complete immutable raw event set before replacing
materialized state. The memory store replays into an isolated replacement store and swaps state
only after every event succeeds. PostgreSQL clears and replays only materialized rows inside one
transaction; `protocol_events` and dead letters are retained, existing raw rows must match exactly,
and new raw rows roll back with any failed projection transition. A rebuild that omits or changes an
already-journaled event is rejected. `clearProjection` remains an explicitly destructive
test/operator primitive and is not used by rebuild.

Apply, rebuild, checkpoint advancement, and clearing are serialized per network. PostgreSQL uses a
transaction-scoped advisory lock derived from the full network ID; the memory store uses a FIFO
network-keyed mutex. Mutations for unrelated networks remain concurrent. A repeated raw coordinate
is idempotent only when its transaction position, timestamp, type, and complete event body match
exactly; any mismatch is reported as an immutable event conflict before projection state changes.

## APIs

In addition to verified feed and post routes, the service exposes replaceable projections at:

- `GET /v1/search/public?q=...` for the operator-configured network
- `GET /v1/search?network=...&q=...` for an explicit WokeNet
- `GET /v1/identities/{identityId}/security`
- `GET /v1/handles/{handle}?network=...`
- `GET /v1/identities/{identityId}/handles`
- `GET /v1/communities/{communityAddress}?network=...`
- `GET /v1/communities/{communityAddress}/proposals?network=...`
- `GET /v1/governance/proposals/{proposalAddress}?network=...`
- `GET /v1/governance/proposals/{proposalAddress}/votes?network=...`
- `GET /v1/governance/votes/{voteAddress}?network=...`
- `GET /v1/recovery/identities/{identityId}/policy`
- `GET /v1/recovery/identities/{identityId}/requests`
- `GET /v1/recovery/requests/{recoveryRequestAddress}?network=...`
- `GET /v1/reactions?network=...&postReference=...`
- `GET /v1/payments/config?network=...`
- `GET /v1/payments/offerings/{offeringAddress}?network=...`
- `GET /v1/payments/identities/{identityId}/offerings?network=...`
- `GET /v1/payments/receipts/{receiptAddress}?network=...`
- `GET /v1/payments/entitlements/{entitlementAddress}?network=...`

Every response is convenience state. WokeNet accounts, signed portable
objects, and finalized receipts remain the independently verifiable sources.

# Open indexer

The indexer is a replaceable, non-canonical projection of finalized WokeNet
Solana-format events. It validates the configured genesis hash and
program, decodes the generated Anchor IDL event surface, verifies portable
manifests, and stores deterministic query models in PostgreSQL.

## Runtime and migration roles

The long-running server is DML-only: it never creates tables or runs migrations.
Apply the schema in a separate one-shot step with a migration role:

```sh
DATABASE_MIGRATION_URL='postgresql://migration-role@database/wokesocial' \
  pnpm --filter @wokesocial/indexer migrate
DATABASE_URL='postgresql://runtime-role@database/wokesocial' \
  pnpm --filter @wokesocial/indexer start
```

`DATABASE_MIGRATION_URL` is mandatory for the migration command and is never
used by the server. The runtime rejects every nonempty
`*_DATABASE_MIGRATION_URL` or `*_DATABASE_MIGRATION_PASSWORD`, including
another service's credential from a shared bundle. Migrations take a PostgreSQL
session advisory lock before inspecting or changing schema state, so concurrent
one-shot jobs serialize. Production grants should give the runtime role only
the projection DML it needs, while the migration role owns DDL. With
`APP_ENV=staging` or `production` (or production Node mode), the migration URL
must contain exactly one `sslmode=verify-full`; weaker modes do not verify the
database hostname and are rejected.

Each migration ledger row includes the lowercase SHA-256 of its packaged SQL.
The applied rows must be an exact ordered prefix of a nonempty packaged set.
Unknown versions, gaps, reordering, missing checksums, and modified SQL fail
closed; no legacy checksum is inferred or silently backfilled. The runner
revokes runtime `INSERT`/`UPDATE`/`DELETE` access to `schema_migrations` before
integrity validation. See the legacy-volume procedure in
`docs/OPERATIONS.md`.

`CONTENT_STORAGE_PATH` must already be an accessible directory. The indexer
only reads referenced manifests, so its runtime mount can and should be
read-only. Local `setup:local` creates the development directory before
starting the server; operators must provision and populate durable storage
outside the runtime container.

`/healthz` reports process liveness. `/readyz` additionally checks PostgreSQL
and, when live synchronization is configured, remains unavailable until the
first successful finalized poll. It returns `503` after
`INDEXER_SYNC_STALE_AFTER_MS` without a successful poll or immediately after a
fatal worker exit. A fatal asynchronous worker exit also closes the HTTP
listener and database pool. The staleness budget must be greater than
`INDEXER_POLL_INTERVAL_MS`.

The packaged image defaults both `APP_ENV` and `NODE_ENV` to `production`.
Indexer configuration accepts `APP_ENV=staging` or `production` only with
`NODE_ENV=production`, and rejects production Node mode for local application
tiers. Both nonlocal tiers require `INDEXER_NETWORK_ID`,
`NEXT_PUBLIC_PROGRAM_ID`, nonlocal HTTPS origins and RPC URLs, verified
PostgreSQL TLS, and live synchronization. The runtime parser is indexer-only:
it does not load browser, Redis, sponsor, or IPFS-write settings, and it rejects
shared database passwords, moderation keys, media tokens, and relay bearer
tokens in nonlocal deployments. Local Compose explicitly sets both modes to
development.

## Profile schema activation

`INDEXER_PROFILE_V2_ACTIVATION_SLOT` is a protocol-compatibility boundary, not a
feature flag. Operators must assign one nonnegative value to each WokeNet and
keep it immutable for the lifetime of that network. A historical
`profile-updated` event without the appended schema commitment may reference a
frozen schema-v1 profile only before the cutoff. Every event with an explicit
commitment must declare schema v2, and every event at or after the cutoff must
carry that explicit v2 commitment and reference a schema-v2 envelope. The
portable protocol reader retains v1 support only so historical canonical
bytes, object IDs, and signatures remain verifiable.
The local default `0` therefore requires v2 at every valid event slot; a
network with preexisting v1 history must explicitly pin its real activation
slot before ingestion begins.

The live synchronizer and `rebuild:projection` pass the same cutoff to the same
manifest verifier. Changing the value during a rebuild would reinterpret the
durable event ledger and is prohibited. Record it with genesis, program ID,
deployment slot, release, and migration evidence.

The current WokeSocial program accepts only
`CURRENT_PROFILE_SCHEMA_VERSION = 2` for root and delegated profile updates and
appends that value to `ProfileReferenceUpdated`. The decoder retains the exact
legacy event prefix solely for pre-activation history. This makes new schema
commitments canonical onchain while the immutable activation slot determines
whether a legacy event without the appended field remains readable.

## Feed chronology and disclosure boundary

Chronological order uses the finalized `post-published` event `blockTime`, with
the protocol object ID as the deterministic tie-break. A signed manifest's
author-controlled `createdAt` remains verifiable metadata but cannot pin a post
to the future, backdate it out of a page, or shape a cursor. Pagination uses a
bounded opaque cursor containing both ordering fields, so posts sharing an
exact block time are neither skipped nor repeated.

The unauthenticated home and chronological feeds return only
`visibility.kind=public`. The current following endpoint is also public-only:
it filters public posts by a projected follow edge but does not claim that the
caller authenticated as the supplied viewer. Unlisted, followers-only,
restricted, and community-scoped plaintext require a future authenticated
policy path and never enter these convenience feeds.

## Event compatibility

`pnpm --filter @wokesocial/indexer check:anchor-events` compares the checked-in production
decoder with `target/idl/social_protocol.json`. The check is exhaustive: the event-name set,
all 33 discriminators, every field in order, and enum variants must match. A new, removed, or
changed event fails the check. The six recovery event layouts and `RecoveryRequestState` variants
are included in this exact drift gate, as are the seven payment events, `PaymentKind`, and
`SubscriptionInterval`.

`IdentityDeactivated` is decoded and projected with that same exact layout.
The projection requires the next identity sequence and exact config, identity,
root-authority, and event-position bindings; retirement is one-way. Historical
posts and authorization remain replay-verifiable, while new actions by the
retired identity fail closed and public person discovery omits it.

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

Migration `0012_profile_confidentiality.sql` adds the complete public profile
content projection. During upgrade it preserves only legacy pronoun entries
explicitly marked public; old followers-only/private plaintext is discarded.
New memory and PostgreSQL projections retain public pronouns, gender,
chosen-family labels, and location while leaving protected encrypted references
in the verified source manifest for authorized clients.

Profile replacement is ordered by the identity's exact next onchain sequence
and full event position, not slot alone. Sequential profile transactions in one
slot therefore project correctly, while repeated, skipped, or older sequences
fail before changing either memory or PostgreSQL state.

Migration `0013_identity_deactivation.sql` adds durable active/retired identity
state and exact identity-sequence event positions. It fail-closed backfills
retirement from immutable raw events, prevents later identity actions, and
preserves historical rows needed to verify actions that preceded deactivation.

Migration `0014_canonical_post_chronology.sql` fail-closed backfills every
existing post time from its unique immutable `post-published` event and rebuilds
the public chronology index with a stable C-collated object-ID tie-break. A
projected post without exactly one matching raw event blocks migration and must
be repaired or rebuilt from canonical data.

Migration `0015_terminal_manifest_quarantine.sql` records deterministic
manifest failures on the immutable raw event and links them to a non-retryable
dead letter. A terminal event therefore cannot block the network checkpoint,
silently become accepted on a later replay, or be inferred from an unrelated
dead-letter row.

Migration `0016_manifest_ingestion_state.sql` adds an explicit accepted,
pending, or terminal disposition to every manifest-bearing raw event.
Temporary content unavailability is durably pending: the indexer advances the
exact identity sequence and global checkpoint without exposing unverified
profile content or a feed-visible post. A later retry atomically promotes the
same fingerprint without advancing sequence twice; deterministic verification
failure atomically moves it to terminal quarantine. Deferred constraints keep
pending rows paired with retryable `manifest-unavailable` dead letters and
terminal rows paired with exact non-retryable failure codes.

Pending hydration is checkpoint-independent. After every synchronization poll,
including a poll with no new signatures and a checkpoint already at the
finalized tip, the worker selects at most `INDEXER_BATCH_SIZE` due records in
deterministic due-time/event order. It retries the exact immutable fingerprint,
promotes it without a second sequence advance, reschedules continued
unavailability with bounded backoff, or atomically converts a deterministic
verification failure to terminal. New finalized ingestion therefore neither
waits for content availability nor starves old due hydration.

A profile that hydrates only after its identity has been deactivated is
retained as historical, replay-verifiable profile state. Promotion does not
reactivate the identity, and public person search/discovery continues to
exclude it.

The content-reference boundary is shared with the program and SDK. A canonical
content ID is exactly a CIDv1 base32-lowercase string using the `raw` multicodec
and a 32-byte SHA-256 multihash; the textual prefilter is
`^bafkrei[a-h][a-z2-7]{50}[aeimquy4]$`, followed by full CID parsing.
Manifest locators are exactly `ipfs://<cid>`, `local://<cid>`,
`ar://<43-character-transaction-id>/<cid>`, or a credential-free
`https://host[:port]/.../<cid>` path with nonempty segments and no query or
fragment. A malformed URI, wrong codec/hash/length/case, or inconsistent
explicit CID is terminal `manifest-uri` before any storage-provider request.

Every finalized `tombstoned` event is different: its authenticated onchain
author/target is sufficient to suppress the post. Optional legacy
`tombstoneObjectId`/CID/payload-hash fields are all-or-none detached audit
metadata. The verifier never fetches them, so unavailable or deleted tombstone
bytes cannot gate suppression, identity-sequence advancement, or checkpoint
progress.

The runtime role can insert and read raw events but cannot update or delete
them. It receives only the two security-definer transitions needed to accept or
reject an exact pending fingerprint. Migration/maintenance credentials remain
separate.

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
already-journaled event is rejected. `clearProjection` clears materialized rows only; it deliberately
does not erase the raw ledger or dead letters and is not a substitute for the atomic rebuild path.

Apply, rebuild, checkpoint advancement, and clearing are serialized per network. PostgreSQL uses a
transaction-scoped advisory lock derived from the full network ID; the memory store uses a FIFO
network-keyed mutex. Mutations for unrelated networks remain concurrent. A repeated raw coordinate
is idempotent only when its transaction position, timestamp, type, and complete event body match
exactly; any mismatch is reported as an immutable event conflict before projection state changes.

Operators can validate the durable PostgreSQL ledger without mutating the live
projection:

```sh
pnpm --filter @wokesocial/indexer build
pnpm --filter @wokesocial/indexer rebuild:projection \
  --network 'wokenet:v1:<genesis-hash>:<program-id>'
```

The command re-parses every stored event, verifies that row metadata exactly
matches the serialized body, and replays the complete ordered ledger into an
isolated memory projection. Pending and terminal events preserve their durable
disposition without content I/O. Accepted manifests are re-fetched and
verified except when the complete ordered ledger proves that an explicitly
durably accepted post is followed by its tombstone or an explicitly durably
accepted profile pointer is superseded by a later profile pointer. Those
obsolete accepted manifests alone may skip provider I/O; replay still retains
their accepted raw state, sequence advancement, post reference where
applicable, and checkpoint while withholding obsolete materialized content.
Any other accepted event that cannot be fetched or now verifies as terminal is
disposition drift and fails closed. The command prints the event count,
first/last slots, and a deterministic ledger SHA-256 digest that includes
accepted, pending, and terminal state. An empty ledger or any inconsistency
fails closed.

Applying the validated rebuild is deliberately explicit:

```sh
pnpm --filter @wokesocial/indexer rebuild:projection \
  --network 'wokenet:v1:<genesis-hash>:<program-id>' \
  --apply \
  --confirm 'rebuild:wokenet:v1:<genesis-hash>:<program-id>'
```

Run all migrations first and take an operator-approved backup. Apply mode
performs the same shadow validation before acquiring the existing per-network
advisory lock and replacing materialized rows in one PostgreSQL transaction.
The immutable `protocol_events` ledger is retained, and any failure rolls the
replacement back. The content directory must be the same mounted storage used
when the manifests were ingested and must retain every accepted manifest that
is not eligible for the ledger-proven obsolete-content suppression above.

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

## Verification

The current package evidence is 184 passing unit cases across 20 files and 27
isolated PostgreSQL integration cases across the 11 files selected by
`test:integration`. The migration ledger contains sixteen ordered, checksummed
migrations. These results are Solana-format/PostgreSQL evidence; they do not
cover native Firedancer RPC, fork/reorg behavior, independent-provider
reconciliation, or production-scale rebuilds above the current 50,000-event
bound.

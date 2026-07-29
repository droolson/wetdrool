# WokeSocial SDK

`@wokesocial/sdk` contains provider-neutral client operations for WokeSocial.
It does not silently trust the flagship service or choose a Solana RPC
provider for the caller.

The implemented surface includes:

- recoverable signed-manifest publication through replaceable storage and
  transaction adapters;
- deterministic primary-identity coordinates, exact identity/post instruction
  builders, strict account decoders, operation-specific simulation verifiers,
  and response-loss-safe identity/post reconciliation;
- deterministic program-owned, member-bound community PDAs, exact join/leave/moderation
  instruction builders, and response-loss-safe membership publication;
- ordered provider health checks and failover;
- portable payment planning for SOL and explicitly allowlisted SPL assets;
- PDA derivation, instruction builders, and finalized-account verification for
  the checked-in WokeSocial Solana program; and
- exact-byte Solana transaction simulation, signing, submission, and bounded
  finalized confirmation.

## WokeNet deployment binding

WokeNet is the WokeSocial protocol/deployment namespace on Solana. It is not a
separate blockchain, RPC protocol, validator network, or native currency.

The historical `WokeNetContext` API binds an operation to:

- a Solana JSON-RPC endpoint;
- the endpoint's Solana genesis hash; and
- one deployed WokeSocial program address.

`createWokeNetContext` validates and normalizes those values. The context has no
implicit cluster default. A production client should compare multiple
independent RPC providers because a genesis-hash response alone cannot prove
that an RPC provider is honest.

The PDA helpers implement the program's versioned seeds for protocol and
payment configuration, identities, subscription offerings, payment receipts,
subscription entitlements, community memberships, and upgradeable-loader
program data.

## Passkey identity and text-post foundation

`derivePrimaryWokeIdentityCoordinates` assigns the v1 `primary-identity`
convention nonce to a root authority and derives the exact program identity
PDA. `buildCreatePrimaryWokeIdentityInstruction` and
`buildPublishWokePostInstruction` encode the checked-in Anchor ABI without
signing or submitting it. Post nonce, expected author sequence, manifest hash,
manifest URI, and derived post PDA remain explicit so an ambiguous retry can
reuse the same operation instead of addressing another post.

`decodeWokeIdentityAccount` and `decodeWokePostReferenceAccount` enforce exact
allocations, discriminators, bounded Borsh fields, canonical UTF-8, and zero
padding. The verification and reconciliation helpers additionally bind the
owner, PDA, context, commitment, immutable coordinates, authority, and
sequence. The simulation verifiers require one exact operation event and exact
fee/rent-only lamport effects.

These APIs deliberately stop at an injected account reader and the common
transaction boundary. They do not expose a production RPC writer, fund an
account, store a post envelope, retain a passkey-derived secret, or prove
indexer catch-up. A caller must pass the builder's `rentExemptionSpace` to
`executeWokeInstruction`, use the matching operation-specific simulation
verifier, verify finalized account state, and then verify the indexer
checkpoint and exact stored envelope.

## Member-signed community membership

`buildJoinCommunityInstruction` and `buildLeaveCommunityInstruction` encode the
exact Anchor account order and optimistic sequence snapshots for a member's
own identity. `buildModerateCommunityMembershipInstruction` can encode only
`remove` or `ban`; it cannot manufacture a join or withdrawal. Every builder
requires the hash and bounded URI of the exact signed membership-v2 manifest.

`PublicationPipeline.publishOwnCommunityMembership` signs and stores the
portable join/leave object before anchoring it. The injected chain writer must
reconcile the deterministic membership PDA before submission, so retrying a
landed transaction whose RPC response was lost does not consume another
sequence or claim a second action. Success still requires a finalized
confirmation for the exact derived membership address.

These APIs do not connect a browser wallet or Mobile Wallet Adapter, select a
WokeNet identity, upload to a production storage service, or imply that a
community was joined. A client must display the exact Solana deployment,
identity, action, policy and membership sequences, fees/rent, and absence of a
`$WOKE` transfer; then it must verify finalized account state and an indexer
checkpoint covering that state.

## Quarantined legacy payment ABI

Several exported functions retain `Woke` in their names because they match the
checked-in Anchor IDL and existing client ABI. The old instruction layout moves
System Program lamports, which are SOL—not `$WOKE`.

That legacy payment path is fail-closed:

- the current program rejects tip settlement, subscription-offering creation,
  and subscription settlement before any transfer;
- payment configuration cannot be unpaused; and
- the portable schema rejects `{ kind: 'woke' }`.

The old builders, allocation calculator, simulation decoder, and finalized
proof readers remain available for compatibility, audit, and regression
testing. They must not be presented as an enabled payment feature, and clients
should not ask users to sign those settlement instructions. A future `$WOKE`
asset would require a real SPL or Token-2022 mint, an explicit mint-aware
program ABI, allowlisting, and new security review.

The portable planner in `payments.ts` supports:

- native SOL as `{ kind: 'sol' }`; and
- exact SPL-token metadata as `{ kind: 'spl', ... }` when that exact asset is
  allowlisted by the caller.

It uses integer base units, checked bounds, floor-rounded protocol fees, and a
deterministic Hamilton/largest-remainder allocation. The simulation matcher
requires the observed transfers to equal the approved plan.

## Exact Solana transaction boundary

`executeWokeInstruction` provides the common transaction boundary used by the
historical builders. It:

1. requires an HTTP(S) Solana RPC endpoint and forbids redirects;
2. bounds and strictly parses JSON-RPC responses;
3. repeatedly verifies the configured genesis hash;
4. compiles one exact instruction and passes immutable message bytes to the
   injected signer;
5. validates every detached Ed25519 signature locally;
6. obtains the standard Solana fee for that exact compiled message, snapshots
   every writable account, and simulates the exact signed bytes with signature
   verification and post-account snapshots;
7. sends those same bytes without provider-managed retries; and
8. polls to explicit `finalized` status within fixed block-height, attempt, and
   time bounds.

Fee, pre-account, and post-simulation evidence must come from one confirmed
slot. The SDK retries a bounded number of times if the bank advances between
standard `getMultipleAccounts`, `getFeeForMessage`, and `simulateTransaction`
calls; it does not depend on nonstandard `fee`, `preBalances`, or
`postBalances` simulation fields.

The finalized execution result reports the exact-message fee and an immutable,
defensively copied `minimumRentExemptBalances` map keyed by account data size
in bytes. This is the same rent evidence fetched before signing and bound into
the verified simulation snapshot; callers can disclose it without issuing
another provider query.

The signer is supplied per operation. The SDK never accepts or retains private
key bytes. There is no `skipSimulation` option.

Simulation is not settlement proof. A caller must verify the finalized
program-owned receipt or entitlement account before accepting a successful
settlement. The context binds a program address, not its executable byte hash;
deployment tooling must separately verify the program artifact and upgrade
authority.

## Verification

```sh
pnpm --filter @wokesocial/sdk lint
pnpm --filter @wokesocial/sdk typecheck
pnpm --filter @wokesocial/sdk test
pnpm --filter @wokesocial/sdk build
```

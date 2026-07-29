# WokeSocial SDK

`@wokesocial/sdk` contains provider-neutral client operations for WokeSocial.
It does not silently trust the flagship service or choose a Solana RPC
provider for the caller.

The implemented surface includes:

- recoverable signed-manifest publication through replaceable storage and
  transaction adapters;
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
subscription entitlements, and upgradeable-loader program data.

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
6. simulates the exact signed bytes with signature verification;
7. sends those same bytes without provider-managed retries; and
8. polls to explicit `finalized` status within fixed block-height, attempt, and
   time bounds.

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

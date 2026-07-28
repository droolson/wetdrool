# WokeSocial SDK

`@wokesocial/sdk` contains provider-neutral client operations that do not
silently trust the flagship service. The implemented subset includes:

- recoverable signed-manifest publication through replaceable storage and
  transaction adapters;
- ordered provider health/failover selection;
- portable payment planning for native WOKE and exact future SPL assets; and
- a WokeNet-native payment client for protocol configuration, offerings,
  tips, weekly subscription settlement, simulation checks, and finalized
  account proofs.

## WokeNet binding

Every native operation requires an injected `WokeNetContext` with an
`endpoint`, `genesisHash`, and `programAddress`. The SDK has no mainnet,
testnet, or localnet default and does not accept a legacy `solana:` network
identifier. `createWokeNetContext` validates and normalizes that binding;
the simulation and finalized-account verifiers require the same three values.

The PDA helpers implement the program's exact versioned seeds for protocol and
payment config, identities, subscription offerings, payment receipts,
subscription entitlements, and upgradeable-loader program data.

The seven Anchor builders match the checked-in program IDL:

- `buildInitializeWokePaymentConfigInstruction`
- `buildUpdateWokePaymentConfigInstruction`
- `buildRotateWokePaymentAuthorityInstruction`
- `buildCreateWokeSubscriptionOfferingInstruction`
- `buildRetireWokeSubscriptionOfferingInstruction`
- `buildSendWokeTipInstruction`
- `buildSettleWokeSubscriptionInstruction`

Builders return Solana Kit-compatible instruction objects containing the WokeSocial
program address, exact ordered account metadata, and Anchor/Borsh instruction
data. They do not hold keys, sign, broadcast, or silently select an RPC.

## Native WOKE allocation and verification

`calculateWokeNativePaymentPlan` mirrors the on-chain unsigned-128 allocation
algorithm for one to three native WOKE recipients. It:

- accepts only unsigned-64 lamport inputs and a protocol fee from 0 through
  1,000 basis points;
- floors the protocol fee;
- orders recipients by their decoded 32-byte identity addresses;
- applies Hamilton/largest-remainder allocation with that raw-byte tie-break;
- requires every recipient to receive at least one lamport;
- verifies exact value conservation; and
- rejects aliases across payer identity, payer authority, fee destination,
  recipient identities, and recipient destinations.

`assertWokePaymentSimulationMatches` is intentionally simulation-only. Its
input must come from `simulateTransaction`, contain every parsed System Program
`Transfer` opcode in execution order, and contain exactly one parsed
`WokeTipSettled` or `SubscriptionSettled` event. It rejects a failed
simulation, the wrong endpoint/genesis/program, an extra or reordered transfer,
substituted terms, incorrect allocation, duplicate settlement events, and an
invalid subscription window. System account-creation opcodes are not payment
transfers and must not be included in the parsed transfer list.

`verifyFinalizedWokeTipReceipt` and
`verifyFinalizedWokeSubscriptionProof` use an injected
`WokePaymentAccountReader`. They request only `finalized` data and verify the
returned endpoint, genesis, owner program, PDA, account slot, bump, receipt
snapshot, settlement terms, allocation, and entitlement linkage. A successful
simulation is not settlement proof; only these matching finalized accounts are.

The lower-level portable planner also uses integer base units. Its native asset
discriminator is `{ kind: 'woke' }`; `{ kind: 'sol' }` is retired and rejected.
Exact SPL metadata remains explicitly allowlisted for future protocol support.

```sh
pnpm --filter @wokesocial/sdk lint
pnpm --filter @wokesocial/sdk typecheck
pnpm --filter @wokesocial/sdk test
pnpm --filter @wokesocial/sdk build
```

# WokeSocial SDK

`@wokesocial/sdk` contains provider-neutral client operations that do not
silently trust the flagship service. The implemented subset includes:

- recoverable signed-manifest publication through replaceable storage and
  transaction adapters;
- ordered provider health/failover selection;
- portable payment planning for native WOKE and exact future SPL assets;
- a WokeNet-native payment client for protocol configuration, offerings,
  tips, weekly subscription settlement, simulation checks, and finalized
  account proofs; and
- a concrete Solana-format transaction executor for WOKE instructions, with
  operation-scoped signing, exact-byte simulation and broadcast, and bounded
  finalized confirmation.

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
data. They do not hold keys or silently select an RPC.

## Exact transaction execution

`executeWokePaymentTransaction` turns a built tip or subscription settlement
into a complete version-0 transaction by default; pass `version: "legacy"` for
a legacy message. It:

1. validates the remote endpoint as HTTPS (loopback HTTP remains available for
   local development), forbids RPC redirects, streams every JSON response
   through a 4 MiB decompressed-byte ceiling with strict UTF-8/bigint parsing,
   and binds the instruction to the context program;
2. queries and repeatedly rechecks `getGenesisHash`;
3. obtains `getLatestBlockhash`, binds its blockhash and last-valid height, and
   compiles exactly one instruction with `@solana/kit`;
4. calls the supplied signer once with a copy of the exact compiled message and
   the complete required-signer address list plus the enforced transaction-fee
   ceiling;
5. accepts detached 64-byte signatures only, rejects missing, duplicate, or
   unexpected signers, and verifies every Ed25519 signature locally against
   the compiled bytes;
6. encodes one immutable wire-transaction snapshot and calls
   `simulateTransaction` with `sigVerify: true`,
   `replaceRecentBlockhash: false`, and `innerInstructions: true`;
7. rejects simulation errors, replacement blockhashes, stale context slots,
   oversized RPC-controlled collections, fees above the approved ceiling,
   unparsed or unexpected System Program instructions, extra or changed WOKE
   transfers, changed Anchor settlement events, and extra or substituted
   receipt/entitlement account creation;
8. reconciles every simulated native account-balance delta against only the
   bounded network fee, exact rent funding, and approved WOKE transfers, so a
   direct program-owned lamport mutation cannot hide outside parsed System
   Program CPIs;
9. sends the same base64 wire bytes with preflight skipped (the exact bytes
   were already simulated), zero provider-managed retries, and verifies that
   `sendTransaction` returns the deterministic fee-payer signature; and
10. polls `getSignatureStatuses` to internally consistent, explicit `finalized`
    commitment while checking genesis and block-height expiry. Ambiguous sends
    may rebroadcast only the same signed bytes, within fixed attempt and time
    limits.

The signer is an operation argument, not constructor state. The SDK never
accepts or retains private-key bytes:

```ts
const result = await executeWokePaymentTransaction({
  built,
  feePayer,
  signer: async ({
    messageBytes,
    maxTransactionFeeLamports,
    requiredSignerAddresses,
    abortSignal,
  }) => {
    // Delegate to a wallet, passkey-backed signer, hardware wallet, or other
    // key boundary. Return one detached signature per required address.
    return signExactMessage({
      messageBytes,
      maxTransactionFeeLamports,
      requiredSignerAddresses,
      abortSignal,
    });
  },
});
```

`executeWokeInstruction` supports the other checked-in WOKE builders. It
requires an operation-specific `verifySimulation` callback because config and
offering administration do not share one universal effects predicate. There
is deliberately no `skipSimulation` option.

Execution limits have conservative defaults and hard maxima, including a
1,000,000-lamport default `maxTransactionFeeLamports` ceiling. Callers can
lower or explicitly raise that ceiling. The simulated fee is returned as
`simulatedFeeLamports`; the signed blockhash fixes the applicable fee schedule
for the transaction. An expired blockhash is terminal for that operation: the
SDK never fetches a new blockhash and silently asks the signer again. A caller
that still wants the operation must explicitly build a new execution attempt
and approve new message bytes.

### RPC and trust boundary

The executor uses the context endpoint directly through Solana Kit's HTTP RPC
client and requires these methods:

- `getGenesisHash`
- `getLatestBlockhash`
- `getMinimumBalanceForRentExemption` for exact receipt/entitlement funding
- `simulateTransaction` with signature verification and inner instructions
- `sendTransaction`
- `getSignatureStatuses`
- `getBlockHeight`

There is no Agave or Frankendancer fallback. A native Firedancer endpoint that
does not implement this surface cannot execute or finalize payments through
this API; the SDK fails within its configured bounds instead of fabricating
confirmation. Genesis checks validate only the provider-reported network
identity; the Solana-format signed message does not cryptographically include
the genesis hash, and a dishonest RPC can lie. Higher-assurance clients should
compare independent providers and verify the finalized receipt/entitlement
accounts.

The settlement decoder is pinned to the current program event discriminators
and account layouts (457-byte payment receipts and 210-byte subscription
entitlements). Program upgrades that change those wire layouts require a
coordinated SDK update. A finalized signature also does not replace the
stronger account-state checks in `verifyFinalizedWokeTipReceipt` and
`verifyFinalizedWokeSubscriptionProof`.

Native balance reconciliation proves the simulated lamport effects of the
exact signed bytes. It does not decode or prove the final receipt/entitlement
account data, and simulation can never substitute for a finalized account
read. `finalized: true` in the execution result means the transaction signature
reached internally consistent finalized status; callers must still run the
appropriate `verifyFinalized...` function before treating protocol settlement
state as proven.

The context binds a program address, not an executable byte hash. Deployment
verification must separately attest the WokeSocial program artifact and its
upgrade authority; the transaction executor cannot detect a malicious program
upgrade at the same address.

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

# ADR-0009: WokeNet as a protocol deployment on Solana

- Status: Accepted
- Date: 2026-07-29
- Owners: Protocol, application, security, and operations
- Supersedes: the abandoned separate-chain/validator design previously recorded
  under ADR-0009

## Context

WokeSocial is the social platform and flagship client at `woke.social`.
WokeNet names the portable WokeSocial protocol, its Anchor smart contract, and
the deployment metadata that binds clients and indexers to an exact Solana
cluster and program.

Operating a separate blockchain would add consensus, validator, genesis,
economics, RPC, release-engineering, and incident-response obligations that are
not necessary to deliver the social protocol. The repository already builds and
tests an Anchor program with Solana tooling. The truthful architecture is
therefore a Solana application, not a Solana fork or a new validator network.

## Decision

### Platform and protocol boundary

1. WokeSocial is the product, web application, services, and planned mobile
   client.
2. WokeNet is only the WokeSocial protocol/smart-contract deployment layer on
   Solana.
3. WokeNet is not a blockchain, consensus network, validator implementation,
   RPC implementation, native fee currency, or fork of Solana.
4. Solana validators and RPC providers are external dependencies. WokeSocial
   may use multiple credential-free configured RPC endpoints, verify responses,
   and fail over without treating any provider as canonical.

### Deployment identity

The existing portable deployment identifier remains:

```text
wokenet:v1:<solana-genesis-hash>:<social-protocol-program-id>
```

The prefix is an application namespace. The first base58 value binds the
selected Solana cluster by its observed genesis hash; the second binds the
deployed WokeSocial program. Human cluster labels are not substitutes for this
pair.

Clients and indexers must:

1. use explicit `localnet`, `devnet`, or `mainnet-beta` configuration;
2. verify the observed Solana genesis hash and executable program ID;
3. use finalized commitment for canonical projection and, only for a future
   approved mint-aware ABI, settlement evidence;
4. reject network, program, provider, or finality mismatches;
5. keep `wokenet:v1` identity/object namespaces stable across replaceable
   infrastructure.

### Program deployment and authority

- `programs/social_protocol` is the WokeNet onchain program.
- Local-validator tests are development evidence only.
- No devnet or mainnet-beta deployment is currently claimed.
- A public deployment requires a reproducible SBF build, published program ID
  and deployment slot, verified genesis binding, reviewed upgrade authority
  such as a disclosed multisig, independent security review, incident and
  rollback procedures, and explicit release approval.
- Deployment records belong in `network/solana/`; secrets, keypairs, wallet
  material, RPC credentials, and authority keys never do.

### `$WOKE` and payments

No `$WOKE` mint exists.

The repository contains a legacy payment ABI that denominates values in
lamports and previously mislabeled those values as `$WOKE`. That interpretation
is invalid under this decision. The legacy payment ABI is
quarantined:

- it must remain paused and fail closed;
- it cannot be executed, exposed by the flagship clients, or unpaused;
- tests prove bootstrap, execution, authority mutation, and unpause fail without
  state or balance changes; no successful payment flow exists;
- SOL or lamports must not be branded as `$WOKE`.

Portable signed metadata may truthfully identify `{ kind: "sol" }` or an exact
SPL asset. `{ kind: "woke" }` is rejected. This schema does not create a mint,
enable the legacy ABI, or establish an entitlement.

Any future `$WOKE` payment system requires all of the following:

1. a real SPL or Token-2022 mint with an exact public address;
2. reviewed decimals, mint/freeze authorities, extensions, distribution,
   tokenomics, and legal posture;
3. a new mint-aware program ABI and explicit migration/version boundary;
4. updated SDK, indexer, receipt, entitlement, and user-interface semantics;
5. adversarial local-validator tests, devnet rehearsal, independent audit, and
   explicit production approval.

Until those conditions are met, WokeSocial is not token-gated and makes no
claim that `$WOKE` can be acquired, transferred, tipped, subscribed with, or
used to pay Solana fees.

### Solana Seeker direction

The implemented non-release mobile foundation targets Android on Solana Seeker
and uses Solana Mobile Wallet Adapter for wallet connection. It currently
exposes no WokeNet program transaction action.
Private keys must remain in the selected wallet; WokeSocial receives only the
minimum public account and signed-request material required for an explicit
operation.

No verified Seeker-device run, reproducible signed APK, signing provenance,
store submission, or publication exists. A release requires the transaction
flow, reproducible builds, dependency and permission review, controlled
signing, verifiable signed-APK provenance, secure update and rollback
procedures, device-level wallet/intent adversarial tests, and explicit store or
direct-distribution approval.

## Evidence and status language

- Anchor/SBF builds and disposable Solana local-validator tests may be
  described as local Solana program evidence.
- They must not be described as devnet, mainnet-beta, production, public
  deployment, mobile-release, or `$WOKE`-mint evidence.
- RPC failover, exact genesis/program binding, finalized indexing, and
  projection replay remain relevant application controls.
- Separate-chain runtime source, patches, binaries, topology, and genesis
  assertions are outside the WokeSocial/WokeNet architecture and must not be
  used as release evidence.

## Consequences

### Benefits

- WokeSocial can use the Solana ecosystem and Seeker wallet experience without
  operating a consensus network.
- Protocol identifiers remain portable and exact.
- Security effort can focus on the program, authorities, client signing,
  provider validation, privacy, moderation, and application operations.
- Deployment status and token status can be communicated without implying
  infrastructure or assets that do not exist.

### Costs and risks

- WokeSocial depends on Solana availability, fees, runtime behavior, and
  ecosystem wallet/RPC interfaces.
- RPC providers can censor, delay, correlate, or return incomplete data, so
  provider diversity and response verification remain necessary.
- Program upgrades and any future token authorities are high-risk governance
  boundaries.
- Seeker distribution introduces Android supply-chain, signing, permission,
  deep-link, wallet-intent, and update risks.

## Rejected alternatives

- **Operate a separate application chain:** unnecessary operational and security
  scope for the product.
- **Fork Solana or ship a custom validator:** does not improve the application
  boundary and creates a misleading separate-network claim.
- **Treat RPC providers as WokeNet nodes:** RPC endpoints are replaceable Solana
  providers, not WokeNet consensus participants.
- **Rename SOL/lamports as `$WOKE`:** false and incompatible with a future
  mint-backed asset.
- **Unpause the legacy payment ABI:** forbidden because it is not mint-aware.
- **Claim a Seeker app from responsive web tests:** browser mobile-width
  coverage is not native Android, Mobile Wallet Adapter, APK, or device
  evidence.

## References

- `network/solana/README.md`
- `network/solana/deployments.example.json`
- `network/solana/deployments.schema.json`
- `programs/social_protocol/`
- Solana Mobile Wallet Adapter documentation:
  <https://docs.solanamobile.com/developers/mobile-wallet-adapter>

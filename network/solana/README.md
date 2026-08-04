# DroolNet on Solana

DroolNet is the WetDrool protocol deployment layer on the Solana blockchain.
It is not a validator implementation, a Solana fork, or a separate consensus
network.

The onchain application is the Anchor program in
`programs/social_protocol`. A DroolNet deployment identifier keeps the existing
portable form:

```text
droolnet:v1:<solana-genesis-hash>:<social-protocol-program-id>
```

The first base58 value identifies the Solana cluster genesis and the second
identifies the deployed WetDrool program. The `droolnet:v1` prefix is an
application namespace; it does not claim a sovereign chain.

## Deployment status

- Local validator: supported for disposable development and automated program
  tests.
- Solana devnet: not deployed.
- Solana mainnet-beta: not deployed.
- `$DROOL`: no mint exists yet. Branded payment actions must remain disabled
  until an exact SPL or Token-2022 mint, decimals, authorities, extensions, and
  legal/tokenomics review are recorded.

`deployments.example.json` is a non-secret template. Production RPC URLs,
wallets, signing keys, publisher keys, and mint authorities must never be
committed.

## Verification lanes

```bash
pnpm test:programs
pnpm test:vertical-slice
```

These commands exercise the real Anchor program against a disposable Solana
local validator. Public deployments additionally require a verifiable build,
published program ID, multisig upgrade authority, independent security review,
and explicit release approval.

# ADR 0009: Sovereign WokeNet on native Firedancer

- Status: accepted architecture; production activation blocked
- Date: 2026-07-28
- Owners: protocol, validator, security, operations, and product

## Context

WokeSocial now uses `woke.social`, and its protocol is to run on a sovereign
cryptocurrency network named **WokeNet**. Its native currency is **WOKE**
(`$WOKE`). The network must preserve the Solana protocol's account model and
transaction compatibility while using Firedancer validator and RPC software
instead of Agave.

That choice is not equivalent to deploying the social program to a
Solana-operated cluster. It creates a new network with its own genesis, ledger,
validator set, native currency, economic policy, upgrade decisions, and
operational responsibility.

As of the pinned upstream revision, Firedancer has two materially different
paths:

- Frankendancer combines Firedancer components with Agave for execution,
  consensus, replay, RPC, and other functionality.
- Full native Firedancer provides the `firedancer` and `firedancer-dev`
  binaries without linking the Agave validator.

Frankendancer does not satisfy the no-Agave requirement. Full native Firedancer
also cannot yet truthfully be treated as a production runtime: upstream has no
production release for it, and native RPC lacks methods required to submit,
simulate, confirm, query, and index the application's transactions.

## Decision

### Network identity and currency

1. WokeNet is a sovereign Solana-protocol-compatible network, not a Solana
   cluster or an SPL token deployment.
2. Its native currency is WOKE with nine decimal places.
3. The protocol-compatible base-unit name remains `lamport` in binary layouts,
   program fields, RPC fields, and existing client libraries:

   ```text
   1 WOKE = 1,000,000,000 lamports
   ```

4. WOKE has no mint address or token contract. Production supply, inflation,
   validator rewards, allocations, fees, and launch terms require a separate
   reviewed genesis policy.
5. The canonical network namespace binds both the exact genesis and the social
   program deployment:

   ```text
   wokenet:v1:<32-byte-base58-genesis-hash>:<32-byte-base58-program-id>
   ```

   Identity identifiers use:

   ```text
   wokesocialid:v1:wokenet:v1:<genesis-hash>:<program-id>:<identity-pda>
   ```

   Pre-migration `solana:` identifiers are rejected rather than silently
   reinterpreted.

### Validator and RPC runtime

1. Production, staging, and WokeNet development clusters may use only the
   full native `firedancer` or `firedancer-dev` binaries.
2. `fdctl`, `fddev`, `agave-validator`, and `solana-test-validator` are forbidden
   as WokeNet runtime processes.
3. Frankendancer is not a fallback because its Agave dependency contradicts the
   selected trust and implementation boundary.
4. Validator and RPC configurations disable telemetry, set `no_agave = true`,
   bind the expected genesis and shred version, and reject arbitrary gossip
   snapshot sources.
5. Voting validators do not expose public RPC. Non-voting RPC nodes bind native
   RPC to loopback behind a separately hardened and monitored gateway.

### Reproducible downstream source

1. The official Firedancer repository and an exact 40-character commit are
   pinned in `network/wokenet/firedancer/SOURCE.lock.json`.
2. Every downstream patch is ordered and SHA-256 pinned.
3. `pnpm wokenet:materialize` creates a detached checkout at that exact commit,
   applies only the checked patch queue, and refuses to overwrite an existing
   destination.
4. `pnpm wokenet:source-check` verifies the source revision, requires the
   tracked diff to exactly match the checked patch queue, rejects unexpected
   untracked source, inspects both native binary declarations/mode flags, and
   checks current native-RPC capability evidence.
5. On a supported Linux x64 build host, `pnpm wokenet:binary-check` requires the
   exact downstream patch to be applied, creates a disposable no-hardlink
   checkout at the pinned commit, reapplies only the patch queue, clones and
   rebuilds OpenSSL at its separately pinned source commit, and owns a clean
   object directory there rather than trusting pre-existing ignored source,
   dependency artifacts, or executable files. It builds both native ELFs plus
   the pinned genesis/RPC tests, executes those tests, parses and checks the
   native localnet topology, and verifies ELF target/symbols plus the binaries’
   source-locked downstream marker, upstream commit, and version before
   recording dependency/toolchain and distinct binary hashes and rejecting
   forbidden dynamic runtime dependencies. The entire checkout is removed
   afterward. CI also rejects forbidden runtime processes.
6. A missing RPC method becoming implemented intentionally makes the evidence
   check fail. Capability changes require review and conformance testing rather
   than silently changing the production gate.

### Genesis

1. Disposable localnet values are fixtures and are not tokenomics.
2. The downstream genesis patch makes creation time and bootstrap allocations
   explicit and allows all deterministic benchmark accounts to remain
   unfunded.
3. A production ceremony must publish:
   - canonical `genesis.bin` SHA-256/base58 hash;
   - shred version and feature set;
   - exact source commit, patch digests, build inputs, and binary digest;
   - social-program ID and program build provenance;
   - every validator identity, vote/stake account, allocation, and authority;
   - signed ceremony attestations.
4. Production templates contain deliberately invalid replacement markers. They
   cannot be used as launch configuration before the ceremony.
5. Nodes fail closed on a mismatched genesis hash, shred version, program ID,
   or untrusted snapshot source.

### Compatibility evidence during the activation block

The existing Anchor and Solana-wire local-validator suites may remain only as a
**compatibility oracle** for programs, account layouts, transaction encoding,
and SDK behavior. They do not constitute WokeNet runtime evidence and
must not be described as a WokeNet transaction, validator, RPC, testnet,
or production deployment.

The flagship application must not enable or claim WokeNet settlement until
the native runtime passes the activation gates below. Unsupported submission,
simulation, confirmation, or indexing paths fail closed.

## Production activation gates

Production remains disabled until all of the following are independently
verified:

1. Native Firedancer has a supported release and reproducible build provenance.
2. Native RPC implements and passes conformance for at least
   `sendTransaction`, `simulateTransaction`, `getSignatureStatuses`,
   `getTransaction`, `getSignaturesForAddress`, and `getProgramAccounts`.
3. Program deployment, upgrade, restart, replay, repair, snapshots, finality,
   and indexer rebuild pass without an Agave process.
4. Multi-validator consensus and byzantine/failover rehearsals pass with at
   least three independently administered validators and two independent RPC
   operators.
5. The downstream validator patch, genesis builder, runtime, RPC gateway,
   social program, SDK verification, and economic assumptions receive
   independent security review.
6. Supply, inflation, rewards, fees, allocations, tax, sanctions,
   money-transmission, consumer-protection, and launch disclosures receive
   qualified legal and economic review.
7. Upgrade, emergency, treasury, and release authorities use publicly
   documented hardware-backed multisig controls with rehearsed recovery.
8. No public sale, exchange, lending, yield, bridge, or main-network funding is
   enabled as a shortcut around these gates.

The machine-readable gate is
`network/wokenet/firedancer/NATIVE_RPC_CAPABILITIES.json`. Its production
flags remain false until the evidence above exists.

## Consequences

### Benefits

- Network identity cannot be confused with a human cluster label or a
  Solana-operated deployment.
- Existing Anchor programs and Solana-compatible client primitives can be
  retained at the wire boundary.
- The no-Agave runtime rule is machine checked rather than being only a brand
  statement.
- Source, patches, genesis inputs, and activation blockers are reviewable and
  reproducible.

### Costs and risks

- WokeNet inherits responsibility for validator security, consensus
  operations, economics, upgrades, incident response, and ecosystem tooling.
- Native Firedancer immaturity blocks a truthful production launch today.
- Existing compatibility tests do not prove full native runtime behavior.
- A sovereign native currency creates material legal, economic, abuse,
  custody, and user-safety obligations even when the social application remains
  noncustodial.
- Solana ecosystem libraries may retain terms such as `lamport`, PDA, SBF,
  Ed25519, and `@solana/kit`; those are compatibility vocabulary, not claims
  that the network is Solana mainnet.

## Rejected alternatives

- **Deploy WOKE as an SPL token on Solana:** does not create the requested
  sovereign network or native fee currency.
- **Use Frankendancer until full Firedancer is ready:** violates the explicit
  no-Agave runtime requirement.
- **Rename an Agave local validator to WokeNet:** creates false evidence
  and an unverifiable trust boundary.
- **Publish tokenomics or a production genesis from disposable fixtures:**
  bypasses security, economic, governance, and legal review.
- **Fork without a pinned upstream revision and patch checksums:** prevents
  reproducible review and reliable incident response.

## References

- `network/wokenet/README.md`
- `network/wokenet/GENESIS_POLICY.json`
- `network/wokenet/firedancer/SOURCE.lock.json`
- `network/wokenet/firedancer/NATIVE_RPC_CAPABILITIES.json`
- Firedancer upstream repository: <https://github.com/firedancer-io/firedancer>
- Firedancer operator documentation: <https://docs.firedancer.io/>

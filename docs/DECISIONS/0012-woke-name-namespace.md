# ADR-0012: Versioned `.woke` identity names

- Status: Accepted and implemented for localnet anonymous registration and
  resolution; custom-name settlement and public-cluster registration remain
  incomplete
- Date: 2026-07-29
- Owners: Protocol, program, SDK, indexer, application, trust and safety,
  economics, privacy, and security

## Context

Every WokeSocial account should begin with a pseudonymous name without asking
for a phone number, email address, legal name, or user-selected handle. The name
must remain stable through ordinary root-key rotation and guardian recovery,
resolve to the current Solana authority, resist registration front-running, and
remain independently verifiable without trusting one WokeSocial server.

The `.woke` suffix is a WokeNet application namespace. It is not an ICANN or
alternative-DNS top-level domain, a Solana public key, an SPL asset, or a
promise that third-party wallets understand the string. Before a payment or
signature, clients must reveal the exact destination public key, Solana
cluster, deployed program, fees, rent, and expected state transition.

## Decision

### Canonical v1 representation

The namespace version is `1`; the presentation suffix is `.woke`. Program
state stores the canonical handle without the suffix because the existing
versioned handle account is the portable uniqueness primitive.

The deterministic anonymous handle is:

```text
digest = SHA-256(
  UTF-8("wokesocial:woke-name:random:v1\0")
  || 32-byte immutable Identity.origin_authority
)
handle = "anon_" || crockford-base32(digest[0..10])
name = handle || ".woke"
```

The 80-bit digest prefix encodes to exactly 16 lowercase Crockford base32
characters using `0123456789abcdefghjkmnpqrstvwxyz`. The derivation has no
randomness, wall clock, provider, database, or current-root input. The known
vector for `11111111111111111111111111111111` is:

```text
anon_a8rvm9ryz0phc719.woke
```

The system-program address is a derivation vector only. It remains invalid as
an identity authority in transaction builders.

UI input may contain one leading `@` and one trailing `.woke`; both are
presentation syntax. V1 canonicalization lowercases ASCII and rejects
whitespace, non-ASCII or non-NFKC input, invalid underscore placement, and
unsupported characters. Unicode remains available for display names, not v1
canonical handles. This closes the most dangerous confusable and normalization
ambiguities without pretending that a local denylist solves impersonation.

### Onchain ownership and front-running defense

The existing handle PDA remains:

```text
PDA(
  "wokesocial",
  account-version-1,
  "handle",
  SHA-256(UTF-8(canonical handle))
)
```

For any `anon_` claim, the WokeNet Solana program independently re-derives the
only valid value from `Identity.origin_authority`. A different identity cannot
claim it, even after seeing the pending transaction. The immutable origin,
rather than the current root, means root rotation and guardian recovery do not
rename the account. Ordinary custom handles continue to use the general claim
ABI, but must not be offered as a public product until the custom-name policy
and settlement gates below are implemented.

The SDK builder derives the anonymous name, full SHA-256 seed, claim PDA,
account order, and exact Anchor data. It rejects malformed/default addresses,
aliased authority/state accounts, and non-incrementable identity sequences.
The program checks the expected identity sequence, current root signature,
identity/PDA relationships, exact handle bytes, and collision state.

Fresh registration submits identity creation followed by the first
anonymous-name claim in one Solana transaction. Both instructions share one
approved message and Solana commits both or neither. The SDK verifies the exact
two account creations, rent and fee deltas, `IdentityCreated` and
`HandleClaimed` events, finalized accounts, and sequence `1` binding before the
application treats registration as complete.

The development-localnet passkey publication path uses this atomic operation.
An identity created by an older build is migrated with one separately simulated
current-sequence claim; it never attempts to recreate the identity. Repeated
registration reconciles both deterministic accounts. The onboarding screen may
derive the candidate before a transaction, but it must continue to distinguish
that preview from a finalized claim. No public-cluster deployment or production
registration exists.

### Resolution and recovery

The canonical resolution chain is:

```text
canonical name
  -> finalized HandleClaim account
  -> stable Identity account
  -> current Identity.root_authority
```

The stable identity account preserves rotation and recovery history through
program events. The open indexer exposes
`GET /v1/woke-names/{name}?network={networkId}` as a noncanonical convenience
projection. The strict indexer client rejects unknown scope fields, network or
stable-identity substitution, a mismatched handle commitment, claims newer than
the identity, and checkpoints that do not cover both the claim and current
identity update. Resolution deliberately follows the current root after a
finalized rotation.

Clients still bind the answer to one exact Solana genesis hash and WokeNet
program and must be able to verify accounts/events independently. Cache keys
include namespace version, network, program, and canonical handle;
rotation/recovery invalidates current-destination entries. A stale or optimistic
indexer answer is never sufficient for value transfer.

The underlying destination shown to a user is the current root authority unless
a future instruction explicitly defines a different payment destination.
Clients must never silently treat the name string itself as a wallet address.

### Custom names, expiry, transfer, and disputes

Custom-name purchase is not implemented by this decision. Before it can be
enabled, a new versioned policy must define and test:

- a program-enforced reserved-name registry and governance authority;
- reputation/points eligibility without pay-to-impersonate behavior;
- commit/reveal or an equally strong front-running defense;
- anti-squatting rate limits and fair allocation rules;
- registration term, expiry warning, grace period, release cooldown, and
  abandoned-name handling;
- whether transfer is forbidden or explicitly represented, with recipient
  consent and provenance if allowed;
- recovery interaction and a rule that compromised-root rotation cannot
  silently transfer a name;
- trademark, impersonation, parody, deceased-person, appeal, transparency, and
  due-process policy;
- exact fees, Solana rent/network fees, sponsorship limits, refunds, taxes,
  consumer terms, and accounting treatment; and
- migration and backward-compatible resolution across namespace versions.

Local client warnings are not onchain enforcement. The reserved `anon_`
subnamespace is program-enforced now; broader names remain subject only to the
existing conservative character and uniqueness rules and therefore are not
ready for monetization.

## Evidence

The implemented slice has:

- exact TypeScript protocol vectors plus canonicalization, confusable,
  reserved-name, invalid-key, and deterministic 4,096-key collision tests;
- SDK ABI, PDA, retry-stability, address-alias, and sequence-boundary tests;
- Rust vectors matching TypeScript byte-for-byte;
- program checks that reject a contender's claim and accept only the identity
  whose immutable origin derives the anonymous name; and
- exact resolver/indexer-client tests covering invalid, missing, released, and
  root-rotated names; and
- a real Chromium/local-validator test proving passkey registration creates
  identity plus claim in one transaction, two subsequent posts advance the
  same identity to sequence `3`, strict `.woke` resolution returns the current
  root, and replay reconstructs all four browser-written events.

The 2026-07-29 Agave 2.3 local-validator atomic registration simulation consumed
29,865 compute units and created a 407-byte identity account plus a 156-byte
handle account with 3,723,600 and 1,976,640 lamports of rent-exempt balance at
that validator's settings. The complete vertical slice rebuilt 14 durable
events: 10 baseline events, `IdentityCreated`, `HandleClaimed`, and two browser
posts. These measurements are development-localnet evidence, not a quote,
public-cluster deployment, security audit, scale result, or production
guarantee.

## Consequences

### Benefits

- New users can receive a stable pseudonym without choosing or disclosing an
  identity attribute.
- Allocation is reproducible and portable rather than database-random.
- A mempool or RPC observer cannot claim another identity's anonymous name.
- Key rotation and recovery preserve the name while still changing the current
  authority.
- The UI can distinguish a readable name from the actual Solana destination.
- The `anon_` prefix reserves a mechanically recognizable namespace without
  consuming desirable custom names.

### Costs and limits

- Deterministic allocation leaks that a particular public origin key maps to a
  particular anonymous name; it is pseudonymous, not unlinkable.
- A derived candidate is not owned until a claim is finalized.
- Atomic registration and strict resolver proofs are development-localnet
  paths; public-cluster execution, payment/signature destination confirmation,
  cache operation, and cross-surface name rendering still need product
  integration.
- Custom names, purchases, expiry, transfer, appeals, and economic policy
  remain unimplemented.
- No devnet or mainnet-beta WokeNet deployment exists.

## Rejected alternatives

- **Server-generated random usernames:** not independently reproducible and
  vulnerable to operator reassignment.
- **Current-root derivation:** ordinary rotation or recovery would rename the
  person.
- **User-chosen anonymous names at signup:** encourages squatting and reveals
  intent before eligibility policy exists.
- **Treat `.woke` as DNS or a native wallet address:** technically false and
  unsafe for signatures or payments.
- **Rely on the client to protect `anon_`:** a modified client or direct
  transaction could bypass it.
- **Unicode canonical handles in v1:** normalization and confusable rules are
  not yet sufficiently specified.
- **Launch custom-name sales with a denylist:** expiry, recovery, disputes,
  front-running, economics, and consumer obligations remain unresolved.
- **Build a WokeNet chain:** WokeNet is the WokeSocial protocol/program
  namespace on Solana.

## References

- [ADR-0002: Canonical serialization and hashing](0002-canonical-serialization-and-hashing.md)
- [ADR-0004: Indexer projection and replay](0004-indexer-projection-and-replay.md)
- [ADR-0006: Passkey account/key boundary](0006-passkey-account-key-boundary.md)
- [ADR-0009: WokeNet on Solana](0009-wokenet-on-solana.md)
- `packages/protocol/src/woke-names.ts`
- `packages/sdk/src/woke-name-claim.ts`
- `programs/social_protocol/src/validation.rs`
- `programs/social_protocol/src/instructions/handle.rs`
- `apps/web/components/passkey-auth-panel.tsx`
- GitHub issue `#14`

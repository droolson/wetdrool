# `@wetdrool/messaging`

This package is the narrow, pairwise-only adapter selected by ADR-0007. It
delegates the ratchet, key agreement, authenticated encryption, and device-key
signing to the pinned Apache-2.0
`@matrix-org/matrix-sdk-crypto-wasm@18.4.0` engine. It does not implement a
cryptographic primitive or libolm compatibility layer.

The public API uses WetDrool identity/device addresses. Matrix-shaped IDs,
engine request objects, and engine state stay inside the adapter. Create a
device with `createPairwiseDevice`; the concrete implementation and its
constructor are not runtime exports. The factory returns the public
`PairwiseMessagingDevice` interface.

A replaceable key-directory transport receives only an operation label and
opaque bytes. The directory is untrusted: every engine device key is
independently matched to a current WetDrool device-authorization assertion
before a key claim, encryption, stateful decryption, or plaintext release.
Authorization is checked before and after sensitive operations so a mid-flight
revocation or rotation fails closed. The local device is subject to the same
checks. A relay only needs the returned ciphertext envelope and routing
metadata.

## Envelope authentication

The version-one protocol namespace is
`wetdrool.com.messaging.pairwise.v1`. Each outer envelope has an Ed25519
signature made by the sender's Matrix `OlmMachine` device key. The exact signed
message is:

```text
wetdrool.com/messaging/pairwise-envelope-signature/v1
<RFC 8785 canonical JSON of version, protocol, algorithm, messageId, sender,
recipient, and ciphertext>
```

The `signature` field is excluded from that canonical JSON. The signature and
public key use canonical, unpadded standard Base64. On receive, the adapter
resolves the sender's current authorization, compares the ciphertext's
Curve25519 sender key, and performs strict Ed25519 verification before calling
the stateful Olm receive API. Mutating a routing field, message ID, signature,
or ciphertext therefore cannot consume the genuine message's ratchet state.
The encrypted inner event repeats the message ID and both addresses, and those
values must match after decryption.

Identity and device identifiers must be non-empty, bounded, well-formed Unicode
scalar strings without leading/trailing whitespace or control characters.
Unpaired UTF-16 surrogates are rejected before internal IDs are derived.

## Deadlines and shutdown

Authorization callbacks and directory exchanges receive an `AbortSignal` and
absolute `deadlineEpochMs`. Both are bounded to 10 seconds by default; callers
may configure 10–120,000 milliseconds. Adapters should honor cancellation even
though this package also races every callback against its own deadline.
`close()` aborts active callbacks before joining the serialized work queue, so
a resolver or directory that never settles cannot wedge shutdown.

The package installs no logger and never logs plaintext, key material, opaque
directory bodies, ciphertext internals, raw engine events, or Matrix authority
claims. Public errors contain fixed codes and messages. The adapter owns a copy
of outbound plaintext and overwrites that copy on every exit, including
validation, authorization, timeout, and closed-device failures. JavaScript
strings and caller-owned buffers cannot be reliably zeroized and remain a host
application responsibility.

## Capability and storage status

Group and room encryption are disabled. The package exports a literal
capability status, exposes no room/group encryption API, rejects non-pairwise
decrypted events, and refuses every upstream request category other than device
key upload, query, and one-time-key claim. The embedded upstream engine still
contains its general Matrix crypto implementation; this adapter does not expose
those capabilities.

Only the explicit `memory` / `test-or-development` mode is implemented. Creation
requires all of the following:

- `storage.acknowledgeVolatileKeyLoss: true`;
- an explicit `runtimeEnvironment` of `development` or `test`; and
- a Node process whose `NODE_ENV`, when present, is not `production`.

Passing `runtimeEnvironment: "production"` always fails with
`PRODUCTION_STORAGE_UNAVAILABLE`. Browser code cannot reliably infer its own
deployment tier, so the host must supply this value honestly; the mandatory
field prevents an accidental default to volatile production storage.

A production browser integration still needs:

- a reviewed persistent IndexedDB-backed engine store;
- an encrypted-at-rest key supplied through an approved custody path;
- a single-writer owner across tabs/workers, with lifecycle and recovery
  semantics;
- durable replay/deduplication state; and
- migration, backup, restore, and device-loss behavior.

The adapter serializes access to its in-memory engine instance, but that does
not solve browser-wide single-writer ownership. A denied remote device is
locally blacklisted. The upstream API does not expose deletion of an individual
Olm session, so revoked session material remains inside the volatile engine
until that machine is closed. No production-ready or metadata-private
messaging claim should be inferred from this package.

The pinned dependency publishes separate Node and browser module paths. Browser
packaging must preserve and serve its `.wasm` asset at the URL resolved by the
upstream entry point and permit that fetch under the deployment CSP; this
repository does not yet contain a production browser packaging integration.

## License

The WetDrool adapter is licensed under the [MIT License](LICENSE). The pinned
Matrix Rust crypto WebAssembly dependency remains Apache-2.0 licensed; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance.

# ADR-0002: Canonical Serialization and Hashing

- **Status:** Accepted design; implementation pending
- **Date:** 2026-07-28
- **Owners:** Protocol and SDK

## Context

Signatures and content addressing fail across languages when equivalent JSON
produces different bytes. A protocol-level choice must cover ordering, Unicode,
numbers, proof domain separation, identifiers, and stored bytes.

## Decision

Protocol v1 uses:

- JSON Canonicalization Scheme (JCS, RFC 8785) encoded as UTF-8;
- SHA-256 (`sha2-256`) for payload and binary-media digests;
- Ed25519 for initial portable-object signatures;
- CIDv1 with the `raw` codec and `sha2-256` for stored canonical envelopes;
- multibase base64url without padding (`u` prefix) for JSON digests,
  signatures, and nonces;
- base58 only for Solana-native keys, signatures, and genesis hashes.

The portable object ID is the SHA-256 digest of `JCS(payload)` and excludes the
detached proof:

```text
swobj:v1:<type>:<base64url-no-padding(SHA-256(JCS(payload)))>
```

The signature covers a JCS proof descriptor containing a fixed domain,
descriptor version, algorithm, key ID, network, object type, and payload hash.
The stored envelope is `JCS({"payload": payload, "proof": proof})`.

## Input constraints

Before canonicalization, validators:

- reject duplicate keys, invalid Unicode scalars, nonfinite values, negative
  zero, and out-of-range numbers;
- require NFC for user-visible strings without silently rewriting input;
- use decimal strings for token amounts and other values that can exceed safe
  interoperable JSON integers;
- enforce schema and UTF-8 byte bounds;
- include every accepted extension in the hash and signature;
- reject unknown fields named by the payload's `critical` list.

Binary media is hashed as exact validated bytes, never as a JSON or base64
transformation.

## Consequences

- Rust and TypeScript require vetted JCS wrappers with identical rejection
  behavior.
- Proof replacement does not change the semantic object ID, while the canonical
  envelope CID identifies exact proof bytes.
- Noncanonical incoming JSON may be parsed and canonicalized only after strict
  validation; its transport bytes are not assumed to be signed bytes.
- Unicode normalization and numeric limits are schema concerns as well as
  serializer concerns.

## Rejected alternatives

- **Ordinary `JSON.stringify`:** property ordering and edge behavior are not an
  adequate protocol contract.
- **Hashing provider URLs:** locations do not prove content integrity.
- **Hashing the proof into the object ID:** creates circularity and makes the
  semantic ID depend on signature encoding.
- **Custom binary encoding in v1:** raises implementation risk before a complete
  cross-language codec/tooling suite exists.
- **Multiple digest/signature defaults:** increases downgrade and compatibility
  risk; new algorithms require an explicit registry change.

## Verification

Release is blocked until checked-in Rust/TypeScript golden vectors cover
canonical bytes, rejected inputs, hashes, IDs, proof descriptors, signatures,
CIDs, Unicode edges, and numeric boundaries.

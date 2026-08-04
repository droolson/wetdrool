# `@wetdrool/test-fixtures`

Deterministic identities and signed canonical manifests for unit, integration, interoperability, and demo-data tests.

All private keys in this package are intentionally public test vectors. They are generated from obvious byte sequences, returned as fresh copies, and must never hold funds, represent a real person, or be accepted by a production trust policy.

`createProtocolFixtureSet()` returns the same bytes and object identifiers on every call:

- profiles for Alice and Bob;
- a public post by Alice;
- a reply by Bob; and
- a tombstone for Bob's reply.

All identities use the canonical
`droolnet:v1:<genesis-hash-base58-32>:<program-id-base58-32>` network namespace.
Because the namespace is signed content, its migration intentionally repinned
every fixture object ID and CID.

Consumers should verify the envelopes using the real `@wetdrool/protocol` verifier. The fixture package does not weaken or replace authorization checks.

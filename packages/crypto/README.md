# `@wetdrool/crypto`

Small browser/Node-safe cryptographic building blocks backed only by standards-based WebCrypto:

- secure random bytes and opaque IDs;
- domain-separated SHA-256;
- domain-separated HKDF-SHA-256 for high-entropy input key material; and
- versioned AES-256-GCM sealed envelopes with authenticated public context; and
- credential-bound wrapping of locally generated Ed25519 seeds using a
  32-byte WebAuthn PRF extension output.

Every hashing, derivation, and encryption API requires an explicit application domain. The package frames the operation, domain, and variable-length inputs before use, preventing ambiguous concatenation and cross-protocol reuse.

This package does not implement passwords, signatures, or public-key agreement. Protocol object signatures remain in `@wetdrool/protocol`; password derivation needs a dedicated memory-hard KDF; and asymmetric messaging requires a separately reviewed key-agreement design.

Never pass user passwords to `hkdfSha256`. Never reuse an AES-GCM nonce with the same key. Production callers should omit `nonce` so the package generates it securely.

`wrapPasskeyAccountKey` does not turn a WebAuthn credential into a DroolNet
transaction key and never sends the PRF output or plaintext Ed25519 seed to a
server. A compatible client generates the Ed25519 seed locally, obtains the
optional credential-scoped PRF result through a user-verifying WebAuthn
ceremony, and may sync only the resulting ciphertext bundle. Each additional
passkey wraps the same account seed independently. Authenticators without PRF
support require a different reviewed custody path; callers must not silently
fall back to a server-held plaintext key.

The serialized `solana-ed25519-root-seed` and
`solana-ed25519-delegation-seed` kind names are retained compatibility
identifiers for DroolNet's Solana-compatible Ed25519 wire roles. They are
authenticated into existing ciphertext bundles; renaming them would make those
bundles undecryptable.

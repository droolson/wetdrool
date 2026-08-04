# WetDrool as the first WOKE.NET alpha application

## Product map

- WetDrool: the application and creator experience.
- DroolNet: WetDrool portable objects and Solana application protocol.
- WOKE.NET: future replaceable carrier, peer sync, and independent availability layer.
- Solana: phase-one root identity and eventual settlement adapter.

WOKE.NET is not a deployed blockchain, onion network, anonymity service, or public
mesh today.

## Alpha data flow

1. A compatible wallet exposes a public key to the browser.
2. The user signs a readable, origin-bound local unlock message.
3. WebCrypto verifies the Ed25519 signature.
4. HKDF-SHA256 derives a non-extractable AES-256-GCM key for the tab.
5. A local note is encrypted with random nonce and canonical additional data.
6. The encrypted blob receives a CIDv1 raw SHA-256 identifier.
7. The wallet signs a manifest that binds author, CID, encryption mode, time, and
   local-only publication status.
8. IndexedDB stores the signed record.
9. Export emits ciphertext and signed manifests. Import recomputes each CID and
   verifies each signature before storing anything.

No object is uploaded or submitted to Solana.

## Discovery algorithm alpha

The discovery lab contains synthetic, non-explicit fixtures only. It runs in the
browser and uses:

- 35 percent consent/provenance readiness;
- 20 percent recency;
- 20 percent novelty;
- 10 percent engagement capped at 0.75;
- 15 percent explicit mode match.

All, Straight, and Pride are chosen controls. No identity is inferred. The active
mode is stored locally and no analytics endpoint exists.

## Provider admission boundary

Future adult media providers remain blocked until each source supplies:

- licensing and permitted redistribution terms;
- performer identity and age record responsibilities;
- content-specific consent and withdrawal handling;
- stable source hashes and creator attribution;
- NCII and duplicate-removal support;
- child-safety and trafficking escalation access;
- human appeal and emergency response contacts;
- retention, deletion, and audit commitments.

A random public adult API is not an acceptable provenance source.

## Path beyond the web bootstrap

1. Freeze schemas, signature domains, limits, and golden vectors.
2. Add wallet-authorized device signing and encryption keys.
3. Package the client as a signed CAR with a pinned genesis manifest.
4. Deploy two bounded, read-only carriers that serve only verified release blocks.
5. Prove corrupt-carrier rejection and primary-host failure recovery.
6. Add manual peer records, then Seeker-native peer transport.
7. Add encrypted self-sync, revocation, rotation, and recovery.
8. Conduct independent security and privacy review.

Only after independent peers and failure-domain tests exist may the project claim
decentralized availability.

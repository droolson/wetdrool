# Socially Woke relay

This package is an independently replaceable real-time transport. Relay events are **advisory and non-canonical**: a notification never proves that a manifest is authentic, available, or anchored on Woke Network. Clients must verify the signed manifest, current key authorization, tombstones, access policy, and finalized on-chain anchor before changing durable state.

The service transports:

- new-post references;
- short-lived typing and coarse presence state;
- live reaction hints;
- community update references;
- opaque end-to-end encrypted message envelopes;
- encrypted livestream signaling metadata.

It never reads or logs an event payload, topic, recipient list, ciphertext, subscription relationship, or raw protocol identity. Logs contain operation names, public event kinds, relay-local connection IDs, event IDs, and one-way truncated identity hashes. `/metrics` exposes aggregate counters only.

## Security and privacy boundaries

Every publish and subscription authorization is a strict, versioned Ed25519 envelope. The signing key ID must be structurally attached to the declared Socially Woke identity. The server validates the payload hash, signature, exact-millisecond timestamps, expiry, nonce, audience, opaque topic, known critical fields, and event-specific size limits.

Structural key possession is not identity authorization: an attacker can generate a key and write its public key under someone else’s identity-shaped key ID. The server therefore starts **locked and not ready by default**, rejects every WebSocket upgrade, and accepts no event until a deployment injects `authorizeKey` backed by a current finalized identity/delegation projection. `authorizeSubscription` can additionally enforce opaque-topic access.

Community-audience events are never delivered unless `authorizeSubscription`
is configured. Knowing an opaque topic is not membership proof; a production
callback must resolve that topic against current community policy and membership.

Isolated loopback development may explicitly set `RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE=1` (or the matching constructor option). The hello, publish, event, health, readiness, and metrics surfaces label that mode `unverified-local`. It must never be used for a shared or Internet-reachable relay.

Replay nonces, retained events, rate-limit buckets, subscriptions, and presence are memory-only and bounded. Typing, presence, and livestream signals are never retained. Other eligible events expire after at most two minutes even if their signed expiry is later. Encrypted-message ciphertext may be retained briefly for delivery, but delivery is not guaranteed.

Message confidentiality belongs to the upstream E2EE format. This relay validates only bounded ciphertext metadata; it does not encrypt, decrypt, escrow, inspect, or recover messages. Direct audiences necessarily expose the minimum recipient identity list required for routing, but that list is never retained separately or logged. Use opaque digest topics created with `relayTopicFor`, not human-readable relationship names.

The server also enforces:

- 64 KiB WebSocket frames with compression disabled;
- per-IP and per-identity rate limits;
- per-IP connection and per-connection subscription caps;
- backpressure disconnects;
- ping/pong heartbeat, idle expiry, and expiring subscription authorization;
- credential-free origin allowlisting for browser connections;
- privacy-safe HTTP health, readiness, policy, and Prometheus endpoints.

See [docs/PROTOCOL.md](./docs/PROTOCOL.md) for wire semantics and reconciliation rules.

## Service endpoints

- `GET /healthz` — process liveness and explicit advisory/canonical labels
- `GET /readyz` — readiness, including an optional dependency check
- `GET /metrics` — aggregate Prometheus text metrics
- `GET /v1/policy` — public bounds and retention policy
- `WS /v1/relay` — versioned relay protocol

Environment:

- `RELAY_HOST` defaults to `127.0.0.1`
- `RELAY_PORT` defaults to `4200`
- `RELAY_ID` defaults to `socially-woke-relay`
- `RELAY_ALLOWED_ORIGINS` is a comma-separated HTTP(S) origin allowlist; empty denies browser `Origin` headers while still allowing non-browser clients
- `RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE` defaults to `0`; only exact `1` unlocks structural-only local test mode

## Local development

```sh
pnpm --filter @socially-woke/relay lint
pnpm --filter @socially-woke/relay typecheck
pnpm --filter @socially-woke/relay test
pnpm --filter @socially-woke/relay test:integration
pnpm --filter @socially-woke/relay build
pnpm --filter @socially-woke/relay dev
```

Integration tests use real loopback WebSocket servers and clients. They do not mock socket transport.

## Multi-relay client

`MultiRelayClient` accepts an ordered list of credential-free `ws://` or `wss://` URLs. It validates the relay hello, creates a fresh signed subscription on each connection, verifies every delivered event again, tracks endpoint health, applies exponential cooldown, fails over and reconnects, suppresses duplicate event IDs across relays, and reports per-relay sequence gaps.

The client also fails closed: construction requires `authorizeEventKey`, and application callbacks run only after that authorizer approves the signed key. An unmistakable `dangerouslyAllowUnverifiedAdvisoryEvents` option exists solely for isolated tests. Server claims never replace client-side authorization.

Relay sequence numbers order accepted events only within one relay instance. They have no cross-relay or canonical meaning. The subscription factory should include each relay’s last seen sequence as `sinceSequence` when appropriate, and must create a fresh nonce on every reconnect.

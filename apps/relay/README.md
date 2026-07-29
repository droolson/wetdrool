# WokeSocial relay

This package is an independently replaceable real-time transport. Relay events are **advisory and non-canonical**: a notification never proves that a manifest is authentic, available, or anchored on WokeNet. Clients must verify the signed manifest, current key authorization, tombstones, access policy, and finalized on-chain anchor before changing durable state.

The service transports:

- new-post references;
- short-lived typing and coarse presence state;
- live reaction hints;
- community update references;
- opaque end-to-end encrypted message envelopes;
- encrypted livestream signaling metadata.

It never reads or logs an event payload, topic, recipient list, ciphertext, subscription relationship, raw protocol identity, or identity-derived hash. Logs contain operation names, public event kinds, relay-local connection IDs, and event IDs. `/metrics` exposes aggregate counters only.

## Security and privacy boundaries

Every publish and subscription authorization is a strict, versioned Ed25519 envelope. The signing key ID must be structurally attached to the declared WokeSocial identity. The server validates the payload hash, signature, exact-millisecond timestamps, expiry, nonce, audience, opaque topic, known critical fields, and event-specific size limits.

Structural key possession is not identity authorization: an attacker can generate a key and write its public key under someone else’s identity-shaped key ID. The server therefore starts **locked and not ready by default**, rejects every WebSocket upgrade, and accepts no event until a deployment injects `authorizeKey` backed by a current finalized identity/delegation projection. `authorizeSubscription` can additionally enforce opaque-topic access.

The shipped entrypoint can activate verified key authorization through
`RELAY_KEY_AUTHORIZER_URL`. Its bounded HTTP adapter nonce-binds each decision,
requires the authorizer to attest the matching WokeNet network and finalized
checkpoint, accepts only a very short freshness window, rejects redirects and
oversized responses, and fails closed on timeout or any malformed result. The
authorizer readiness endpoint is wired into relay `/readyz`. A second shipped
adapter, enabled by `RELAY_SUBSCRIPTION_AUTHORIZER_URL`, applies the same
network/checkpoint/freshness controls to opaque-topic subscription decisions.
When both adapters are configured, `/readyz` requires both dependencies.

Community-audience events are never delivered unless `authorizeSubscription`
is configured. The HTTP subscription adapter checks every requested topic/kind
set before accepting it, then stores the authorizer's bounded grant expiry.
Community delivery stops when that grant expires and requires a newly authorized
subscription; public and direct delivery continue only until the signed
subscription itself expires. Knowing an opaque topic is not membership proof;
the external authorizer must resolve it against current finalized community
policy and membership.

Isolated loopback development may explicitly set `RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE=1` (or the matching constructor option). The hello, publish, event, health, readiness, and metrics surfaces label that mode `unverified-local`. It must never be used for a shared or Internet-reachable relay.

Replay nonces, retained events, subscriptions, presence, per-IP transport/connection leases, relay sequence, and fanout are process-local and bounded. The deployed relay uses the shared fail-closed Redis rate limiter; process-local rate-limit state is available only to explicit loopback tests/development. Shared quotas alone do not make the relay horizontally safe: until replay/connection coordination and cross-replica pubsub are externalized and tested, run one relay replica. Typing, presence, and livestream signals are never retained. Other eligible events expire after at most two minutes even if their signed expiry is later. Encrypted-message ciphertext may be retained briefly for delivery, but delivery is not guaranteed.

Message confidentiality belongs to the upstream E2EE format. This relay validates only bounded ciphertext metadata; it does not encrypt, decrypt, escrow, inspect, or recover messages. Direct audiences necessarily expose the minimum recipient identity list required for routing, but that list is never retained separately or logged. Use opaque digest topics created with `relayTopicFor`, not human-readable relationship names.

The server also enforces:

- 64 KiB WebSocket frames with compression disabled;
- a 128-socket global transport cap enforced before HTTP parsing or WebSocket upgrade;
- 5-second header and keep-alive deadlines, a 10-second request deadline, at most 64 headers, and a 16 KiB header block;
- per-IP and per-identity rate limits;
- per-IP connection and per-connection subscription caps;
- backpressure disconnects;
- ping/pong heartbeat, idle expiry, and expiring subscription authorization;
- credential-free origin allowlisting for browser connections;
- privacy-safe HTTP health, readiness, policy, and Prometheus endpoints.

Replay nonces and fixed-window limiter keys use indexed expiry heaps. Expiry
pruning is proportional to the entries actually expired, and full-capacity
admission evicts in logarithmic maintenance work instead of scanning the entire
20,000-entry keyspace on every request.

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
- `RELAY_ID` defaults to `wokesocial-relay`
- `RELAY_ALLOWED_ORIGINS` is a comma-separated HTTP(S) origin allowlist; empty denies browser `Origin` headers while still allowing non-browser clients
- `REDIS_URL` is authenticated; nonlocal deployments require a nonlocal `rediss://` endpoint
- `RATE_LIMIT_KEY_SECRET` is one private canonical base64url 32-byte HMAC key, identical across replicas and stable through rolling deploys
- `RATE_LIMIT_DEPLOYMENT_ID` is the stable lowercase deployment namespace shared by replicas
- `RATE_LIMIT_DANGEROUSLY_USE_MEMORY_STORE=1` is a mutually exclusive loopback-development-only fallback
- `RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE` defaults to `0`; only exact `1` unlocks structural-only local test mode
- `RELAY_KEY_AUTHORIZER_URL` optionally enables the shipped finalized-state authorizer adapter; production requires HTTPS
- `RELAY_KEY_AUTHORIZER_READINESS_URL` optionally overrides the default `/readyz` URL derived from the authorizer URL; production requires HTTPS
- `RELAY_KEY_AUTHORIZER_BEARER_TOKEN` optionally supplies a 32–512 character bearer credential
- `RELAY_KEY_AUTHORIZER_TIMEOUT_MS` bounds the complete request and response-body operation and defaults to `2000`
- `RELAY_SUBSCRIPTION_AUTHORIZER_URL` optionally enables the shipped finalized opaque-topic policy/membership adapter; production requires HTTPS
- `RELAY_SUBSCRIPTION_AUTHORIZER_READINESS_URL` optionally overrides its derived `/readyz` URL; production requires HTTPS
- `RELAY_SUBSCRIPTION_AUTHORIZER_BEARER_TOKEN` optionally supplies its independent 32–512 character bearer credential
- `RELAY_SUBSCRIPTION_AUTHORIZER_TIMEOUT_MS` independently bounds the complete request and response-body operation and defaults to `2000`

The key-authorization endpoint accepts this strict JSON request:

```json
{
  "version": "wokesocial-relay-key-authorization-v1",
  "requestId": "019fa7ee-2b88-7360-888c-64c9897e9969",
  "identityId": "wokesocialid:v1:wokenet:v1:11111111111111111111111111111111:11111111111111111111111111111111:11111111111111111111111111111111",
  "keyId": "wokesocialid:v1:wokenet:v1:11111111111111111111111111111111:11111111111111111111111111111111:11111111111111111111111111111111#root/11111111111111111111111111111111",
  "purpose": "new-post",
  "issuedAt": "2026-07-28T12:00:00.000Z"
}
```

It must return the same `requestId`, `authorized`, literal
`"finalized": true`, the matching `networkId`, a decimal
`checkpointSlot`, and ISO `evaluatedAt`/`expiresAt` timestamps. The decision
must have been evaluated within the previous 30 seconds and may remain valid
for at most 15 seconds. Readiness is a credentialed `GET` whose JSON body must
contain `"ok": true`.

The subscription-authorization endpoint accepts this separate strict request:

```json
{
  "version": "wokesocial-relay-subscription-authorization-v1",
  "requestId": "019fa7ee-2b88-7360-888c-64c9897e9969",
  "identityId": "wokesocialid:v1:wokenet:v1:11111111111111111111111111111111:11111111111111111111111111111111:11111111111111111111111111111111",
  "topic": "uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "kinds": ["community-update", "new-post"],
  "requestedAt": "2026-07-28T12:00:00.000Z"
}
```

`topic` is an opaque 32-byte digest and `kinds` is a sorted, unique set. The
response uses the same strict `requestId`, `authorized`, literal
`"finalized": true`, matching `networkId`, decimal `checkpointSlot`, and ISO
`evaluatedAt`/`expiresAt` fields as the key decision. It has the same 30-second
evaluation-freshness and 15-second maximum grant window. Its readiness endpoint
also requires a JSON body containing `"ok": true`.

## Local development

```sh
pnpm --filter @wokesocial/relay lint
pnpm --filter @wokesocial/relay typecheck
pnpm --filter @wokesocial/relay test
pnpm --filter @wokesocial/relay test:integration
pnpm --filter @wokesocial/relay build
pnpm --filter @wokesocial/relay dev
```

Integration tests use real loopback WebSocket servers and clients. They do not mock socket transport.

## Multi-relay client

`MultiRelayClient` accepts an ordered list of credential-free `ws://` or `wss://` URLs. It validates the relay hello, creates and verifies a fresh signed subscription on each connection, verifies every delivered event again, and retains the verified subscription scope locally. Even a malicious relay cannot deliver an unsubscribed topic or kind, an unrelated direct audience, or an event after the signed subscription expires to the application callback. A scope violation closes that relay connection without advancing its delivery checkpoint.

The client also tracks endpoint health, applies exponential cooldown, fails over and reconnects, suppresses duplicate event IDs across relays, and reports per-relay sequence gaps.

The client also fails closed: construction requires `authorizeEventKey`, and application callbacks run only after that authorizer approves the signed key. An unmistakable `dangerouslyAllowUnverifiedAdvisoryEvents` option exists solely for isolated tests. Server claims never replace client-side authorization.

Relay sequence numbers order accepted events only within one relay instance. They have no cross-relay or canonical meaning. The subscription factory should include each relay’s last seen sequence as `sinceSequence` when appropriate, and must create a fresh nonce on every reconnect.

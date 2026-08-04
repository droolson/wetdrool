# Advisory relay protocol v1

## Authority model

The relay accelerates discovery. It does not participate in protocol consensus and cannot create canonical social state. All server frames containing events set:

```json
{
  "advisory": true,
  "canonical": false
}
```

A client that receives `new-post`, `community-update`, or `live-reaction` should treat it as a fetch hint. It must fetch the referenced canonical signed object, verify its CID/object ID/signature and current key delegation, resolve tombstones and access policy, then reconcile the finalized DroolNet index. Event arrival order is never a substitute for that process.

## Signed envelope

Published events contain a strict `message` and `proof`:

- `protocol`: `wetdrool-relay`
- `version`: `1`
- `identity`: a canonical protocol
  `wetdroolid:v1:droolnet:v1:<genesis-hash-base58-32>:<program-id-base58-32>:<identity-address-base58-32>`;
  pre-migration `wetdroolid:v1:solana:...` identifiers are rejected
- `keyId`: that identity’s `#root/` or `#delegation/` Ed25519 key ID
- exact UTC-millisecond `issuedAt` and `expiresAt`
- a 16-byte multibase base64url `nonce`
- an opaque digest `topic`
- a bounded public, community, or identity audience
- one supported event `kind` and its strict payload
- implemented critical-feature names and at most four non-critical extensions
- an Ed25519 proof over a domain-separated descriptor of the canonical message hash

Unknown fields are rejected. Unknown critical features are rejected. Events issued more than 30 seconds in the future, more than five minutes in the past, already expired, or valid for more than ten minutes are rejected. A relay remembers used identity/nonce pairs until expiry in a bounded replay window.

`relay.audience.v1` and `relay.expiry.v1` are always critical. Encrypted messages and livestream signaling must also mark `relay.e2ee.v1` critical. Typing and encrypted messages require a direct identity audience. Community update audience and payload community IDs must match.

## Authentication and subscription

The first server frame is `hello`. A client then sends one signed `subscribe` authorization containing 1–32 opaque topics, allowed event kinds, and optional last-seen relay sequences. The authorization has the same identity/key/timestamp/nonce proof rules as published events.

A publish is accepted only after subscription authentication and only when the publisher identity matches the authenticated connection. Production deployments must consult finalized on-chain key authorization through `authorizeKey`, with optional topic authorization through `authorizeSubscription`.

With no key authorizer, the server is `locked`: `/readyz` returns 503 and WebSocket upgrades return 503. The only bypass is the explicitly dangerous local-test option. Wire and operational surfaces distinguish `verified`, `unverified-local`, and `locked`; a locked relay never emits WebSocket frames.

The reusable client independently requires a key authorizer before delivering an event to application code. It does not trust a relay’s `verified` label as authorization evidence. Structural-only delivery requires a separate, unmistakable test-only opt-in.

The server responds with:

- `subscribed` after accepting authorization;
- `published` after accepting and assigning an event a relay-local sequence;
- `event` for live or retained delivery;
- a bounded `error` code without echoing private input.

## Event kinds and retention

| Kind | Purpose | Retained |
| --- | --- | --- |
| `new-post` | Object/CID anchor discovery hint | Yes, bounded |
| `typing` | Short-lived state with optional opaque context tag | Never |
| `presence` | `online`, `away`, or `offline` only | Never |
| `live-reaction` | Add/remove reaction hint for an object | Yes, bounded |
| `community-update` | Community object/update hint | Yes, bounded |
| `encrypted-message` | Opaque upstream E2EE ciphertext | Yes, bounded |
| `livestream-signal` | Encrypted offer/answer/candidate metadata or clear end marker | Never |

Eligible retention is capped globally, per topic, by signed expiry, and at two minutes. Retained delivery still passes audience and event-kind filters. There is no delivery guarantee or durable mailbox.

`new-post.slot` is an unsigned 64-bit decimal string, not a JavaScript number,
so large DroolNet slots remain lossless. A supplied Solana-compatible
transaction signature must be canonical base58 that decodes to exactly 64
bytes.

Presence has no device, location, contact-graph, or activity-detail fields. Typing has only start/stop plus an optional opaque digest. Livestream SDP/ICE detail belongs inside `encryptedMetadata`. Logs and metrics never contain topics, audiences, ciphertext, or payloads.

## Ordering, deduplication, and failover

`relaySequence` is monotonically increasing within one running relay. Gaps mean a client should reconcile; they do not mean canonical events are missing. On reconnect, `sinceSequence` requests eligible retained frames newer than a relay-local sequence.

The signed envelope hash is the cross-relay `eventId`. Clients deduplicate by `eventId`, not sequence. Two relays can assign different sequences and receipt times to the same signed event. The reusable client tracks sequence independently by `relayId`, reports gaps, and verifies the signed event before delivery to application code.

## Close and error behavior

Malformed, oversized, binary, replayed, unauthorized, and invalid-signature frames receive bounded error codes where possible. Repeated non-retryable violations close the socket. Slow consumers are disconnected when buffered bytes exceed policy. Expired authentication and idle/failed heartbeat connections are closed without retaining private connection state.

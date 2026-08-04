# `@wetdrool/rate-limit`

Shared, fail-closed fixed-window rate limiting for WetDrool services and the
Relay.

The production implementation stores counters in Redis through one atomic Lua
operation. Redis keys contain HMAC-SHA-256 digests of both the logical namespace
and raw client identity; IP addresses, account IDs, and other caller keys are
never sent to or persisted by Redis. A command timeout and finite retry count
bound request latency. An ambiguous retry can conservatively count the request
twice, but it cannot admit extra traffic.

```ts
const limiter = new RedisFixedWindowRateLimiter({
  transport: processSharedRedisTransport,
  hmacSecret: secretBytes,
});

const decision = await limiter.consume({
  namespace: 'relay:publish',
  key: remoteAddress,
  limit: 30,
  windowMs: 60_000,
});
```

Backend failures throw `RateLimitBackendUnavailableError` with stable code
`RATE_LIMIT_BACKEND_UNAVAILABLE` and `statusCode` 503. Quota exhaustion is the
only case that resolves with `allowed: false`; HTTP integrations should turn
that decision into 429. There is no Redis-to-memory fallback.

The transport must propagate the supplied `AbortSignal` into the Redis command
itself and bound its offline queue/reconnect behavior. A wrapper that merely
races an unabortable Redis promise is not safe: timed-out EVALs could remain
queued and execute later. Concrete client setup therefore lives with runtime
configuration rather than in this client-agnostic package.

For the `@fastify/rate-limit` 10.3+ custom-store runtime contract, pass
`createFastifyRateLimitStore({ limiter, namespace })` as `store`, leave
`skipOnError` false, and close the shared limiter from the Fastify lifecycle.
The returned store implements `incr`, the 11.1 runtime's non-mutating `read`,
and route-isolating `child`.

The separate memory implementation requires the literal runtime opt-in
`unsafeAllowMemory: true`. It is bounded and intended only for deterministic
tests or single-process loopback development.

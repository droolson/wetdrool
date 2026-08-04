# WetDrool feed service

This package is an independently replaceable, deterministic feed engine. It ranks caller-provided signed projection summaries; it is **not** a canonical protocol authority and does **not** verify projection signatures, DroolNet anchors, or content authenticity. Every response says so explicitly with `canonical: false`.

## Ranking behavior

The provider implements:

- `chronological`, `following`, `community`, and `media` modes with explicit
  newest-first scope rules;
- `recommended` mode using a published, versioned policy;
- `trending` mode using a caller-supplied 15-minute to 24-hour observation
  window and a logarithmically capped interaction-velocity boost; and
- `third-party` order reconciliation, which applies local safety filters without
  claiming to verify the external provider's order.

`recommended` mode:

- boosts for declared topic interests, followed authors, freshness (36-hour half-life), joined communities, explicit positive/negative feedback, and popularity capped at 10 points;
- penalties for repeated authors/topics, duplicate or repost-loop signals, suspected spam, and an explicitly supplied rage-bait risk value;
- deterministic tie-breaking by publication time and then item ID;
- greedy slate diversification, so already-selected authors, topics, and duplicate clusters receive transparent repetition penalties.

The service never accepts sensitive-trait attributes. Spam, duplicate, sensitive-content, and rage-bait risk values are supplied by the caller; this service does not inspect private content or infer those risks.

When `behavioralPersonalization` is false, feedback and prior-exposure history contribute zero points. Declared interests, follows, and community membership remain usable because they are explicit controls rather than inferred behavior. Within-page repetition is still reduced to diversify the current response without consulting history. When preferences are reset, or when no effective preference signals exist, `recommended` falls back to chronological ordering.

Trending deliberately ignores lifetime popularity and does not inspect content.
Every trend input names its bounded window, observation time, unique-engager
count, and interaction counts. The values remain caller assertions and are
labeled as such.

Blocks, mutes, muted keywords, and the sensitive-content threshold are applied
after mode scoping and before ordering in every mode. A third-party order can
never reinsert filtered items. Clients are still required to reapply their
controls because this service cannot prove the viewer context or upstream
tombstone policy.

## HTTP contract

- `GET /healthz` — process liveness
- `GET /readyz` — readiness, with an injectable dependency check
- `GET /openapi.json` — OpenAPI 3.1 source
- `GET /v1/provider` — versioned replaceable-provider capability descriptor
- `GET /v1/policy` — exact public weights and caps
- `POST /v1/rank` — validate, filter, rank, explain, and paginate up to 500 summaries

Request bodies are capped at 512 KiB, input arrays and strings have strict schema caps, page size is at most 50, requests time out after 5 seconds, and the default rate limit is 60 requests per minute per client IP.

The request must supply an explicit `asOf` timestamp; the engine never reads wall-clock time, which makes ranking reproducible. Item publication times, projection issue times, and trend observations later than `asOf` are rejected instead of receiving an artificial boost. Each item contains a `signedProjection` receipt with a source indexer and checkpoint that is proxied unchanged. Response items label that signature and their content authenticity as not verified.

Responses identify the applied provider, endpoint, algorithm and semantic
version, source checkpoints, upstream tombstone/moderation assertions, local
safety filtering, and a deterministic five-minute validity window. The
reference descriptor is sufficient for another service to implement the same
request/response contract; no registry or flagship endpoint is authoritative.

Cursors are opaque base64url JSON containing a hash of the ranking inputs, the offset, and the prior item ID. A cursor is rejected if the inputs or resulting order change. Cursors are continuity tokens, not authorization credentials.

## Local development

```sh
pnpm --filter @wetdrool/feed-service typecheck
pnpm --filter @wetdrool/feed-service test
pnpm --filter @wetdrool/feed-service build
pnpm --filter @wetdrool/feed-service dev
```

Environment:

- `FEED_SERVICE_HOST` defaults to `127.0.0.1`
- `FEED_SERVICE_PORT` defaults to `4100`
- `FEED_SERVICE_CORS_ORIGINS` is a comma-separated allowlist; empty disables browser CORS
- `REDIS_URL` is authenticated; nonlocal deployments require a nonlocal `rediss://` endpoint
- `RATE_LIMIT_KEY_SECRET` is one private canonical base64url 32-byte HMAC key, identical across replicas and stable through rolling deploys
- `RATE_LIMIT_DEPLOYMENT_ID` is the stable lowercase deployment namespace shared by replicas
- `RATE_LIMIT_DANGEROUSLY_USE_MEMORY_STORE=1` is a mutually exclusive loopback-development-only fallback

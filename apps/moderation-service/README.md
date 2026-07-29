# WokeSocial moderation service

This package is a replaceable, non-authoritative moderation provider for
WokeSocial. It verifies signed public moderation labels, accepts signed
restricted reports and appeals, and maintains a durable operator case ledger.
It does not edit signed user content or make a moderation provider’s decision
universal protocol truth.

The durable ledger is implemented for PostgreSQL. Restricted bodies and ledger
details use application-layer AES-256-GCM encryption; public labels remain
signed, independently verifiable protocol objects. The in-memory adapter exists
for tests and isolated development only.

## Production gate

The checked-in server intentionally has no concrete production identity
authorizer or operator SSO integration. It therefore remains locked unless a
deployment composition injects both:

- an `authorizeObject` verifier backed by current finalized identity,
  delegation, and provider policy; and
- an `authorizeOperator` callback that returns short-lived, purpose-bound,
  permission-scoped operator assertions.

Production also requires PostgreSQL and a data-key ring. Missing persistence,
keys, or signed-object authorization keeps `/readyz` at `503`; production never
falls back to memory or unverified authorization. Bearer credentials are
validated by the injected operator authorizer and are never stored by this
service.

`MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE=1` is available only outside
production for isolated development. Health, readiness, and policy responses
identify that mode as `unverified-local`.

## Storage and trust boundaries

| Data | PostgreSQL representation | At-rest treatment |
| --- | --- | --- |
| Signed moderation labels | `moderation_public_objects` | Public canonical signed bytes |
| Signed reports and appeals | `moderation_restricted_objects` | Encrypted canonical bytes |
| Current case state/version | `moderation_cases` | Minimal workflow metadata |
| Case history | `moderation_case_events` | Append-only row; actor, reason, and note encrypted |
| Actions and status history | `moderation_actions`, `moderation_action_status_events` | Minimal kind/timing metadata; targets, policy details, notes, actors, and status details encrypted |
| Reviews | `moderation_reviews` | Minimal outcome/linkage metadata; rationale, restoration, actor, and override reason encrypted |
| Access decisions | `moderation_access_events` | Minimal operation/result metadata; actor, assertion, purpose, and requested case encrypted |
| Legal holds | `moderation_legal_hold_events` | Minimal hold state metadata; actor and reason encrypted |

Reports and appeals are deliberately separate from public-label storage. Intake
responses never echo their CID, envelope, evidence, or summary. PostgreSQL is an
operator record, not canonical protocol state.

Ledger tables reject both `UPDATE` and `DELETE` through database triggers.
Authorized lifecycle changes append events and update only the current case
snapshot. The runtime role has no table-delete privilege and can update only
that snapshot; this is an auditable operational ledger, not an immutable or
tamper-proof blockchain log.

### Encryption

Restricted data uses Node’s AES-256-GCM implementation with:

- a random 96-bit nonce and 128-bit authentication tag;
- envelope version `1` and an explicit key ID;
- authenticated associated data bound to
  `woke.social/moderation/aes-256-gcm/v1`, the record type, and the exact record
  ID;
- strict canonical unpadded base64url parsing; and
- a versioned key ring containing at most 16 keys.

New writes use `activeKeyId`. Old keys must stay in the ring until every row
written with them has expired or been re-encrypted by a separately reviewed
rotation procedure. Readiness authenticates representative ciphertext for
every key version and every encrypted ledger record class, so a missing or
incorrect required key fails closed.

The environment value is JSON:

```json
{
  "activeKeyId": "moderation-2026-07",
  "keys": {
    "moderation-2026-07": "<exactly 32 random bytes, unpadded base64url>"
  }
}
```

Generate and store production keys in an approved secret manager. Do not commit
them, paste them into tickets, or reuse database credentials as data keys.

## Case lifecycle and authorization

Every report creates case version 1 in `received`. Mutations require
`expectedVersion`; concurrent or stale writers receive `case-conflict`.
Transitions are explicit and append a new event:

- intake and triage: `received` → `awaiting-triage` or `under-review`;
- investigation: `under-review` ↔ `information-requested`, or to
  `action-taken`, `no-action`, `referred`, or `closed`;
- appeal: an accepted signed appeal moves an existing case to `appealed`,
  including reopening a manually closed case;
- resolution: action/no-action/referred/appealed states have only the documented
  review or closure paths; `closed` has no manual outgoing transition.

The exact transition matrix is enforced by `canTransitionCase` in
`src/models.ts`.

Operator permissions are intentionally narrow:

| Permission | Capability |
| --- | --- |
| `case.read` | Read a restricted report and its appeals |
| `case.triage` | Move a case through triage/information/referral states |
| `case.review` | Record resolution or closure transitions |
| `case.act` | Apply a regular policy-bound action |
| `case.emergency` | Apply an emergency safety action |
| `appeal.review` | Review an action against an accepted appeal |
| `emergency.review` | Independently review an emergency action without an appeal |
| `conflict.override` | Permit a reasoned self-review exception when separately scoped |
| `case.audit` | Read the full restricted ledger |
| `case.legal-hold` | Apply or release a reasoned legal hold |

Each callback receives the report ID, declared purpose, authorization value,
and exact operation. Returned assertions are strictly validated, must be
unexpired, and must contain the permission used by the operation. Authorization
exceptions and missing scopes fail closed and are recorded as denied access
when persistence is available.

### Actions, reviews, and conflicts

Actions are accepted only for `under-review` or `appealed` cases. They must cite
a policy ID/version and rule, identify an exact target and scope, record
consequences and appeal eligibility, and use bounded timestamps:

- cooldowns, temporary restrictions, membership suspensions, and emergency
  actions require an expiry;
- emergency actions additionally require an independent-review deadline after
  effect and before expiry;
- appeal eligibility and an appeal deadline must be declared together.

Reviews are accepted only while the case is `action-taken` or `appealed` and
while the action status is `active` or `review-required`. Appeal review requires
an eligible action and an appeal received by its deadline. The no-appeal review
path is reserved for emergency actions.

The operator who applied an action cannot review it unless the assertion also
contains `conflict.override` and the review records a substantive override
reason. The exception and reason are retained in the append-only ledger.

Maintenance deterministically adds one `review-required` event when an
emergency deadline passes and one `expired` event when a temporary action
expires. Repeated or concurrent runs do not duplicate those states.

## HTTP API

OpenAPI 3.1 is served from `GET /openapi.json`.

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | Process liveness and non-secret mode/storage metadata |
| `GET /readyz` | Authorization, database, and encryption readiness |
| `GET /v1/policy` | Advisory/non-canonical policy and safety posture |
| `GET /v1/labels` | Active signed labels for one exact subject |
| `POST /v1/labels` | Idempotent signed-label intake |
| `POST /v1/reports` | Restricted signed-report intake |
| `POST /v1/appeals` | Restricted signed-appeal intake |
| `GET /v1/cases/{reportId}` | Purpose-authorized restricted case read |
| `GET /v1/cases/{reportId}/ledger` | `case.audit` ledger read |
| `POST /v1/cases/{reportId}/transitions` | Optimistic lifecycle transition |
| `POST /v1/cases/{reportId}/actions` | Policy-bound action |
| `POST /v1/cases/{reportId}/reviews` | Appeal or emergency review |
| `POST /v1/cases/{reportId}/legal-hold` | Reasoned hold state change |
| `GET /v1/transparency` | Privacy-filtered aggregate report |

Restricted endpoints require `Authorization` plus
`x-moderation-purpose`. All mutation bodies use strict runtime schemas that
reject unknown properties. Request bodies are capped at 196,608 bytes. Logs
redact authorization, cookies, and bodies; responses set no-store, a
deny-by-default CSP, and other API security headers.

All responses identify this provider as `advisory: true` and
`canonical: false`.

## Retention, legal holds, and transparency

The default maintenance interval is five minutes. Each pass bounds due-action
review and expiry work. Releasing a legal hold requires another scoped,
reasoned, version-checked event.

Destructive retention is deliberately disabled in the long-running runtime.
`MODERATION_CLOSED_CASE_RETENTION_MS` and `MODERATION_RETENTION_BATCH_SIZE`
remain policy inputs for a future separate executor, but maintenance currently
reports `casesRemoved: 0`. Before production, that executor must use a distinct
credential and reviewed authorization/evidence-preservation workflow, enforce
the approved minimum age and legal holds inside its trust boundary, and prove
bounded deletion without granting the web runtime `DELETE`. Until then,
operators must treat closed moderation records as retained and must not claim
automated deletion compliance.

Transparency windows must use exact UTC millisecond timestamps, have positive
length, and span at most 366 days. Categories smaller than the configured cell
size are combined as `other-or-suppressed`. Triage and appeal medians remain
`null` until their sample meets that threshold. No case, subject, actor,
evidence, note, or object identifier is returned.

## Configuration

| Variable | Default | Constraint |
| --- | --- | --- |
| `APP_ENV` | unset | `development`, `test`, `staging`, or `production` |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `MODERATION_HOST` | `127.0.0.1` | Listen host |
| `MODERATION_PORT` | `4400` | 1–65535 |
| `MODERATION_ALLOWED_ORIGINS` | empty | Comma-separated credential-free HTTP(S) origins |
| `MODERATION_DATABASE_URL` | unset | DML-only runtime PostgreSQL URL; must be paired with data keys |
| `MODERATION_DATABASE_MIGRATION_URL` | unset | Dedicated DDL URL used only by the migration command |
| `MODERATION_DATA_KEYS` | unset | Strict key-ring JSON; must be paired with PostgreSQL |
| `MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE` | `0` | `1` forbidden in staging and production |
| `REDIS_URL` | unset | Authenticated; nonlocal deployments require a nonlocal `rediss://` endpoint |
| `RATE_LIMIT_KEY_SECRET` | unset | Private canonical base64url 32-byte HMAC key; identical across replicas and stable through rolling deploys |
| `RATE_LIMIT_DEPLOYMENT_ID` | `local-development` locally | Stable lowercase deployment namespace shared by replicas; explicit outside development |
| `RATE_LIMIT_DANGEROUSLY_USE_MEMORY_STORE` | `0` | `1` is mutually exclusive with Redis and restricted to loopback development |
| `MODERATION_MAINTENANCE_INTERVAL_MS` | `300000` | 60 seconds–24 hours |
| `MODERATION_DUE_ACTION_BATCH_SIZE` | `500` | 1–5000 |
| `MODERATION_RETENTION_BATCH_SIZE` | `100` | 1–5000 |
| `MODERATION_CLOSED_CASE_RETENTION_MS` | `31536000000` | 1 day–10 years |
| `MODERATION_TRANSPARENCY_MINIMUM_CELL_SIZE` | `5` | 3–100 |

Staging and production remote origins must use HTTPS. `https://woke.social` is
the canonical web origin. Both legacy redirect-only hostnames are explicitly
rejected as application origins. Staging and production database URLs must
contain exactly one `sslmode=verify-full`, and process-wide TLS verification
cannot be disabled. Missing durable persistence selects the locked store in
both nonlocal tiers; only the local deployment policy may use memory.

## Local operation

Start local PostgreSQL using the repository infrastructure, configure a local
database URL and a throwaway 32-byte key, then run:

```sh
MODERATION_DATABASE_MIGRATION_URL='postgresql://moderation_migration@localhost/wokesocial' \
pnpm --filter @wokesocial/moderation-service migrate
MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE=1 \
  pnpm --filter @wokesocial/moderation-service dev
```

The migration runner:

- discovers numbered SQL files in order;
- requires `MODERATION_DATABASE_MIGRATION_URL` and never falls back to the runtime URL;
- takes one session-scoped PostgreSQL advisory lock before creating its ledger;
- applies each migration transactionally; and
- records its lowercase SQL SHA-256 once in `moderation_schema_migrations`.

The applied ledger must be an exact ordered prefix of the nonempty packaged
migration set. Missing checksums, unknown versions, gaps, reordering, or changed
SQL fail closed; legacy rows are not automatically backfilled. The runner
revokes runtime ledger writes before integrity validation, including on a
failed migration. Follow the verified legacy procedure in
`docs/OPERATIONS.md` rather than guessing a checksum.

The long-running moderation server never runs DDL and does not read the
migration URL. Grant schema privileges only to the one-shot migration role and
grant its runtime role only the DML privileges it needs.

`0001_moderation_case_ledger.sql` creates the separated stores and ledger.
`0002_append_only_retention.sql` makes retention cascade-compatible without
mutating append-only rows and adds the unlinked-access retention index.
`0003_guarded_retention.sql` rejects ledger/root deletion, removes any
pre-release runtime retention function, and narrows the runtime to
`SELECT`/`INSERT` plus `UPDATE` only on the current case snapshot.

There are deliberately no destructive automatic down migrations. Before a
production migration, take and verify a database backup. Roll back application
code only when its schema compatibility is known; roll back data through
backup/point-in-time restore or a reviewed forward corrective migration.

## Verification

From the repository root:

```sh
pnpm --filter @wokesocial/moderation-service lint
pnpm --filter @wokesocial/moderation-service typecheck
pnpm --filter @wokesocial/moderation-service test
pnpm --filter @wokesocial/moderation-service test:integration
pnpm --filter @wokesocial/moderation-service build
pnpm audit --prod
```

The PostgreSQL suite uses `MODERATION_INTEGRATION_DATABASE_URL`, then
`DATABASE_URL`, then the repository’s local PostgreSQL default. It verifies
migration replay, concurrent idempotency and CAS, public/restricted separation,
ciphertext confidentiality, append-only triggers, restart durability, wrong-key
readiness, emergency review/expiry, appeal review, legal holds, and bounded
retention.

## Explicit non-goals and limitations

This service does not currently provide:

- the web reporting or operator-console UI;
- private-message decryption or selective-disclosure handling;
- a specialist NCII or child-safety workflow (categories and escalation
  architecture are not such a claim);
- automated classification, irreversible automated enforcement, feed
  filtering, or indexer enforcement;
- concrete production operator SSO or finalized identity/delegation
  authorization;
- a new public protocol object type for internal case/action/access rows; or
- a global speech authority.

Production launch still requires authorizer integration, database roles and
backups, secret-manager/KMS procedures, alerting, abuse/rate-limit tuning,
privacy and legal review, and an independent security assessment of the
moderation operator deployment.

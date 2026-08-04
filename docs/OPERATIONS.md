# Operations

Last reviewed: 2026-07-29

## Document status

This is the target operations contract for WetDrool and its DroolNet program
deployment on Solana. No DroolNet program is deployed to devnet or
mainnet-beta, no staging or production service is deployed, and there are no
production alerts, backups, runbook automations, on-call schedules, or
completed incident exercises.

The local foundation is operationally testable: PostgreSQL, Redis, and Kubo have
health-checked Compose services; authentication, feed, relay, moderation,
media-worker, and ClamAV profiles have hardened OCI builds and explicit
liveness/readiness; the indexer has structured logging, an OpenTelemetry
ingestion span, and a read-only API. Container integrations exercise
PostgreSQL rebuild, Kubo publication, WebAuthn persistence, real media
processors, and live ClamAV benign/malware verdicts. A non-release Expo/React
Native Seeker foundation also exists with Mobile Wallet Adapter connection
code, exact deployment checks, a read-only feed, and tests; no Seeker-device or
signed-APK release evidence exists. These local checks do not satisfy any
production-readiness claim. Unless a section says otherwise, the controls and
procedures below remain **Planned**.

The canonical public origin is `https://wetdrool.com`. `droolhouse.com` and
`www.droolhouse.com` are redirect-only legacy origins and must never become
an alternate application, identity namespace, RPC surface, or cookie scope.

DroolNet is the WetDrool protocol and smart-contract deployment layer on
Solana. Solana validators and RPC providers are external dependencies. No
`$DROOL` mint exists. The legacy lamport-denominated payment ABI is quarantined,
cannot execute or be unpaused, and never grants entitlements. Portable metadata
may truthfully identify SOL or an exact SPL asset but may not relabel either as
`$DROOL`.

This document does not authorize production-network activity. See
[DEPLOYMENT.md](./DEPLOYMENT.md) for the explicit manual production boundary and
[SECURITY.md](./SECURITY.md) for security gates.

## Operating principles

- Preserve user safety and key integrity before availability metrics.
- Treat finalized DroolNet program state on the exact Solana deployment and
  signed protocol objects as canonical; treat service databases as replayable
  projections.
- Keep disposable Solana local-validator evidence separate from devnet,
  mainnet-beta, provider-diversity, Seeker-device, and signed-APK evidence in
  alerts, dashboards, releases, and incident records.
- Treat SOL as the Solana network-fee asset. Do not execute the quarantined
  payment ABI or claim that `$DROOL` exists.
- Prefer degraded read-only behavior over ambiguous success or unsafe writes.
- Never declare a transaction, publication, deletion, or recovery complete before
  its defined confirmation state.
- Make RPC, gateway, storage, indexer, relay, and feed providers replaceable.
- Collect enough evidence to diagnose failures without logging private content or
  credentials.
- Use reviewed runbooks, separation of duties, and time-bounded access for
  high-impact actions.
- Communicate uncertainty, affected networks, and deletion/permanence limits
  plainly.

## Roles and separation of duties

An organization may combine roles before production, but conflicting approval
roles MUST remain separated for high-impact changes.

| Role | Responsibilities | Must not do alone |
| --- | --- | --- |
| Incident commander | Coordinates response, priorities, timeline, and handoffs | Deploy unreviewed program changes or suppress required notification |
| Operations lead | Service health, capacity, failover, database and queue operations | Access user private content without approved purpose |
| Security lead | Compromise analysis, containment, evidence, credential rotation | Unilaterally accept critical residual risk |
| DroolNet release authority | Verifies the reviewed SBF artifact, exact Solana deployment, and program-authority state | Satisfy production multisig quorum alone or substitute local-validator evidence for public-deployment evidence |
| Android release authority | Verifies source, dependencies, package/certificate identity, reproducible APK, signing provenance, and distribution target | Control signing custody, approve security/privacy review, and publish alone |
| Safety lead | User harm, moderation escalation, evidence minimization | Expand evidence access or retention without review |
| Communications lead | Operator/user/status updates | Make legal conclusions or unsupported attribution |
| Privacy/legal contact | Advises notification, preservation, disclosure, and retention | Alter technical evidence without audit trail |
| Scribe | Maintains timestamped decisions and evidence links | Publish sensitive incident artifacts |

Production requires a primary and secondary on-call rota, escalation contacts,
out-of-band communications, and a tested method for reaching multisig signers.

## Service criticality and source of truth

| Component | Role | Canonical? | Expected failure behavior |
| --- | --- | --- | --- |
| DroolNet program on Solana and finalized ledger observations | Protocol authorization and compact public state | Yes, within documented protocol scope | Writes pause or remain pending; clients retain safe read/degraded mode |
| Signed content manifests | Verifiable public/restricted object representation | Yes for represented content | Alternate provider retrieval; reject unverifiable bytes |
| PostgreSQL indexer database | Query projection | No | Fail over or rebuild from protocol data |
| Redis | Cache, queue coordination, rate limiting | No | Lose cache safely; sensitive limits fail safe; reconcile queued work |
| Indexer | Reconstruction and query convenience | No | Mark stale, replay from checkpoint, permit alternate indexer |
| Relay | Low-latency delivery | No | Reconnect elsewhere and reconcile durable signed state |
| Feed provider | Ranking convenience | No | Fall back to chronological/following and enforce local safety controls |
| Solana RPC provider | Transport to the selected Solana cluster | No | Health-score and switch; validate genesis/program/finality; cross-check sensitive reads |
| Seeker Android client and MWA wallet | Native product surface and wallet handoff | No protocol authority beyond the exact user-approved signature | Fail closed on callback/account/network/transaction mismatch; preserve read-only or disconnected state |
| Content gateway/pinner | Content transport and availability | No | Hash-verify alternate provider; expose degraded replication |
| Media worker | Derivative convenience | No | Queue safely; permit protocol-compliant independent media |
| ClamAV daemon | Private malware-scanning dependency | No | Media finalization fails closed; preserve resumable upload for safe retry |
| Authentication service | Replaceable WebAuthn/session convenience | No protocol authority | Existing protocol keys remain authoritative; service ceremonies and sync fail closed |
| Moderation service | Operated-client policy and workflow | No global authority | Preserve personal controls; publish policy and action status |

## Service levels and error budgets

Exact SLOs require measured capacity and product review. Until then, proposed
numbers are planning targets, not commitments:

| Signal | Proposed target | Measurement notes |
| --- | --- | --- |
| Public web/API availability | 99.9% monthly | Exclude declared maintenance only if users received notice |
| Read API p95 latency | Under 500 ms | Measure at public edge by region and endpoint class |
| Relay connected delivery p95 | Under 2 seconds | Excludes offline recipients; reconciliation still required |
| Indexer finalized-head lag | Under 60 seconds normally | Report chain health and provider lag separately |
| Critical auth/revocation correctness | 100% | Errors consume no acceptable error budget |
| Verified content integrity | 100% | Hash/signature mismatch is a security event, not an availability success |
| Restore-point objective | 15 minutes for noncanonical operator data | To be validated against provider and cost |
| Service recovery objective | 4 hours for critical flagship services | Protocol and alternate clients may remain available |
| Full projection rebuild | Defined after benchmark | Must be measured from deployment slot at production scale |

Before production, load tests, regional measurements, dependency budgets, paging
thresholds, and a policy for stopping releases when error budgets are exhausted
MUST be approved.

## Observability

Implemented services expose structured request logs plus distinct health and
readiness signals; the indexer also has request IDs and a tracing hook around
ingestion. Authentication retention cleanup is bounded and nonoverlapping, and
media readiness verifies authorization, storage, processors, ClamAV reachability,
and signature-database freshness. No collector/exporter, metrics backend,
dashboards, paging, approved log retention, or production telemetry deployment
exists. All requirements below beyond those subsets are **Planned**.

### Required common fields

- Timestamp in UTC, service, environment, region, instance, release digest.
- Trace/correlation ID generated independently of user content.
- Operation name, stable result code, duration, retry count.
- Solana cluster, observed genesis hash, DroolNet program ID/deployment slot,
  RPC provider alias, observed slot, commitment, and checkpoint where relevant.
- The immutable per-network `INDEXER_PROFILE_V2_ACTIVATION_SLOT` in indexer
  release and rebuild records.
- An explicit `local-validator` marker plus Solana/Anchor tool versions for
  tests that intentionally exercise the disposable development path.
- Queue name and lag, database migration version, storage provider alias, and
  manifest validation result where relevant.

Telemetry MUST NOT include private keys, seed phrases, raw authorization headers,
cookies, passkey assertions, message plaintext, restricted content keys, email
addresses by default, IP addresses without documented purpose/retention,
moderation evidence, or full signed transaction payloads.

### Core metrics

- Request rate, errors, latency, saturation, and dependency timeouts.
- Authentication/revocation/recovery result counts without sensitive payloads.
- Database connections, query latency, replication and backup health.
- Redis availability, memory, evictions, queue depth, oldest job, retries, and
  dead letters.
- Indexer observed/finalized slot, lag, checkpoint age, reorg count, accepted,
  pending, and terminal manifest counts, oldest due hydration, hydration
  attempts/latency, invalid event/manifest count, and replay throughput.
- RPC health, genesis mismatch, slot divergence, throttling, and failover.
- Storage publish/retrieve latency, hash mismatch, replication, and deletion
  request state.
- Relay connections, delivery latency, reconnects, deduplication, and dropped
  envelopes.
- Media scan/transcode concurrency, failure class, resource-limit rejection,
  staging age, ClamAV engine/database version, database age, readiness failure,
  and scan verdict counts without filenames, bytes, or signature names.
- Sponsor transaction count, denial reason, budget, simulation mismatch, and
  finalized spend.
- Program authority and binary hash changes.

### Alert design

Alerts MUST be actionable, routed to an owning role, deduplicated, and linked to
a runbook. Page for user-impacting or security-critical conditions; create
nonpaging tickets for trends. Every page must identify environment, genesis,
and program so local-validator, devnet, and mainnet-beta evidence cannot be
conflated.

High-priority pages include:

- Production program authority or binary changes.
- Private-key/credential exposure or suspected plaintext message disclosure.
- Content hash/signature validation failures above isolated corrupt-provider
  noise.
- Wrong-cluster/genesis detection.
- Sponsor loss ceiling or transaction-shape rejection surge.
- Indexer finalized lag or divergence beyond threshold.
- Authentication/recovery abuse, revocation failure, or broad authorization
  denial anomaly.
- Database unavailability, backup failure, or restore-point breach.
- ClamAV database beyond the configured age, engine/version drift, repeated
  scanner unavailability, or an unexpected benign/EICAR deployment check.
- Severe safety escalation in operated services.

## Operational states

Services and the user interface MUST distinguish:

- **Healthy**: dependencies and correctness checks within targets.
- **Degraded**: reduced providers/features, but integrity guarantees hold.
- **Read-only**: safe reads available; mutations intentionally stopped.
- **Reconciling**: accepted work is being checked or replayed; success not yet
  claimed.
- **Unavailable**: service cannot uphold its contract.
- **Security hold**: operation blocked due to suspected compromise or integrity
  failure.

Status endpoints and public messaging must not show “operational” merely because
processes are alive.

## Incident severity

| Severity | Examples | Initial acknowledgement target |
| --- | --- | --- |
| SEV-0 | Active production program-authority compromise, widespread key/message compromise, ongoing unauthorized fund movement | Immediate page; incident command as soon as safely possible |
| SEV-1 | Account takeover at scale, payment diversion, verified content-integrity failure, critical flagship outage with no safe workaround | 15 minutes |
| SEV-2 | Material degradation, bounded sensitive-data exposure, indexer divergence, major provider outage with workaround | 30 minutes |
| SEV-3 | Limited impact, noncritical defect, capacity trend, isolated provider corruption caught by validation | Next business response window |

Targets are **Planned** and require staffing validation. Severity may increase as
facts change.

## Incident lifecycle

1. **Detect and validate**: record time, reporter, environment, cluster, release,
   symptoms, and confidence without copying unnecessary private data.
2. **Assign command**: name incident commander, security/operations/safety leads,
   and scribe; move coordination to an out-of-band channel if compromise is
   possible.
3. **Protect users**: stop unsafe writes, sponsorship, publication, recovery, or
   deployment while retaining safe reads and personal safety controls.
4. **Contain**: revoke scoped credentials, isolate providers/instances, preserve
   volatile evidence, and prevent automatic destruction of useful records.
5. **Assess integrity**: compare signed objects, program/binary/authority state,
   finalized chain observations, configuration, and immutable artifacts.
6. **Eradicate and recover**: use reviewed artifacts, clean credentials, fresh
   projections, and reconciled queues; do not restore suspected binaries.
7. **Verify**: run security, integrity, smoke, failover, and user-impact checks
   before declaring recovery.
8. **Communicate**: provide timestamped facts, affected surfaces, user actions,
   and uncertainty; coordinate legal notification when required.
9. **Learn**: complete a blameless review with root causes, control failures,
   timeline, owners, deadlines, evidence, and threat-model updates.

Incident access and decisions MUST be recorded. Sensitive evidence is segregated
and retained only for an approved purpose and period.

## Runbook: RPC outage or manipulation

Trigger: elevated errors/throttling, slot lag, genesis mismatch, divergent account
state, simulation inconsistency, or false confirmations.

1. Mark the provider unhealthy and stop sending new signed writes through it.
2. Determine whether this is availability degradation or possible integrity
   manipulation.
3. Compare genesis hash, finalized slot/block identity, critical accounts, and
   program state using independent providers.
4. Switch reads and submission to a preconfigured healthy provider; do not copy
   privileged credentials into the client.
5. Reconcile every transaction reported pending or confirmed by the suspect
   provider against finalized chain state.
6. Restart WebSocket subscriptions from durable checkpoints.
7. Measure indexer gaps and replay them idempotently.
8. Re-enable the provider only after health and integrity validation; rotate its
   credential if compromise is suspected.
9. Record user-visible pending states and avoid duplicate transaction prompts.

## Runbook: indexer divergence, poisoning, or full replay

Trigger: signature/hash failures, impossible invariants, checkpoint disagreement,
reorg handling defect, corrupted database, or a scheduled rebuild drill.

1. Stop projection writers and expose the projection as stale or unavailable.
2. Record release, schema, program ID, deployment slot, the network's immutable
   `INDEXER_PROFILE_V2_ACTIVATION_SLOT`, last observed/finalized slot,
   checkpoint, dead letters, and provider observations.
3. Preserve the suspect database and logs read-only for analysis; do not mutate
   them to manufacture agreement.
4. Identify and quarantine malformed or unverifiable inputs with reason codes.
5. Provision a fresh isolated database and apply checksummed migrations.
6. Replay from the configured program deployment slot using finalized block
   identity and idempotent event keys.
7. Fetch manifests from alternate providers and verify canonical bytes,
   signatures, delegations, hashes, versions, and tombstone precedence.
   Content references must use exact CIDv1/base32-lowercase `raw`/SHA-256 CIDs
   in the supported IPFS, local, Arweave-transaction/CID, or credential-free
   HTTPS/CID URI grammar; malformed references are terminal before provider
   I/O. Apply the recorded profile-v2 cutoff exactly: only a historical
   legacy-prefix event before it may omit the schema commitment; current
   root/delegated events and every event at or after it must commit v2 onchain
   and reference a v2 envelope.
8. Preserve each raw event's accepted, pending, or terminal disposition.
   Pending and terminal rows are replayed without provider I/O. Among accepted
   rows, provider I/O may be skipped only when the complete ordered ledger
   proves that an accepted post was later tombstoned or an accepted profile
   pointer was later superseded. Preserve that obsolete event's accepted raw
   state, sequence/reference effects, and checkpoint without rematerializing
   its content. Every other accepted manifest is re-fetched and reverified; a
   terminal result is disposition drift and blocks the rebuild. Tombstone
   object/CID/hash fields are detached audit metadata and are never fetched or
   allowed to gate suppression. Track throughput, due hydration age, retries,
   dead letters, and provider divergence.
9. Compare deterministic invariants, representative API results, counts, and
   state hashes between independent rebuilds where practical.
10. Run the new projection in shadow mode before shifting reads.
11. Resume consumers from the verified checkpoint and monitor lag.
12. Retain or dispose of the suspect projection according to incident and
   retention policy.

A database backup may shorten recovery, but it is not proof of correctness. Full
replay remains a required capability.

Current evidence is narrower than this runbook but no longer synthetic-only:
the local Solana connected gate clears its network projection and
deterministically reconstructs identity, profile, post, follow, tombstone,
checkpoint, and suppression state from actual finalized local-validator
history plus signed CAS manifests. The synchronizer handles finalized polling,
checkpoints, retry/DLQ, RPC failover, and the same immutable profile-schema gate
for live ingestion and rebuild. This is not devnet/mainnet-beta,
production-scale, or independent-provider evidence.

## Runbook: content gateway or storage-provider failure

1. Classify publish failure, retrieval outage, integrity mismatch, replication
   loss, or credential compromise.
2. Remove a provider returning hash-mismatched bytes from automatic selection and
   open a security incident.
3. Retrieve from alternate configured providers and verify bytes locally.
4. For pending publications, retry idempotently without changing manifest bytes
   or claiming success before verification.
5. Replicate eligible content according to the user-selected storage policy.
6. Do not republish deletion-compatible content to permanent storage as a
   failover shortcut.
7. Update health and user-facing replication state.
8. Rotate provider credentials and audit publication/deletion activity if
   compromise is possible.

For already anchored profile/post references, temporary retrieval failure is a
durable pending state rather than a global checkpoint barrier. The raw event,
identity sequence, and checkpoint advance atomically while unverified profile
content is suppressed and an unverified post remains feed-invisible. A bounded
due queue is drained after every synchronization poll, even when no new
signature was found and the chain checkpoint was already current. It retries
at most the configured batch size in deterministic order. Success promotes the
exact raw fingerprint without a second sequence advance, continued
unavailability is rescheduled with bounded backoff, and deterministic
verification failure moves it to terminal quarantine. Operators must not
rewrite raw disposition or delete the linked dead letter with runtime
credentials.

A pending profile that hydrates after the same identity was deactivated is
retained only as historical, replay-verifiable profile state. It must not
reactivate the identity or return that person to public search/discovery.
Likewise, a finalized onchain tombstone suppresses its target immediately:
optional legacy tombstone bytes are non-gating audit metadata, so their
provider outage is not an incident-level checkpoint blocker.

The current Kubo integration proves publish, CID verification, gateway
retrieval, health, and unpin against the local container. Multi-gateway failure
injection and production-provider evacuation have not been exercised.

## Runbook: relay outage or envelope backlog

1. Stop accepting work if durable or bounded queue guarantees cannot be met.
2. Direct clients to alternate relays and exponential reconnect behavior.
3. Preserve envelope confidentiality; never log ciphertext with identifying
   routing metadata unnecessarily.
4. Reconcile durable signed state after reconnect; typing/presence may be dropped.
5. Drain queues with recipient/action rate limits and deduplication.
6. Verify device revocations and group membership before delayed delivery.
7. Publish impact accurately: relay delivery is not canonical post or payment
   confirmation.

## Runbook: PostgreSQL failure or corruption

1. Stop writers if continued operation risks inconsistent projections.
2. Record schema, last checkpoint, replica/backup state, errors, and affected
   services.
3. Fail over only to a replica whose recovery point and integrity are known.
4. Reconcile jobs and checkpoints after promotion.
5. If corruption is suspected, restore into isolation or build a fresh projection
   rather than overwriting evidence.
6. Validate migrations, constraints, row-count/state invariants, permissions, and
   application queries.
7. Resume reads, then bounded writers, while monitoring errors and lag.
8. Full indexer replay verifies that canonical public state can be reconstructed.

## Runbook: Redis loss or queue saturation

1. Determine which functions are cache, rate limit, queue, or coordination.
2. Ensure sensitive actions do not fail open. Temporarily disable sponsorship,
   recovery, or expensive mutations if limits cannot be enforced.
3. Recreate disposable caches and use bounded warm-up.
4. Reconcile queued jobs from their durable source or idempotent database record;
   do not assume lost Redis data was completed.
5. Apply backpressure and shed noncritical work before raising resource caps.
6. Check duplicate processing, dead letters, and downstream provider spend.

## Runbook: compromised user/device credential

1. Offer immediate device/delegation revocation without requiring the compromised
   device.
2. Show affected scopes and recent signed actions without exposing private
   message content.
3. Rotate session and messaging device keys; update conversation safety-number
   state as required by the selected protocol.
4. Start delayed recovery only if root authority is unavailable.
5. Reconcile questionable protocol actions; signed public history cannot be
   silently rewritten.
6. Preserve user-selected evidence and provide clear guidance against additional
   wallet prompts.

Support staff MUST not request seed phrases, private keys, passkey exports, or
screen sharing of secret material.

## Runbook: operator, sponsor, or program-authority compromise

1. Declare SEV-0 or SEV-1 based on scope and move to out-of-band coordination.
2. Stop deployments and sponsorship. Disable affected service credentials and
   isolate control-plane access.
3. Independently inspect the affected Solana genesis, DroolNet program ID,
   program-data address, deployed binary hash, deployment slot, upgrade
   authority, sponsor balance, and recent transactions across trusted providers.
4. Notify multisig signers through verified channels; do not collect root secrets
   centrally.
5. Use the preapproved authority-rotation or narrowly scoped pause procedure only
   if its preconditions hold.
6. Rebuild service infrastructure from reviewed immutable artifacts with fresh,
   scoped credentials.
7. Reconcile sponsor transactions and budgets and notify affected users when
   required.
8. Publish material program changes and incident facts.

There is no safe generic rollback for a stateful DroolNet program. Any program
action requires independent review of deployed binary and state compatibility.
Disposable local-validator behavior cannot approve a devnet or mainnet-beta
action.

## Runbook: sponsor abuse or unexpected fund movement

1. Disable sponsorship without disabling ordinary user-funded protocol access.
2. Preserve the transaction-policy version, simulations, signed messages,
   idempotency records, budget counters, and finalized outcomes.
3. Check recipient, programs, instructions, SOL network-fee amount, optional
   exact SPL token identifiers, fees, blockhashes, and subject limits against
   the allowlist. Treat any legacy payment instruction, unpause attempt, or
   SOL-as-`$DROOL` labeling as a security incident.
4. Reconcile pending transactions and prevent automatic duplicate retries.
5. Rotate the isolated sponsor key if compromise is possible; never use a
   production upgrade or treasury authority.
6. Resume with reduced ceilings only after the bypass is understood and tested.

Sponsors pay only the Solana transaction network fee unless a separately
approved future mint-aware product path exists. They never make the legacy
payment ABI executable.

## Runbook: Seeker Android, MWA, signing, or distribution compromise

Trigger: tampered/fake APK, unexpected signing certificate, signing/store
account compromise, malicious update, MWA intent/callback substitution,
unexpected wallet account/network/transaction, or sensitive mobile-data leak.

1. Stop Android release promotion and distribution; do not publish an unsigned
   or differently signed emergency replacement.
2. Record APK hash, signing-certificate digest, source/build provenance, package
   ID, version, distribution channel, wallet package, selected account,
   configured Solana deployment, and non-sensitive callback evidence.
3. Disable affected deep links, remote configuration, sponsorship, or mutation
   features where the predesigned control is safe; retain verified read-only
   status where possible.
4. Warn users against additional wallet prompts and identify exact affected
   versions/certificates without requesting seed phrases or private keys.
5. Revoke compromised store/release credentials and invoke the separated
   signing-key/update response with the required quorum.
6. Rebuild from reviewed source and dependencies, reproduce the artifact,
   verify the signing identity, and rerun device/MWA substitution, lifecycle,
   permissions, privacy, accessibility, and rollback tests.
7. Publish only through an approved update path and preserve incident evidence
   for security, privacy, legal, and store coordination.

## Runbook: moderation or acute safety incident

1. Prioritize immediate user controls: block, mute, reply/mention/DM limits,
   safety mode, and operated-client distribution limits.
2. Restrict evidence access to trained, authorized responders and record every
   access.
3. Preserve only reporter-selected or legally required material; never introduce
   a hidden message-decryption path.
4. Use the legally reviewed escalation path for imminent threats, child-safety
   material, nonconsensual intimate media, or valid legal process.
5. Separate emergency operated-service action from permanent global protocol
   claims.
6. Give affected users status and appeal information when safe and lawful.
7. Review moderator conflicts, automation decisions, blocklist provenance, and
   coordinated abuse signals.

This runbook requires qualified safety and legal review before production.

## Predeployment membership-v2 ABI reset

Migration `0018_member_signed_community_memberships.sql` is a deliberate reset
boundary. Community, community-membership, and governance-proposal
account/event layouts changed under the fixed development-localnet program ID.
Old `community-created`, `community-membership-changed`, and
`proposal-created` raw bodies cannot be decoded or deterministically replayed
as the current ABI. The migration refuses any existing row on those projection
surfaces or event types instead of creating a silently unreplayable ledger.

For disposable local development only:

1. Stop the indexer, web/services that can write, and every local validator.
2. Resolve and verify the exact `wetdrool-local` Compose project and its
   disposable volumes using the commands in the next section.
3. Remove that exact project's disposable volumes.
4. Start a local validator with a new empty ledger directory and redeploy the
   current reviewed SBF artifact. Do not reuse or rescan the previous validator
   ledger.
5. Start the fresh PostgreSQL projection, apply all 18 migrations, and run the
   program, integration, and connected replay gates before further work.

If either the PostgreSQL data or validator history is not disposable, stop.
There is no in-place compatibility path in this predeployment repository.
Preserve the state read-only and design a new program/version plus explicit
dual-read or export/import plan. No devnet or mainnet-beta DroolNet deployment
currently exists.

## Legacy public-schema volume upgrade or reset

The local provisioner refuses to create the parallel `wetdrool_auth`,
`wetdrool_indexer`, and `wetdrool_moderation` schemas when it finds tables,
partitioned tables, sequences, views, materialized views, foreign tables,
routines, domains, or enums in `public`. This is intentional. A pre-isolation
volume may contain live application state, and silently creating empty service
schemas beside it would make the runtimes appear healthy against the wrong
data. Do not bypass or weaken this preflight.

First stop every writer and identify the exact Compose project and PostgreSQL
volume. Do not infer a volume name from a shell variable:

```sh
docker compose --env-file .env.example --file infra/compose.yaml \
  --project-name wetdrool-local down
docker volume ls --filter label=com.docker.compose.project=wetdrool-local
docker volume inspect wetdrool-local_postgres-data
```

If the volume is disposable local data, reset it explicitly. The following
command permanently deletes that project's PostgreSQL, Redis, Kubo, indexer
content, media, and scanner volumes; verify the project name and accepted data
loss before running it:

```sh
docker compose --env-file .env.example --file infra/compose.yaml \
  --project-name wetdrool-local down --volumes --remove-orphans
pnpm infra:up
```

If any data must be preserved, use this reviewed upgrade procedure:

1. Keep writers stopped. Take a restorable custom-format PostgreSQL backup and
   record its SHA-256, PostgreSQL version, source volume identity, row counts,
   and the exact repository commit. Restore it into a separate disposable
   database and perform the upgrade there first.
2. Inventory every `public` relation, sequence, view, routine, domain, enum,
   extension, owner, grant, and cross-object dependency. Assign every object to
   exactly one of the auth, indexer, or moderation schemas. An unassigned or
   multiply assigned object blocks the upgrade.
3. Establish a checksum baseline before moving anything. For each row in
   `auth_schema_migrations`, `schema_migrations`, and
   `moderation_schema_migrations`, map its version to the same packaged SQL file
   and independently compute that file's lowercase SHA-256. Each ledger must be
   an exact ordered prefix of its packaged migration directory. A missing file,
   gap, duplicate, unknown version, changed SQL file, or unexplained database
   object blocks the upgrade.
4. Legacy ledger rows without checksums are not backfilled automatically.
   Record the independently verified version-to-SHA-256 mapping in the change
   ticket and backup evidence, then use a reviewed, one-time transaction to add
   and populate the checksum column. Never copy hashes from an unverified
   working tree or infer that a matching filename proves matching SQL.
5. Write an explicit transactional rehome script for the inventoried objects.
   Move tables, owned sequences, views, routines, domains, and enums to their
   assigned schemas; update schema-qualified dependencies; transfer ownership
   to the matching migration role; set service search paths; and apply the
   least-privilege grants from
   `infra/postgres/provision-service-roles.sql`. Provision `pg_trgm` and
   `btree_gin` in `wetdrool_indexer`. Do not use a blanket `public.*` move.
6. Run all three migration commands against their scoped migration roles, then
   run the `privilege-probe` profile. Verify that each runtime can perform
   required DML only in its own schema, cannot perform DDL or read another
   service schema, and cannot insert, update, or delete any migration ledger.
7. Compare the isolated result with the baseline: migration checksums, row
   counts, constraints, indexes, sequence ownership, sample service reads and
   writes, replay invariants, and backup restore must all pass. Rehearse
   rollback by restoring the original backup.
8. Schedule a write outage, take a final backup, repeat the reviewed script,
   rerun every check, and retain the before/after evidence. If any step differs
   from rehearsal, stop and restore rather than partially activating runtimes.

The repository deliberately provides no automatic public-schema mover and no
automatic checksum backfill. Production or irreplaceable data requires a
database engineer's reviewed, deployment-specific mapping and rollback plan.

## Backup policy

All policies are **Planned**; proposed RPO/RTO values require restore evidence.

### What to retain

- PostgreSQL backups and point-in-time logs for noncanonical operator data and
  faster projection recovery.
- Versioned configuration with secrets removed.
- Secret-manager metadata and separately controlled recovery material.
- Program source, IDL, reproducible build inputs/output hashes, deployment
  records, program IDs, and authority history.
- Container digests, SBOMs, provenance, migration artifacts, and release records.
- Indexer deployment slot, checkpoints, dead-letter reason metadata, and replay
  configuration.
- Storage-provider replication/deletion state and signed manifests according to
  user policy.
- Security and administrative audit events under an approved retention policy.

Private keys and seed phrases are not placed in ordinary database backups.
Multisig signers retain independently secured recovery material according to the
key-ceremony policy.

### Backup controls

- Encrypt in transit and at rest with keys separated from storage credentials.
- Use immutable or write-protected copies for critical release and audit records.
- Separate environment and tenant scopes.
- Restrict and audit restore capability.
- Monitor age, completion, size anomalies, and retention deletion.
- Maintain at least one copy outside the primary compute/provider failure domain.

### Restore drill

At least quarterly before a production commitment, and before destructive schema
changes:

1. Select a recovery point without relying on the primary operator console.
2. Restore into an isolated account/network with new credentials.
3. Verify backup authenticity, encryption, schema, and migration checksums.
4. Run database constraints and application invariants.
5. Replay canonical events from the restored checkpoint to finalized head.
6. Verify tombstones, privacy deletions, authorization, sample APIs, and
   alternate-provider retrieval.
7. Measure achieved RPO, RTO, data loss, operator steps, and cost.
8. Destroy the drill environment and credentials under an audited process.
9. Record evidence and remediate missed objectives.

## Disaster recovery and provider exit

A disaster may remove the primary hosting account, region, registry, database,
RPC, storage provider, DNS access, or operator identities.

The recovery design MUST support:

- Source and release artifacts retained outside the primary provider.
- Recreating compute from provider-neutral OCI images and documented
  configuration.
- Restoring necessary operator data or rebuilding the public projection.
- Activating alternate RPCs, gateways, storage, relays, and telemetry.
- Moving public endpoints through controlled DNS changes.
- Verifying artifact signatures, protocol data, and program authority before
  accepting traffic.
- Communicating alternate indexer/relay/gateway endpoints to clients and third
  parties.

An annual full-provider-loss exercise is required before claiming mature
production operations.

## Change and release operations

- Every change has an owner, risk, test evidence, configuration diff, deployment
  plan, rollback/roll-forward plan, and observation window.
- Emergency changes preserve peer review when possible and require retrospective
  review within a defined period.
- Feature flags are versioned, audited, owner-assigned, and removed after use.
- Database compatibility uses expand/migrate/contract rather than same-release
  destructive changes.
- Program changes follow the separate production-network authority and
  verifiable-build process; general release automation cannot cross that
  boundary.
- Releases stop when security findings, restore failures, error budgets, or
  unexplained integrity mismatches breach policy.

## Routine schedules

Planned minimum cadence:

| Cadence | Activity |
| --- | --- |
| Continuous | Health, integrity, authority, certificate, backup, queue, indexer-lag, and provider monitoring |
| Weekly | Vulnerability triage, dead-letter review, access anomalies, capacity and spend review |
| Monthly | Dependency and base-image refresh, access review, recovery/authority state verification, provider failover sample |
| Quarterly | Backup restore, indexer full-replay sample, incident tabletop, secret rotation sample, privacy retention audit |
| Per release | Threat-model delta, clean build/test/security evidence, artifact verification, migration and rollback review |
| Annually | Full disaster/provider-exit exercise, key ceremony review, independent audit planning, policy/legal review |

## Operational readiness gate

Production operations are not ready until evidence exists for:

- Named owners, on-call coverage, escalation, and out-of-band coordination.
- Actionable dashboards and tested pages for each critical component.
- Redacted logs and privacy-approved telemetry retention.
- Capacity/load tests and approved SLO/error-budget policy.
- Database restore and full indexer replay within measured objectives.
- RPC, gateway, storage, relay, registry, and compute failover exercises.
- User/device key, operator credential, sponsor key, and program-authority
  compromise tabletops.
- Moderation/safety escalation reviewed by qualified specialists.
- Release, rollback, migration, Solana devnet/mainnet-beta program-deployment,
  and authority-ceremony rehearsals.
- A verifiable public DroolNet deployment, independent Solana RPC
  provider/failover result, and connected-slice result; local-validator results
  are recorded separately and do not satisfy this gate.
- A verified Seeker-device/MWA matrix, reproducible signed APK, signing
  provenance, secure update/rollback drill, and approved distribution path.
- Public status and incident-communication procedures.
- Known limitations and remaining risks recorded in the release report.

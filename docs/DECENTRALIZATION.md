# Decentralization Assessment

## Current assessment

- **Assessment date:** 2026-07-28
- **Implementation:** Experimental local subsets; replaceability is not
  end-to-end verified
- **Deployments:** No native WokeNet deployment; ephemeral Agave
  compatibility oracle and local containers only
- **Classification:** **Design intends decentralization; the project does not
  currently qualify as decentralized**

An experimental program, public/read-only client subset, schema/SDK/storage
packages, indexer projection/API, endpoint configuration, and local
infrastructure now exist. They pass separate unit, Agave local-validator,
container, and browser suites. The Agave validator and Solana tooling are an
explicit compatibility oracle for the fork's Solana-format wire and program
behavior, not a native WokeNet operator or deployment. “Replaceable”
remains a design target until native Firedancer/RPC operation, a native
connected vertical slice, conformance tests, and migration exercises prove it.

WokeNet is the sovereign runtime and is forked from Solana. Native
validator and RPC implementations are Firedancer only; that path is
**Experimental** and production activation is blocked. The native asset is WOKE
with 9 decimals. `lamports` may remain as the Solana-compatible wire/base-unit
name (`1 WOKE = 1,000,000,000 lamports`) but never denotes SOL. The canonical
public origin is `https://woke.social`; `sociallywoke.com` is redirect-only.

## Component matrix

| Component | Canonical or convenience layer | Current operator | Can users replace it? | Can third parties run it? | Failure behavior | Censorship risk | Privacy risk | Migration procedure | Planned improvement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WokeNet ledger | Canonical for finalized program facts | None configured; native Firedancer/RPC is Experimental | Network is selected per identity namespace; not transparently swappable for one identity | Native Firedancer operator path is unverified; Agave is compatibility-oracle-only | Writes stop; cached/public offchain reading continues | Validator/RPC inclusion pressure | Public timing and relationship metadata | New protocol/network namespace and explicit signed migration | Prove independent native Firedancer operation; document cross-network migration; minimize onchain data |
| Social protocol program | Canonical only for documented identity, authorization, reference, governance, tombstone, and settlement facts | Ephemeral Agave compatibility oracle; no WokeNet operator | Not within one namespace; compatible clients may support other program IDs | Source and Solana-compatible SBF build exist; native Firedancer and verifiable release results remain open | New writes stop; signed content remains verifiable; projections remain readable | Upgrade/freeze authority could block or change writes | Public accounts/events expose graph metadata | Export state; deploy reviewed version; user-authorized migration links | Complete protocol, native Firedancer verification, multisig, timelock, verifiable builds, eventual immutable stable release |
| Program upgrade/config authority | Governance control, not user-content authority | None | Planned transparent authority profile | Multisig/governance tooling may be independently operated | Unsafe upgrade is blocked if quorum unavailable | Concentrated authority can alter protocol | Signer identities/operations may be observable | Rotate through governed onchain procedure | Publish signers, thresholds, delay, emergency scope, and immutability path |
| Identity root and delegations | Canonical authorization state | Ephemeral Agave compatibility oracle for the implemented subset | Wallets/device implementations replaceable; identity PDA persists | A compatible client can target the repository program source; no native WokeNet release or conformance result | Revoked/expired devices cannot write; alternate authorized device may recover | Client can hide identity but cannot rewrite finalized authority | Public delegation graph can fingerprint devices if overdescribed | Rotate root, revoke device, link migration under delay | Integrate implemented delegation, root rotation, and delayed guardian recovery into independent clients and test on native Firedancer |
| Signed public manifests | Canonical portable content assertion | Test publishers only | Provider-neutral publication pipeline exists; conforming third-party implementation remains untested | Repository source exists; no release | Existing bytes verify even if an app disappears | A provider can withhold bytes, not forge them | Public content and revision history are visible | Export canonical envelopes/CIDs and republish | Shared cross-language schemas/vectors and independent publisher |
| Local/IPFS content storage | Availability layer; bytes verified by CID/signature | Local CAS and Kubo test operator | Local/memory/IPFS adapters and multi-provider interface exist | Runnable from repository source; package not released | Gateway/provider failover; content may be unavailable if unreplicated | Unpinning/gateway filtering | Fetches leak interests and IP metadata | Repin/export verified bytes; update location hints | Persistent replication status, privacy-aware gateways, health proofs |
| Arweave-compatible storage | Optional permanence layer | None | Optional and never default | Yes where network/tooling permits | Permanent bytes remain; publishing may stop | Gateway filtering cannot reliably erase network data | Permanent disclosure is irreversible | Keep CID/hash and choose another gateway; deletion cannot be guaranteed | Explicit consent receipt and prominent permanence warning |
| WokeNet RPC providers | Convenience access to ledger | No native provider; configurable Agave compatibility-oracle endpoint only | Provider settings exist; health-based native failover is planned | Native Firedancer/RPC operation is unverified | Fail over, degrade to cached reading, stop unsafe writes; never substitute the oracle in production | RPC can omit/delay data or transactions | RPC sees addresses, requests, timing, and IP | Change provider profile; verify genesis/runtime/program/checkpoints | Bring up native Firedancer RPC, cross-check sensitive reads, and test native failover |
| Open indexer | Rebuildable projection | Local test process | Web endpoint selection exists | Read-only API/projection and finalized synchronizer are runnable against the Agave compatibility oracle; native WokeNet synchronization is unverified | Fail over or show stale checkpoint; canonical data remains | Operator can omit query results | Queries reveal interests; private data must be excluded | Switch endpoint or rebuild from deployment slot and public manifests | Native Firedancer RPC sync, provenance API, conformance fixtures |
| PostgreSQL projection | Disposable operator storage | Local container | Replaced with indexer instance, not user-trusted as authority | Yes with current projection source | Queries/search fail; synthetic-event rebuild is tested | Operator can alter projection | Centralized query logs and any scoped operator records | Clear network projection and deterministically replay supplied events | Rebuild from actual chain history; separate private schemas and retention controls |
| Redis/queues | Ephemeral cache, rate limits, coordination | Local container; not used as protocol state | Operator implementation detail | Yes | Cache miss, delayed jobs, or reduced rate limiting; no truth loss | Queue operator can delay convenience work | Temporary identifiers may leak behavior | Flush and recreate | Wire only disposable functions, strict TTLs, and no durable authority |
| Real-time relay | Convenience transport and hints | Local tested signed WebSocket service | Multi-relay client accepts injected URLs and performs failover | Signed protocol, server, and client source are runnable; no independent operator result | Reconnect/fail over; reconcile public state; queue safe encrypted sends | Can delay/drop envelopes and presence | Sees connection/message timing and routing metadata | Add relay, rotate mailbox token, replay/reconcile | End-user selection UX, metadata minimization, short retention, capability documents, and independent conformance |
| E2EE messaging sessions | Conversation participants and current WokeSocial device authorization govern plaintext/session use | Experimental pairwise devices in 13 real-WASM cases | Relay/directory are injected replaceable interfaces; production encrypted state export is open | Pairwise adapter source and tests are runnable; no browser release/conformance result | Relay/directory loss delays new sessions/delivery; signed outer metadata prevents a relay from poisoning Olm state with a modified honest envelope | Operators can deny, delay, or reorder delivery/key lookup but cannot authorize devices or forge authenticated plaintext | Routing/timing/size and pseudonymous engine public keys remain visible; endpoint compromise reveals local plaintext/state | Change directory/relay independently; production state export and migration remain required | Persistent encrypted browser store, durable replay, browser packaging, relay interop/failover, attachments/safety UX, independent review; group APIs stay absent |
| Feed provider | Convenience recommendation ordering | Local tested seven-mode provider | Typed endpoint selection exists; deterministic chronology/following fallback is implemented | Public HTTP/OpenAPI provider source is runnable; no independent operator result | Fall back to another feed or deterministic chronology | Can down-rank/omit content | Behavioral profiles can expose sensitive interests | Select provider; reset/delete personalization | End-user selection UX, production candidate integration, versioned algorithms, and independent conformance |
| Moderation-label provider | Signed assertion layer, not content authority | Local tested label/report/appeal provider | Provider contracts are replaceable; per-user/community subscription UX remains planned | Signed provider, OpenAPI, and durable local implementation are runnable; no independent operator result | Provider labels become unavailable; personal controls and lawful client policy remain | Provider can overlabel or omit labels | Labels/evidence can expose sensitive traits | Subscribe/unsubscribe; export community policy and appeals receipts | End-user provider selection, signed-feed subscription, versioned taxonomy, transparency exports, and conflict controls |
| Community policy/governance | Canonical commitments plus signed portable policy | None | Community can select moderation/feed/indexer providers | Planned compatible clients/operators | Community reads continue; governance writes depend on program/RPC | Admin or governance capture | Private membership or reports must stay offchain | Export rules/roles; migrate with member-approved signed/onchain link | Anti-sybil options, emergency review, independent policy hosting |
| Media processor | Convenience transformation service; unsigned output never becomes identity authority | Local hardened worker plus private ClamAV profile | Yes; clients may resubmit by source hash or publish validated preprocessed media | Source, OpenAPI, OCI build, processing profiles, and preprocessed path are runnable | Upload remains resumable/retryable; use another worker or self-process if unavailable | Worker can refuse, delay, or omit derivatives but cannot sign for users | Raw uploads, timing, source size/type, and accessibility declarations are visible to the chosen worker | Preserve source hash and declaration; cancel/resume or submit to another worker; client signs final manifest | Browser integration, production multi-provider replication, stronger codec sandboxing, load evidence, and independent review |
| Search service | Derived index inside the open indexer | Local tested memory/PostgreSQL projection and typed web client | Change `WOKESOCIAL_INDEXER_URL`; explicit-network API is independently runnable | Source, OpenAPI, migration, deterministic `public-match-v1` policy, and tombstone tests are runnable; no independent operator result | Search shows an explicit degraded state; direct object/profile lookup and canonical data remain | Can omit or reorder results, though the response declares its ranking version/checkpoint | Search logs reveal interests; private fields are excluded by contract | Rebuild from public protocol data or select another compatible indexer | Viewer-aware safety filtering, events/creator discovery, scale/load evidence, query-log retention controls, and independent conformance |
| Sponsored transaction service | Optional WOKE fee payer | None | Planned sponsor list; self-funded WOKE path remains | Planned documented API | Browsing works; write waits, changes sponsor, or user pays WOKE | Sponsor can deny transactions | Sponsor sees identity, timing, and abuse signals | Select sponsor or self-fund the same WokeNet transaction | Blind/minimized tokens where feasible; strict published limits |
| Passkey/recovery assistance | Replaceable convenience around identity authority; onchain policy remains canonical | Local replaceable WebAuthn service | Service URL is runtime-configurable; ciphertext bundles are portable records, while complete export UX is open | Service source, OpenAPI, PostgreSQL migrations, and container are runnable; no release/conformance result | Existing protocol keys remain authoritative; service loss blocks its sessions/bundle sync but cannot sign | Operator can deny authentication or delete ciphertext, not forge protocol signatures | Credential metadata, account timing, and network metadata are visible; PRF output/plaintext keys are not | Export encrypted wrappers, register another credential/service, then authorize/revoke protocol keys separately | Integrate the implemented guardian primitive into recovery UX; complete export/multi-device/email assistance, drills, and independent review |
| Flagship web client | Reference convenience client | Local development only | Provider settings exist; full migration/export does not | Source is public but no release/self-host conformance result exists | Other clients/direct tools remain possible | Client may hide reachable content | Client sees browsing/session data | Export settings/keys safely; configure or move to another client | Complete endpoint controls, local verification, export, and static mirror |
| Protocol schemas, SDK, and docs | Public interpretation layer; schemas define portable formats | Experimental repository source; no release | Any client can implement the documented subset | Repository source exists; no independent build result | Development slows but published versions remain usable | Maintainer could bias future versions, not rewrite signed history | Minimal; SDK telemetry forbidden by default | Pin released schemas; fork implementation; negotiate versions | Distributable schemas, generated references, signed releases, shared golden vectors |
| DNS and `woke.social` (`sociallywoke.com` redirect only) | Discovery convenience only | Domain owner; no service configured | Alternate client/provider URLs planned | Yes | Bookmarks, alternate discovery, and content IDs still work | Domain seizure can redirect users | DNS/hosting sees access metadata | Use independently published provider profiles and mirrors; never make the legacy redirect host a separate identity namespace | DNSSEC where supported, signed discovery document, decentralized mirror |
| Telemetry/error tracking | Optional operator convenience | None | Must be opt-in/configurable | Yes | Product remains functional without telemetry | Operator can suppress evidence of outages | High if events contain identity/content | Disable or select operator; delete per retention policy | Consent, redaction, aggregation, no private-content capture |

## Authority flow

```mermaid
flowchart TD
    Ledger["Finalized WokeNet state/events"]
    Signed["Signed portable objects"]
    Verify["Client/SDK verification"]
    Projection["Replaceable indexer projection"]
    Convenience["Relay, feed, moderation, search, media"]
    Person["Person's client and policy choices"]

    Ledger --> Verify
    Signed --> Verify
    Ledger --> Projection
    Signed --> Projection
    Projection --> Convenience
    Convenience --> Person
    Verify --> Person
    Person -. "selects/replaces" .-> Convenience
```

Only native Firedancer-verified WokeNet ledger facts and valid signed
objects may establish public protocol claims. Agave/Solana tooling may establish
compatibility-oracle results only. Convenience services can select, order,
label, transport, or transform data, but cannot silently create protocol truth.

## Required portability bundle

A user or community export is planned to contain:

- network/genesis hash, program ID, deployment slot, and schema versions;
- identity URI and relevant account/event proofs;
- active and revoked public-key/delegation records;
- canonical signed profile, content, policy, and tombstone envelopes;
- CIDs, provider receipts, and replication status;
- public social/community edges or replay cursors;
- encrypted private preferences and message/session export only where the
  selected cryptographic protocol can do so safely;
- selected provider profiles and feed/moderation settings;
- a manifest of every exported file with byte length and digest.

The bundle must be consumable without contacting a WokeSocial-operated API or
the `woke.social` origin. Secrets require separate encryption and an explicit
user-held recovery key.

## Migration exercises

These tests are required before any “decentralized” production claim:

1. **Client loss:** Disable the flagship client and recover identity/profile in
   an independently built client.
2. **Indexer loss:** Destroy PostgreSQL, rebuild from the deployment slot and
   public manifests, and compare deterministic projections.
3. **Provider failover:** Remove the preferred RPC, gateway, indexer, relay,
   feed, and moderation endpoint one at a time; verify documented degraded mode.
4. **Storage migration:** Export verified bytes from one provider, republish to
   another, and retrieve them by the original integrity identifier.
5. **Relay migration:** Move an encrypted conversation to another relay without
   changing the conversation's cryptographic authority.
6. **Community migration:** Export rules, roles, governance configuration, and
   provider selections; load them in another compatible client/indexer.
7. **Authority recovery:** Revoke a compromised device and recover through the
   configured delay/cancel process without vendor-only secrets.
8. **Program migration:** Reproduce the program build, verify deployed code and
   authority, then test an explicit user-approved migration path.

Each exercise needs automated assertions where possible and a dated,
reproducible report.

## Qualification gates

| Requirement | Status | Evidence needed |
| --- | --- | --- |
| Identity survives loss of flagship client | Not met | Independent-client recovery test |
| Social graph rebuilds without flagship database | Partially evidenced | Compatibility-event PostgreSQL replay passes; actual native-chain replay and independent comparison remain |
| Public content verifies independently | Partially evidenced | Canonical signature/hash/CID verification passes locally; shared cross-language vectors and an independent client remain |
| Third party can operate an indexer | Not met | Public source, runbook, conformance result |
| Third party can build a compatible client | Not met | Released schemas, SDK/IDL, sample client test |
| Users can select alternate RPC/gateway/indexer/relay | Partially evidenced | Endpoint controls and storage/relay failover subsets pass; native RPC/indexer and full client E2E failover remain |
| Community policy and moderation are portable | Not met | Export/import and alternate-provider test |
| Company cannot rewrite signed content | Partially evidenced | TypeScript canonical signature verification passes; authorization-history and independent-client checks remain |
| No proprietary interpretation API is required | Not met | Complete public specifications and generated refs |
| Production upgrade authority is transparent | Not met | Deployed program, verifiable build, published multisig |
| Native WokeNet operation is independently reproducible | Not met | Native Firedancer validator/RPC build, connected-slice report, and second-operator result |
| Migration away from company infrastructure is tested | Not met | Full migration exercise report |

## Centralization risks that remain even after implementation

- Native Firedancer implementation maturity and the absence of a verified
  independent WokeNet validator/RPC ecosystem are current concentration
  risks.
- WOKE fees and WokeNet validator governance will remain protocol
  dependencies even after multiple operators exist.
- Popular gateways, RPC providers, clients, and moderation providers may become
  de facto central points through network effects.
- DNS, app-store distribution, payment rails, and legal obligations can constrain
  the flagship operator.
- Content availability depends on someone retaining bytes; content addressing
  provides integrity, not persistence.
- Strong privacy is difficult when public social relationships and timing are
  recorded onchain.
- Key recovery adds trusted people or services and creates an abuse target.
- Moderation portability can fragment policy while shared providers can
  concentrate power.

These are tradeoffs to measure and disclose, not reasons to call convenience
services canonical.

## Next verification milestone

The Agave compatibility-oracle slice already proves identity, profile, signed
post, local content-addressed storage, Solana-format onchain reference, open
indexer, following feed, tombstone suppression, and a clean projection rebuild.
The next decisive evidence is the same connected flow on a native Firedancer
validator and native WokeNet RPC, followed by a second independent
operator. Until those native tests pass with published fixtures, the sovereign
runtime and end-to-end replaceability claims remain architectural intent and
production activation remains blocked.

# WetDrool Moderation and Safety Model

**Status:** Active specification with an implemented provider subset  
**Last updated:** 2026-07-29

## 1. Implementation status

This document specifies the complete required moderation behavior. The complete
moderation and safety system remains **Planned**, but the repository now has a
verified provider subset in `apps/moderation-service`:

- strict signed `moderation-label`, `report`, and `appeal` object verification;
- fail-closed current key/provider authorization, with an unmistakable
  loopback-only unverified mode;
- idempotent append-only intake and active-label projection;
- expiry and same-provider/same-subject supersession rules;
- restricted report receipts that do not echo evidence or signed bodies;
- purpose-bound authorization for case reads, log redaction, body/rate limits,
  security headers, OpenAPI, and 17 passing service/API tests.

The default store is volatile memory and therefore development-only. Durable
encrypted evidence storage, operator workflow and access auditing, personal and
community product controls, specialist escalation, transparency exports, and
independent policy-provider selection remain incomplete. Signed tombstones and
the indexer’s deletion suppression are separately tested protocol controls.

DroolNet is the WetDrool protocol and smart-contract deployment layer on
Solana. Onchain moderation references use the exact selected Solana
genesis/program binding. Local-validator tests are local evidence only; no
devnet or mainnet-beta deployment is recorded. No `$DROOL` mint exists, and the
legacy payment ABI is quarantined and irrelevant to moderation authority. The
canonical public origin is `https://wetdrool.com`; `droolhouse.com` is
redirect-only and must not host a separate moderation policy, report intake,
appeal flow, or identity namespace.

Moderation and safety requirements apply equally to responsive web and the
native Android product. The current Seeker/Mobile Wallet Adapter project is a
non-release foundation and does not yet provide complete block, mute, report,
appeal, label, evidence, or crisis-resource workflows. A mobile release requires
feature parity for applicable safety controls plus TalkBack, lifecycle,
deep-link, wallet-handoff, notification, and device-level abuse testing.

## 2. Goals

The moderation model must:

- Give people immediate, comprehensible control over what reaches them.
- Protect people who are frequently targeted without requiring disclosure of
  protected identity.
- Let communities adopt and export their own lawful rules and scoped moderator roles.
- Let clients and indexers publish different lawful policies without pretending that one company controls all protocol speech.
- Restrict protocol validity only for narrow technical abuse.
- Preserve due process through reasons, audit trails, review, and appeals.
- Minimize collection and disclosure of private or sensitive evidence.
- State accurately whether an action is personal, community-scoped, service-scoped, or protocol-validity related.

Moderation does not make public content globally erasable. Service operators can refuse to index, deliver, or display content; people can publish tombstones and request provider deletion; independent systems may retain valid signed material.

## 3. Authority model

Every moderation outcome must identify its layer:

1. **Personal controls:** The person controls their own experience.
2. **Community controls:** A community applies its published rules within community scope.
3. **Client or indexer policy:** An operator decides what its service will process or display.
4. **Protocol validity:** Software rejects malformed, cryptographically invalid, replayed, or technically abusive input.

No layer may describe its decision as a universal protocol removal unless the object is actually invalid under the versioned protocol rules.

### 3.1 Published policy documents

Community, client, and indexer policies must be:

- Versioned and machine-readable
- Human-readable in plain language
- Signed by the responsible authority
- Addressable by stable identifier and content hash
- Timestamped with effective and superseded dates
- Explicit about jurisdiction and scope
- Exportable without a proprietary API
- Retained with a change history sufficient to evaluate an appeal

A moderation action records the exact policy version and rule identifier used at decision time.

## 4. Layer 1: personal controls

All controls in this section are **Planned**.

### 4.1 Block

A block must:

- Immediately suppress direct interaction and discovery in the blocker’s client.
- Prevent new follows, mentions, message requests, and direct notifications between affected identities in the official client.
- Filter direct posts and indirect resurfacing through quotes, reposts, recommendations, search, and third-party feed results shown by the official client.
- Avoid notifying the blocked person that a block occurred.
- State whether the underlying block edge is public, private, local, encrypted, or protocol-visible before publication.

### 4.2 Mute and keyword filters

Mutes and keyword filters:

- Are private by default.
- Support account, conversation, phrase, hashtag, and time-bounded forms.
- Apply before recommendation scoring and notification delivery.
- Provide a preview and undo path.
- Never expose the muted term in public activity.

### 4.3 Interaction controls

People can configure:

- Who may reply, quote, remix, mention, follow, or request a message
- Whether potentially sensitive media is hidden, warned, or shown
- Whether presence and typing indicators are sent
- Whether non-followers can include media or links in replies
- A temporary safety mode that limits high-volume incoming interactions
- Anti-dogpile controls based on rate, account age signals, and relationship distance

Safety mode must show what it changes, how long it lasts, and how to restore the previous settings.

### 4.4 Shared blocklists

Before enabling a shared blocklist, a person sees:

- Publisher identity and signature status
- Policy version and update frequency
- Approximate size
- Inclusion criteria
- Representative preview entries and reasons where lawful
- False-positive and appeal process
- Data disclosed to the provider

Activation is reversible. List updates must not silently broaden the user’s other visibility or data-sharing settings.

## 5. Layer 2: community moderation

Communities define published rules, scoped moderator permissions, actions, appeal procedures, and policy providers.

### 5.1 Roles and permissions

Roles must use least privilege. Permission scopes include, at minimum:

- View ordinary reports
- View specially restricted evidence
- Apply labels
- Hide content within the community
- Temporarily restrict posting
- Remove membership
- Manage join requests
- Escalate urgent safety cases
- Review appeals
- Manage other moderators
- Change rules or policy providers

No moderator may review an appeal of their own action. Administrative override requires a distinct permission and an audit reason.

The current predeployment DroolNet membership instruction is narrower than this
planned role system. Only the community creator identity's current root or a
current `community`-scoped delegate can remove or ban an existing membership.
`remove` is valid only from active; `ban` is valid from active, left, or
removed; and banned is terminal. These transitions cannot create a join or
impersonate the member's leave. Richer moderator-role authorization and appeal
execution remain planned.

### 5.2 Community actions

Available actions include:

- Guidance or warning
- Content warning or contextual label
- Reduced distribution within the community
- Reply or posting cooldown
- Temporary restriction with expiry
- Community-content removal
- Membership suspension or removal
- Emergency safety action with mandatory secondary review

An action never changes the author’s signed content. It changes community or service treatment of that content.

### 5.3 Action record

Every non-personal action records:

- Stable action identifier
- Actor identity or protected staff pseudonym
- Permission scope
- Target object and object hash
- Policy version and rule
- Reason category and moderator note
- Evidence references with access controls
- Created, effective, expiry, review, and reversal timestamps
- Scope and distribution consequences
- Appeal eligibility and deadline
- Superseding action, if any

The signed membership-v2 remove/ban manifest requires a bounded nonblank
reason, but that public portable reason is not a place for report narrative,
private evidence, protected traits, or personal information. Use only a
non-sensitive policy category/reference. The public exact-address membership
status endpoint omits the reason, actor/member identities, signer authority,
and manifest location and provides no roster; the underlying Solana event and
content reference remain publicly observable.

Sensitive internal notes and evidence must not be placed onchain or in public manifests.

## 6. Layer 3: client and indexer policies

Client and indexer operators may adopt different lawful content policies. They must publish:

- Policy and jurisdiction
- Label sources they trust
- Content they exclude, warn, blur, or de-rank
- Appeal route for operator actions
- Handling of tombstones and deletion requests
- Retention and transparency-report practices
- Automated decision systems and their review boundaries

Operators must not alter a valid signed manifest while presenting it as the author’s original. Contextual labels must identify their issuer separately from author-asserted labels.

A user may configure another compatible indexer or client. Provider switching must not bypass the user’s own blocks or expose private preferences.

## 7. Layer 4: protocol validity

Protocol-level rejection is reserved for:

- Malformed or oversized payloads
- Invalid signatures or hashes
- Unauthorized mutations
- Replayed actions
- Invalid version or canonical serialization
- Denial-of-service patterns
- Spam floods that exceed documented technical limits
- Illegal-content handling that an operated service is legally required to perform

Viewpoint, lawful identity expression, criticism, or disagreement must not be encoded as cryptographic invalidity.

## 8. Reporting taxonomy

All categories are **Planned**. The policy must support jurisdiction-specific refinement without changing canonical evidence.

| Category | Examples and handling notes |
|---|---|
| Harassment | Targeted abuse, dogpiling, repeated unwanted contact |
| Identity-targeted abuse | Targeted slurs, repeated use of rejected identity labels, outing threats |
| Threats or incitement | Credible threats, calls for targeted violence |
| Doxxing and privacy | Private addresses, contact details, medical or identity information |
| Nonconsensual intimate media | Actual, threatened, or synthetic intimate material without consent |
| Child safety | Suspected exploitation, grooming, or sexual content involving minors; restricted workflow |
| Impersonation | Deceptive identity presentation, excluding obvious parody or commentary |
| Spam and manipulation | Floods, scams, coordinated inauthentic behavior, undisclosed automation |
| Malicious links or media | Malware, phishing, wallet-draining prompts, exploit payloads |
| Community rule | Community-specific rule identifier required |
| Intellectual property | Operator workflow subject to qualified legal review |
| Self-harm or crisis concern | Support-resource hook; not a diagnosis or automatic punitive action |
| Other unlawful content | Jurisdiction and legal basis required for operator escalation |

The interface must explain that an incorrect category does not invalidate a good-faith report.

## 9. Report flow and evidence

### 9.1 Submission

A reporter can:

1. Select an object, account, conversation, or community action.
2. Select a category and optional narrative.
3. Preview the exact evidence being disclosed.
4. Include only selected private messages or attachments.
5. Remove unrelated context and sensitive metadata where safe.
6. Choose whether follow-up contact is permitted.
7. Receive a stable receipt without exposing the report publicly.

The report UI must never imply global deletion or guaranteed enforcement.

### 9.2 Evidence integrity and privacy

- Public evidence records the referenced manifest identifier, content hash, signature status, and retrieval time.
- Private evidence is encrypted at rest and in transit with role-restricted access.
- Onchain accounts and public manifests contain no report narrative, recovery contact, IP address, private-message plaintext, or sensitive evidence.
- Evidence exported for legal or child-safety handling uses an auditable, least-disclosure workflow.
- The reporter explicitly controls disclosure of selected E2EE messages.
- Access to specially restricted evidence is separately logged and reviewed.

### 9.3 Acknowledgement states

The reporter sees accurate states:

- Received
- Awaiting triage
- Under review
- More information requested
- Action taken, with scope
- No action under the cited policy
- Referred to another authority, where disclosure is legally permitted
- Appealed
- Closed

“Removed” must identify whether the content was hidden personally, removed from a community, excluded by an operator, deleted from a provider, or invalidated by protocol rules.

## 10. Triage and enforcement

### 10.1 Priority

Priority considers credible imminent harm, child safety, nonconsensual intimate media, exposed private location, active malware or wallet-draining attacks, coordinated harassment velocity, and vulnerability of the target. Protected identity alone is not a risk score; the system evaluates reported conduct and context.

### 10.2 Decision rules

- Automated systems may order a queue, identify duplicates, or apply a reversible user-configurable warning.
- Automated classification may not infer sensitive identity, medical,
  ethnicity, religion, or political-belief attributes.
- Private user content is not sent to third-party AI services by default.
- Irreversible service enforcement based on content requires trained review and an appeal path, except for cryptographic invalidity or clearly automated technical abuse.
- A moderator records both supporting and materially exculpatory context.
- Sanctions are proportional, scoped, time-bounded where possible, and consistent with the cited policy version.

### 10.3 Emergency actions

An emergency action:

- Uses the narrowest effective scope.
- Records the emergency reason and expiry.
- Notifies a second authorized reviewer.
- Enters mandatory review within the configured period.
- Automatically expires or converts to a normal reviewed action.
- Does not erase the appeal right.

## 11. Appeals

**MOD-APL-001 — Planned.** A person can appeal eligible community or operator action without revealing more personal information than the original action requires.

An appeal includes:

- Action identifier and policy version
- Plain-language reason for the original decision
- Appeal deadline
- Free-text response and optional evidence
- Conflict-of-interest check
- Reviewer independent from the original decision
- Outcome, rationale, and restoration steps

Successful appeals reverse distribution restrictions where technically possible, update relevant projections, and preserve an audit record of both actions. Independent copies of public content may remain.

## 12. Identity and privacy safety requirements

### 12.1 Names and outing risk

- Current-profile and moderation tools use the current stated name.
- Obsolete-name data is not included in ordinary moderator search merely for convenience.
- Historical signed records, if required to evaluate a report, display a warning before identity history.
- Repeated use of rejected identity labels and threats to disclose private
  identity information can be reported as identity-targeted abuse.
- The review focuses on conduct, context, repetition, and target impact; it does not require the reporter to prove a legal identity or disclose medical information.

### 12.2 Doxxing

The composer and report tools should warn before publishing likely private addresses, phone numbers, precise locations, recovery contacts, or sensitive identity information. A warning must not automatically send the content to a third party.

### 12.3 Nonconsensual intimate media

The workflow provides:

- Restricted evidence access
- Rapid service-level suppression where policy and law permit
- Hash or matching-provider hooks with strict governance
- An appeal path for mistaken matches
- Support information selected for the user’s region
- Clear distinction between service suppression and permanent global erasure

### 12.4 Child safety

Child-safety reports use a restricted queue, trained authorized personnel, evidence-minimizing access, preservation rules, and jurisdiction-specific escalation approved by qualified counsel. The repository must not contain real illegal test material; safe synthetic fixtures are required.

### 12.5 Crisis resources

Crisis-resource hooks are supportive and optional. They do not infer a diagnosis, contact authorities automatically, disclose private content to a third party by default, or reduce account reach solely because resources were shown.

## 13. Immutable content, deletion, and moderation

A valid signed public object may exist in several places:

- A Solana-hosted DroolNet program reference or tombstone
- A deletion-compatible content provider
- An intentionally permanent provider
- Operator caches and search indexes
- Recipient devices
- Independent indexers or archives

Moderation and deletion must therefore use precise verbs:

- **Hide:** Do not render to one person.
- **Label:** Add issuer-attributed context without changing author content.
- **De-rank:** Reduce distribution under a published feed or service policy.
- **Community remove:** Stop showing within one community.
- **Operator suppress:** Stop an operated client/indexer from serving it.
- **Provider delete request:** Ask a storage provider to remove its copy.
- **Tombstone:** Publish a signed revocation/deletion intent and suppress in compliant clients.
- **Key destruction:** Make encrypted content unavailable to parties without another key copy.
- **Protocol reject:** Treat an object as technically invalid.

Official services must honor a valid tombstone after ingestion, purge their eligible caches, and issue configured deletion requests. They must also disclose that a blockchain reference, permanent provider, recipient, or independent operator may retain the original bytes.

Moderation evidence retention is separate from public display. Restricted evidence may be retained for appeal, safety, or lawful obligations according to [PRIVACY.md](./PRIVACY.md), but must not remain public merely because it is evidence.

## 14. Moderator integrity

Required controls include:

- Strong authentication and separately scoped roles
- No shared moderator accounts
- Least-privilege access to evidence
- Immutable or tamper-evident action logs
- Conflict-of-interest declarations and recusals
- Expiring elevated access
- Periodic permission review
- Abuse reporting against moderators
- Rate limits and anomaly alerts on bulk actions
- Dual control for policy, role, or evidence-export changes
- Documented incident response for moderator-account compromise

Community governance cannot vote away a person’s block, expose private evidence, or retroactively change a signed report.

## 15. Transparency and portability

Operators and communities must be able to export aggregate, privacy-preserving data for transparency reports, including:

- Report and action counts by category and scope
- Median triage and appeal time
- Reversal rates
- Automated-prioritization usage
- Emergency-action counts and review outcomes
- Legal request counts where disclosure is lawful
- Child-safety escalations in an appropriately aggregated form

Small cells must be suppressed or combined to prevent re-identification. Raw private reports are not transparency-report data.

Community rules, trusted label-provider references, moderator role definitions, and non-sensitive action history must be exportable in a versioned format. Private evidence and moderator notes require a separate authorized migration process.

## 16. Verification requirements

The moderation feature set remains **Planned** until all applicable checks pass.

### 16.1 Automated acceptance criteria

- **MOD-TST-001:** Blocks and mutes suppress direct and indirect resurfacing across feed, search, notifications, quotes, and recommendations.
- **MOD-TST-002:** Permission tests reject every moderator action outside the actor’s scope.
- **MOD-TST-003:** A moderator cannot decide an appeal of their own action.
- **MOD-TST-004:** Policy-version and rule identifiers persist through action and appeal.
- **MOD-TST-005:** Private-message reporting discloses only messages selected in the confirmation preview.
- **MOD-TST-006:** Sensitive evidence never appears in public APIs, manifests, logs, analytics, or onchain fixtures.
- **MOD-TST-007:** A valid tombstone suppresses content in official client, feed, search, cache, and indexer projections.
- **MOD-TST-008:** Shared blocklist activation requires preview and can be reversed.
- **MOD-TST-009:** Automated recommendations do not make irreversible enforcement decisions.
- **MOD-TST-010:** Emergency actions expire or enter mandatory secondary review.
- **MOD-TST-011:** Current-profile moderation views use the current chosen name and guard historical revisions.
- **MOD-TST-012:** Accessibility tests cover reporting, evidence preview, action notice, and appeal.

### 16.2 Reproducible manual acceptance

- A keyboard-only user can block, report, inspect evidence disclosure, and appeal.
- A moderator can explain the exact authority, scope, policy version, and duration of an action.
- A reporter can distinguish personal hide, community removal, operator suppression, provider deletion, tombstone, and protocol rejection.
- A community can export its rules and roles and import them into a clean compatible environment.
- A privacy reviewer can trace every evidence access and export.

## 17. Launch blockers and external review

Moderation is not production-ready until:

- The report, appeal, action-log, role, retention, and transparency implementations pass verification.
- Child-safety and nonconsensual-intimate-media workflows receive qualified specialist and legal review.
- Operator jurisdictions, notices, preservation rules, and lawful-request procedures are configured.
- Moderator training, escalation coverage, and incident runbooks exist.
- No high-severity known moderation bypass or private-evidence exposure remains.

These reviews support legal and operational readiness; this document does not claim legal compliance.

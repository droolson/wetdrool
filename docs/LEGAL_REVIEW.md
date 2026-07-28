# Legal and policy review scope

Status: technical planning material only. This document is not legal advice and
does not claim compliance with any law or policy.

Qualified counsel and specialist safety reviewers must review the product,
protocol, operated services, public policies, and target regions before launch.
Repository controls can support compliance; they cannot establish it alone.

## Required review areas

- Entity, ownership, open-source licensing, trademarks, brand clearance, and
  contributor terms.
- Terms of service, privacy notice, cookie notice, community guidelines,
  acceptable-use policy, appeals policy, transparency reporting, and law
  enforcement request policy.
- GDPR/UK GDPR roles, lawful bases, special-category data, data-subject rights,
  international transfers, processor agreements, DPIA, records of processing,
  and representative/DPO requirements.
- CCPA/CPRA notice, access/deletion/correction, sensitive information, sale or
  sharing, targeted advertising, service-provider terms, and request handling.
- Children and teen safety, age assurance, parental consent where applicable,
  minor privacy defaults, grooming/exploitation response, and regional
  restrictions.
- Child sexual abuse material reporting and preservation obligations, hash-list
  use, escalation access, staff safety, and jurisdiction-specific process.
- Nonconsensual intimate imagery, intimate deepfakes, copyright, defamation,
  harassment, stalking, doxxing, hate, violent threats, crisis resources, and
  evidence handling.
- Digital-services, platform-transparency, notice-and-action, trader/creator,
  recommender-system, and risk-assessment obligations in served regions.
- Electronic communications, encrypted messaging, metadata retention,
  interception requests, export controls, and cryptography restrictions.
- Noncustodial tips, subscriptions, token allowlists, consumer disclosures,
  refunds, sanctions, AML/money-transmission boundaries, tax reporting, and
  creator payout obligations.
- Accessibility laws and the evidentiary standard for WCAG conformance claims.
- Storage-provider permanence, deletion limitations, decentralized replication,
  indexer/operator roles, and who is responsible for third-party clients.
- Incident notification, breach response, security safe harbor, insurance, and
  vendor contracts.

## Technical artifacts for counsel

The implementation must generate and maintain:

- A field-level data inventory with purpose, sensitivity, source, storage,
  visibility, encryption, processors, retention, deletion, export, and legal
  owner.
- Data-flow and trust-boundary diagrams for web, protocol, indexer, relay,
  moderation, messaging, media, analytics, recovery, payments, and support.
- Retention schedules enforced by jobs with auditable exceptions.
- User-rights procedures and machine-readable export formats.
- Onchain and permanent-storage disclosures tied to explicit user actions.
- Moderation taxonomy, evidence controls, audit logs, conflicts, appeals, and
  staff-access controls.
- Age-gating hooks and regional configuration that fail safely.
- Vendor/subprocessor inventory and transfer locations.
- Incident, preservation, legal-hold, and deletion-conflict procedures.
- Versioned policy documents and proof of user acceptance where required.

## Launch blockers

No production-readiness claim may be made while the applicable legal and policy
documents are placeholder text, while payment or child-safety duties are
unresolved, or while the public product contradicts its deletion, encryption,
moderation, decentralization, or privacy disclosures.


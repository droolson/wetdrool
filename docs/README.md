# WokeSocial documentation

This directory contains the product, protocol, trust, safety, development, and
operations documentation for WokeSocial and WokeNet.

WokeSocial is the social platform and flagship product at `woke.social`.
WokeNet is its portable protocol and Anchor smart-contract layer on Solana. It
is not a blockchain, validator network, Solana fork, or Firedancer/Agave
topology.

## Documentation status

The repository is in active pre-release development. Documents distinguish
among planned, experimental, locally verified, externally blocked, and
production-ready work. Unless a document cites reproducible evidence, do not
treat an architectural design or roadmap item as implemented.

The source repository is currently private. These documents describe the
checked-in project state; they do not prove a public service, Solana deployment,
security audit, `$WOKE` mint, or Solana Seeker release.

## Start here

| Audience                       | Recommended path                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| New contributor                | [Repository README](../README.md) → [Contributing](../CONTRIBUTING.md) → [Development](DEVELOPMENT.md) → [Developer handoff](DEVELOPER_HANDOFF.md) → [Testing](TESTING.md) |
| Product or design contributor  | [Product specification](PRODUCT_SPEC.md) → [Brand](BRAND.md) → [Accessibility](ACCESSIBILITY.md) → [Roadmap](ROADMAP.md)                 |
| Protocol or Solana contributor | [Architecture](ARCHITECTURE.md) → [Protocol](PROTOCOL.md) → [ADRs](DECISIONS/) → [Testing](TESTING.md)                                   |
| Security or privacy reviewer   | [Security policy](../SECURITY.md) → [Security design](SECURITY.md) → [Threat model](THREAT_MODEL.md) → [Privacy](PRIVACY.md)             |
| Trust-and-safety contributor   | [Moderation](MODERATION.md) → [Privacy](PRIVACY.md) → [Legal review scope](LEGAL_REVIEW.md)                                              |
| Operator or release reviewer   | [Deployment](DEPLOYMENT.md) → [Operations](OPERATIONS.md) → [Decentralization](DECENTRALIZATION.md) → [Final report](../FINAL_REPORT.md) |

## Product and experience

| Document                                 | Purpose                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Product specification](PRODUCT_SPEC.md) | Product principles, audiences, journeys, feature boundaries, and delivery status            |
| [Platform expansion](PLATFORM_EXPANSION.md) | Planned video, `.woke` names, points, avatars, verification, AI, market intelligence, and governance systems |
| [Woke AI platform](AI_PLATFORM.md)       | Athena, Kairos, Hermes, owned-hardware evaluation, inference, credits, training, privacy, and release gates |
| [Organization](ORGANIZATION.md)          | Owner-provided corporate structure, product responsibilities, service boundaries, and verification limits |
| [Brand](BRAND.md)                        | Voice, visual direction, inclusive identity UX, and originality expectations                |
| [Accessibility](ACCESSIBILITY.md)        | Accessibility requirements, implemented evidence, and the remaining manual conformance work |
| [Roadmap](ROADMAP.md)                    | Dependency-ordered phases, exit criteria, and explicit production blockers                  |

## Architecture and protocol

| Document                                | Purpose                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [Architecture](ARCHITECTURE.md)         | System layers, trust boundaries, data placement, authority, and provider replaceability                     |
| [Protocol](PROTOCOL.md)                 | Canonical objects, signatures, identifiers, program accounts, instructions, events, and compatibility rules |
| [Decentralization](DECENTRALIZATION.md) | Portability, independent operation, exit paths, operator power, and remaining decentralization gaps         |
| [Architecture decisions](DECISIONS/)    | Compatibility-significant decisions and rejected alternatives                                               |

### Architecture decision records

| ADR                                                           | Decision                                       |
| ------------------------------------------------------------- | ---------------------------------------------- |
| [0001](DECISIONS/0001-authority-boundaries-and-layering.md)   | Authority boundaries and layering              |
| [0002](DECISIONS/0002-canonical-serialization-and-hashing.md) | Canonical serialization and hashing            |
| [0003](DECISIONS/0003-onchain-offchain-data-split.md)         | Onchain/offchain data split                    |
| [0004](DECISIONS/0004-indexer-projection-and-replay.md)       | Indexer projection and replay                  |
| [0005](DECISIONS/0005-provider-replaceability.md)             | Provider replaceability                        |
| [0006](DECISIONS/0006-passkey-account-key-boundary.md)        | Passkey/account-key boundary                   |
| [0007](DECISIONS/0007-messaging-cryptographic-engine.md)      | Messaging cryptographic engine                 |
| [0008](DECISIONS/0008-canonical-domain-transition.md)         | Canonical-domain transition to `woke.social`   |
| [0009](DECISIONS/0009-wokenet-on-solana.md)                   | WokeNet as a Solana program and protocol layer |
| [0010](DECISIONS/0010-verified-community-discovery.md)        | Verified community discovery                   |
| [0011](DECISIONS/0011-member-signed-community-membership.md)  | Member-signed community membership             |
| [0012](DECISIONS/0012-woke-name-namespace.md)                 | Versioned `.woke` identity names                |

## Security, privacy, and safety

| Document                                     | Purpose                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Repository security policy](../SECURITY.md) | Vulnerability-reporting rules and current intake limitations                                |
| [Security design](SECURITY.md)               | Security requirements, controls, verification expectations, and unresolved risks            |
| [Threat model](THREAT_MODEL.md)              | Assets, adversaries, trust boundaries, abuse cases, and mitigations                         |
| [Privacy](PRIVACY.md)                        | Data classification, visibility, retention, deletion, export, and provider responsibilities |
| [Moderation](MODERATION.md)                  | Labels, reports, appeals, evidence handling, governance, and transparency                   |
| [Legal review scope](LEGAL_REVIEW.md)        | Topics and artifacts that require qualified legal and policy review before launch           |
| [Code of Conduct](../CODE_OF_CONDUCT.md)     | Contributor behavior and enforcement expectations                                           |

The legal and policy materials are technical planning aids, not legal advice.
The security and conduct mailboxes named in policy documents are not yet
verified intake channels; follow the exact warnings in those documents.

## Engineering, testing, and operations

| Document                                             | Purpose                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Development](DEVELOPMENT.md)                        | Setup, repository orientation, everyday workflows, and review expectations    |
| [Developer handoff](DEVELOPER_HANDOFF.md)            | Current-state continuity guide for resuming work without prior task transcripts |
| [Testing](TESTING.md)                                | Test layers, verified evidence, adversarial vectors, and release gates        |
| [Deployment](DEPLOYMENT.md)                          | Environment, artifact, authority, rollout, and public-deployment requirements |
| [Operations](OPERATIONS.md)                          | Service ownership, readiness, observability, incidents, backups, and runbooks |
| [Infrastructure README](../infra/README.md)          | Local provider-neutral infrastructure                                         |
| [Solana network README](../network/solana/README.md) | WokeNet deployment-manifest and cluster metadata boundaries                   |

## Delivery evidence

| Record                                                               | Purpose                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [TASKS.md](../TASKS.md)                                              | Checkbox-level implementation and verification boundary             |
| [FINAL_REPORT.md](../FINAL_REPORT.md)                                | Current evidence snapshot and production NO-GO decision             |
| [Git history](https://github.com/wokesocial/wokesocial/commits/main) | Change history in the private source repository; access is required |

An unchecked broad task can contain a tested subset. A checked task is not a
substitute for production deployment, external audit, independent operation,
or release approval unless its evidence explicitly proves that outcome.

## Maintaining these documents

- Update the relevant specification and evidence record in the same change as
  behavior that affects users, compatibility, authority, privacy, security,
  moderation, accessibility, or operations.
- Add an ADR before merging a decision that changes canonical bytes, IDs,
  signatures, PDA seeds, account layouts, authority, trust boundaries, provider
  contracts, permanence, or migration behavior.
- Use exact terms: WokeSocial for the platform, WokeNet for the protocol and
  Solana program layer, and Solana for the underlying chain.
- Do not describe local-validator results as devnet, mainnet-beta, public
  deployment, or production evidence.
- Do not describe SOL or lamports as `$WOKE`. No `$WOKE` mint exists.
- Keep legacy hostnames redirect-only; see
  [ADR-0008](DECISIONS/0008-canonical-domain-transition.md).
- Run `pnpm format:check` after editing Markdown and verify every relative link
  you add.

Documentation improvements are first-class contributions. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for the contribution process.

# Organization and product ownership

- **Status:** Owner-provided target structure; legal status not independently
  verified by this repository
- **Last updated:** 2026-07-29

## 1. Target structure

The project owner has specified this intended organization:

```mermaid
flowchart TD
  Pinkman["Pinkman, Inc. — umbrella corporation"]
  Social["Woke Social, Inc. — Woke.social product and WokeNet stewardship"]
  AI["Woke AI, Inc. — Woke AI models and pinkman.ai services"]
  Records["ICEFAM Records, LLC. — music and media business"]
  Pinkman --> Social
  Pinkman --> AI
  Pinkman --> Records
```

The intended entity forms are:

| Entity | Intended form | Product responsibility |
| --- | --- | --- |
| Pinkman, Inc. | C corporation | Umbrella ownership, shared strategy, and approved shared services |
| Woke Social, Inc. | Subsidiary corporation | Woke.social application, WokeSocial services, WokeNet protocol stewardship, and community products |
| Woke AI, Inc. | Delaware C corporation subsidiary | Woke AI model development, inference, evaluation, and planned `pinkman.ai` services |
| ICEFAM Records, LLC. | Subsidiary limited liability company | Music, recording, artist, and related media operations |

This file records product intent, not a legal opinion, certificate of
incorporation, ownership ledger, tax election, trademark registration, or
intercompany agreement. Public legal claims require review against current
official records.

## 2. Technical ownership boundaries

Woke Social, Inc. is the intended operator of Woke.social and steward of the
open WokeNet protocol. Woke AI, Inc. is the intended operator of the Woke AI
model and inference layer. Pinkman, Inc. may provide approved shared services.
ICEFAM Records, LLC. does not receive WokeSocial user data or Woke AI prompts
by default.

```mermaid
flowchart LR
  User["Woke.social user"] --> Social["WokeSocial product boundary"]
  Social -->|"Explicit AI request, scoped data, published contract"| AI["Woke AI provider boundary"]
  AI -->|"Model output, provenance, metering, privacy receipt"| Social
  Social --> Solana["Solana + WokeNet"]
  Social --> Providers["Replaceable storage/indexer/feed providers"]
  Parent["Pinkman shared services"] -. "Contracted minimum access" .-> Social
  Parent -. "Contracted minimum access" .-> AI
  Records["ICEFAM Records"] -. "No default data path" .- Social
```

An ownership relationship does not erase service boundaries. Each cross-entity
data flow requires:

- a named purpose and data classification;
- a controller/processor or equivalent responsibility decision;
- least-privilege access;
- a retention and deletion rule;
- security and incident obligations;
- user-facing disclosure and consent where required;
- an auditable API or administrative path; and
- an exit or provider-replacement plan.

## 3. Agreements required before production

Qualified counsel and finance professionals should determine the actual
documents required. The engineering plan should expect at least:

- intellectual-property assignment and cross-license terms;
- WokeNet open-source stewardship and trademark policy;
- Woke AI inference and data-processing agreement;
- shared employee, contractor, infrastructure, security, and support services;
- brand and domain licensing;
- intercompany pricing, billing, and cost allocation;
- privacy, security-incident, insurance, and records responsibilities;
- creator marketplace, subscription, points, redemption, and refund ownership;
- model and training-data rights;
- treasury, token, wallet, and transaction authority separation; and
- dissolution, sale, provider exit, and user-data migration obligations.

The product must not begin collecting money, verification evidence, training
consent, or real transaction authority merely because an entity name appears
in this document.

## 4. Open-source and governance boundary

Corporate ownership and open protocol governance are separate:

- WokeNet protocol specifications and first-party source are intended to remain
  under the repository’s published open-source license.
- A corporation may operate the flagship client without becoming the only
  valid client, indexer, storage provider, feed provider, RPC provider, or AI
  provider.
- Purchased points, SOL, NFTs, subscriptions, company shares, or a future
  `$WOKE` balance do not automatically grant protocol governance power.
- Trademark, safety, app-store, employment, treasury, and regulated business
  decisions may remain corporate responsibilities even when protocol changes
  use open governance.

## 5. Public naming

Use:

- **WokeSocial** for the product and application;
- **WokeNet** for the Solana protocol/program namespace;
- **Woke AI** for the AI model and service family;
- **Woke Athena**, **Woke Kairos**, and **Woke Hermes** for measured model
  product tiers; and
- **Pinkman, Inc.** only when referring to the umbrella organization.

Do not imply that Woke Social, Inc., Woke AI, Inc., ICEFAM Records, LLC.,
`pinkman.ai`, trademarks, or subsidiary relationships have been legally
verified by this repository. Release communications should cite the current
official corporate and domain records.

# Contributing to WokeSocial

WokeSocial is actively looking for contributors.

We are building an inclusive social platform for everyone, with a portable
protocol layer on Solana. Contributions are welcome from people of every
identity, discipline, background, and experience level. You do not need to be a
blockchain specialist, and useful contributions are not limited to code.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Please
read it before joining project discussions.

## Repository access

The GitHub repository, `AlexBTC420/wokesocial`, is currently private. It is not
yet an open public issue tracker or public fork target. Access is invite-only.
Prospective contributors who already have a direct channel to
[@AlexBTC420](https://github.com/AlexBTC420) may request access and an initial
area of work there. A public contributor-intake channel has not yet opened; the
GitHub profile link is an identity reference, not a guaranteed inbox.

Once access is granted, use the private repository's issues and pull requests
for normal collaboration. Never use them for unpatched vulnerabilities,
credentials, private user content, personal data, seed phrases, private keys,
passkey material, or production connection details.

## Ways to contribute

The project benefits from a broad range of expertise:

- **Web and product engineering:** accessible social journeys, verified
  publication, community membership, authenticated relationships, provider
  states, offline behavior, and careful failure UX.
- **Solana and protocol engineering:** Anchor program review, transaction
  safety, canonical schemas, SDKs, indexer conformance, migrations, localnet
  testing, and eventual public-cluster rehearsal.
- **Solana Seeker and Android:** Mobile Wallet Adapter integration, native
  accessibility, device and intent testing, reproducible builds, signing
  provenance, and secure update planning.
- **Security and privacy:** threat modeling, passkey and custody review,
  canonicalization, authorization, adversarial testing, metadata minimization,
  incident design, and independent audit preparation.
- **Trust and safety:** moderation workflows, appeals, evidence minimization,
  abuse resistance, transparency, governance, and survivor-centered product
  review.
- **Accessibility and design:** manual WCAG evaluation, keyboard and assistive
  technology testing, inclusive identity UX, information architecture, content
  design, and original visual-system development.
- **Infrastructure and reliability:** provider replaceability, observability,
  replay, fault injection, backups, deployment evidence, and independent
  operation.
- **Testing and developer experience:** deterministic fixtures, integration
  harnesses, cross-language vectors, browser tests, performance evidence,
  contributor tooling, and CI clarity.
- **Documentation and community:** tutorials, diagrams, terminology review,
  status reconciliation, contributor onboarding, governance research, and
  community stewardship.

The [roadmap](docs/ROADMAP.md), [task record](TASKS.md), and
[final verification report](FINAL_REPORT.md) describe the current boundaries.
Coordinate before starting broad work: an unchecked requirement may already
contain a tested subset, and a locally verified subset must not be presented as
production-ready.

## A good first contribution

A strong first change is small, independently reviewable, and proves one useful
outcome. Examples include:

- clarifying a documented limitation or adding a missing documentation link;
- adding one adversarial test for an existing public contract;
- improving keyboard, screen-reader, reduced-motion, or high-contrast behavior;
- replacing ambiguous status copy with an evidence-backed state;
- improving a local setup diagnostic without weakening fail-closed behavior;
  or
- adding a deterministic fixture for an already specified protocol case.

Ask for a bounded issue if you are unsure where to begin. Maintainers should
help shape an initial task that can be reviewed without requiring hidden
context.

## Before implementation

Read the documents relevant to your change:

- [development guide](docs/DEVELOPMENT.md);
- [architecture](docs/ARCHITECTURE.md) and
  [protocol](docs/PROTOCOL.md);
- [testing strategy](docs/TESTING.md);
- [security design](docs/SECURITY.md),
  [threat model](docs/THREAT_MODEL.md), and
  [privacy design](docs/PRIVACY.md); and
- [moderation](docs/MODERATION.md) and
  [accessibility](docs/ACCESSIBILITY.md) when the user experience is affected.

Discuss the proposal before coding if it changes any of the following:

- canonical bytes, signatures, object identifiers, schemas, PDA seeds, account
  layouts, instructions, events, or version negotiation;
- identity authority, passkey or wallet custody, recovery, delegation, program
  upgrade authority, or provider trust;
- public/private data placement, retention, deletion, encryption, permanent
  storage, moderation evidence, or user safety;
- database or protocol migrations, provider contracts, public APIs, or
  compatibility guarantees;
- future payment or token behavior; or
- Android permissions, wallet intents, package signing, updates, or
  distribution.

Accepted compatibility or trust-boundary decisions should be recorded as an
architecture decision record in `docs/DECISIONS/`.

## Local setup

The repository pins Node `22.23.1`, pnpm `11.2.2`, Rust `1.89.0`, Solana
`2.3.0`, and Anchor `0.32.1`. Do not silently substitute newer versions.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm setup
pnpm dev
```

`pnpm setup` checks the required toolchain, installs project-local chain tools,
starts the local PostgreSQL, Redis, and Kubo/IPFS services, validates the typed
environment, and applies migrations. See
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for focused workflows and
troubleshooting.

## Engineering conventions

- Applications live in `apps/*`; shared TypeScript packages live in
  `packages/*`; the WokeNet program lives in `programs/social_protocol`.
- Shared protocol schemas are defined once and imported by clients and
  services.
- PostgreSQL indexers are rebuildable projections. Redis is disposable
  coordination. Neither is canonical protocol state.
- External dependencies use exact versions; internal packages use
  `workspace:` references.
- TypeScript is strict. Avoid `any`, unexplained lint suppression, swallowed
  errors, unsafe logging, and unbounded parsing or retries.
- New environment variables require typed validation in `packages/config` and
  a safe local example in `.env.example`.
- Production and shared configurations fail closed. Local bypasses must be
  explicit, development-only, and loopback-only.
- Use WokeSocial for the product, WokeNet for the protocol/program layer, and
  Solana for the chain. WokeNet is not a separate blockchain or validator
  network.
- Never call SOL or lamports `$WOKE`. No `$WOKE` mint exists, and the legacy
  payment ABI remains quarantined.
- `woke.social` is the canonical origin. Legacy hostnames are redirect-only.

## Tests and evidence

Run the smallest relevant checks while iterating, then the applicable
repository gates before requesting review:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run boundary-specific suites when affected:

```sh
pnpm test:integration
pnpm test:e2e
pnpm test:programs
pnpm test:vertical-slice
pnpm measure:performance
```

`pnpm verify` runs the normal repository quality gate. `pnpm verify:all`
includes the available integration, browser, local-validator, connected-slice,
performance, dependency-audit, and secret-scan gates. It can be expensive and
requires local services.

Do not turn a missing, skipped, or mocked gate into a success claim. Pull
requests must list exact commands and results, including intentional skips,
environment limitations, and remaining unverified behavior.

## Pull requests

Keep pull requests focused. A review-ready description explains:

1. the user, contributor, protocol, or operator outcome;
2. the design and important alternatives;
3. compatibility, migration, privacy, security, moderation, accessibility, and
   decentralization impact;
4. failure, retry, rollback, or roll-forward behavior;
5. exact automated and manual verification; and
6. known limitations or follow-up work.

Include tests that fail before and pass after a behavior change. Update
generated clients, schemas, fixtures, ADRs, operations guidance, and evidence
documents when their contracts change. Use conventional commit subjects such
as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, or `chore:`.

The pull request template is a minimum checklist, not a substitute for
explaining risk. Review comments should be specific, respectful, and focused on
the work rather than the contributor.

## Security and sensitive reports

Do not report a vulnerability in an issue or pull request. Follow
[SECURITY.md](SECURITY.md), including its warning that the intended security
mailbox is not yet a verified intake channel. Do not test against accounts or
systems you do not control, access more data than necessary, or publish
permanent harmful test content.

## Licensing

By contributing, you agree that your contribution is licensed under the
repository's [MIT License](LICENSE). Third-party code and assets must be
compatible with the project, retain all required notices, and be clearly
identified. Do not copy code, visuals, datasets, or other material unless its
provenance and license permit the intended use.

Thank you for helping build WokeSocial with care, rigor, and respect for the
people who will depend on it.

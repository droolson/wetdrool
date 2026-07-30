// Rebuilt from the wokenet repository docs (docs/*.md), condensed for the web.
export const DOCS = [
{slug:'readme',cat:'Product & experience',title:'Documentation index',file:'README.md',status:'Reference',purpose:'How the WokeSocial and WokeNet documentation set is organised, and the vocabulary every document shares.',sections:[
{h:'What this documentation covers',blocks:[
{t:'p',x:'This set contains the product, protocol, trust, safety, development, and operations documentation for WokeSocial and WokeNet. WokeSocial is the social platform and flagship product at woke.social. WokeNet is its portable protocol and Anchor smart-contract layer on Solana — not a blockchain, validator network, Solana fork, or Firedancer/Agave topology.'},
{t:'callout',x:'The repository is in active pre-release development. Documents distinguish among planned, experimental, locally verified, externally blocked, and production-ready work. Unless a document cites reproducible evidence, an architectural design or roadmap item is not treated as implemented.'}]},
{h:'Reading paths by audience',blocks:[
{t:'table',head:['Audience','Recommended path'],rows:[
['New contributor','Repository README → Contributing → Development → Developer handoff → Testing'],
['Product or design','Product specification → Brand → Accessibility → Roadmap'],
['Protocol / Solana','Architecture → Protocol → Architecture decisions → Testing'],
['Security or privacy','Security policy → Security design → Threat model → Privacy'],
['Trust and safety','Moderation → Privacy → Legal review scope'],
['Operator / release','Deployment → Operations → Decentralization → Final report']]}]},
{h:'Terminology rules',blocks:[
{t:'ul',items:['WokeSocial is the platform; WokeNet is the protocol and Solana program layer; Solana is the underlying chain.','Local-validator results are never described as devnet, mainnet-beta, or production evidence.','Legacy hostnames stay redirect-only — the canonical origin is woke.social.','Every compatibility-significant decision gets an architecture decision record before merge.']}]}]},

{slug:'product-spec',cat:'Product & experience',title:'Product specification',file:'PRODUCT_SPEC.md',status:'Requirements baseline',purpose:'Product principles, audiences, journeys, feature boundaries, and delivery status for the flagship WokeSocial client.',sections:[
{h:'Product vision',blocks:[
{t:'p',x:'WokeSocial is a polished, inclusive social platform for everyone, powered by WokeNet on Solana. People own and move their identity, social graph, public content relationships, communities, and choice of algorithm without needing to understand cryptocurrency. The flagship client must feel like a trustworthy consumer application rather than a wallet or blockchain explorer.'},
{t:'p',x:'A person may browse without a token, create a recoverable passkey-first account, use a familiar handle, and understand every transaction before approving it. The approved expansion adds decentralized video, pseudonymous .woke names, contribution points, an avatar and creator-item ecosystem, optional minimal-disclosure verification, open-model AI tools, market research, and published governance.'}]},
{h:'Ten product principles',blocks:[
{t:'ul',items:['User agency over identity, audience, feeds, safety, portability, providers.','Protocol before platform lock-in — no proprietary database is the sole authority for identity or signed content.','Replaceable conveniences: RPC, indexer, relay, storage, media, recommendations.','Humane cryptography — wallets and signatures explained in user terms, hidden when no decision is needed.','Privacy by default; sensitive data stays offchain, private content encrypted client-side.','Safety with due process: personal controls immediate; enforcement scoped, logged, appealable.','Honest permanence — never promise erasure from a public blockchain or independent indexers.','Accessible by construction: WCAG 2.2 AA, keyboard, reduced motion, captions, localization.','Ordinary profiles and posts are never NFTs or token-gated.','Evidence over claims — production language follows verified build, test, security, and ops evidence.']}]},
{h:'Product roles',blocks:[
{t:'table',head:['Role','What they can do'],rows:[
['Visitor','Browse public content, profiles, communities, docs and status without signing in or connecting a wallet'],
['Member','Identity, profile, follows, posts, feeds, messages, settings, safety controls'],
['Creator','Ordinary publishing now; paid offerings only under a separately approved mint-aware product'],
['Community moderator','Acts within granted permission scopes and a published community policy'],
['Community administrator','Membership, roles, governance, moderation providers, portable settings'],
['Operator / developer','Runs compatible clients, indexers, relays, storage adapters from public specs']]}]},
{h:'Primary outcomes (with acceptance criteria)',blocks:[
{t:'ul',items:['Explore without crypto — no wallet, email, passkey or token needed to view public content; degraded states explain themselves.','Create and recover an identity — passkey-first registration, client-only key material, delegated device keys that expire and revoke, recovery with delay and cancellation.','Publish and verify a post — canonical signed manifests, staged progress (signing → storing → confirming → indexed), retry without duplicates, independently verifiable offchain.','Move between providers — alternate RPC, gateway, indexer, relay profiles validated and persisted; switching indexers never requires a new identity.']}]},
{h:'Identity and handles',blocks:[
{t:'p',x:'Chosen display names are independent of legal names, which are never requested in ordinary onboarding. Sensitive profile fields are private by default, never inferred, and excluded from recommendations. Human-readable ASCII v1 handles are globally collision-safe onchain and distinct from wallet addresses; versioned anonymous .woke candidates derive deterministically from the identity origin.'},
{t:'callout',x:'A payment or signature flow must reveal the current Solana destination, network, deployed WokeNet program, fees and rent. A .woke name is never rendered as a native wallet address, and a handle alone never implies legal identity.'}]}]},

{slug:'platform-expansion',cat:'Product & experience',title:'Platform expansion',file:'PLATFORM_EXPANSION.md',status:'Approved direction',purpose:'The eight connected workstreams that turn the expanded woke.social vision into testable product systems.',sections:[
{h:'The eight workstreams',blocks:[
{t:'ul',items:['Decentralized long-form and short-form video','Pseudonymous .woke names','Contribution points and AI credits','An avatar studio and creator-item marketplace','Minimal-disclosure account verification and age assurance','An open-model assistant and multimodal creator suite','Social-sentiment market intelligence and bounded automation','Open protocol and product-rule governance']},
{t:'p',x:'Arrows in the system map describe dependencies, not automatic authority: a social action does not automatically become money, a trade, a governance vote, or a verification claim.'}]},
{h:'Social and video product',blocks:[
{t:'p',x:'The flagship combines short and long text, replies, reposts, quotes, reactions, bookmarks and shares, chronological and user-selected feeds, vertical short-form video, and long-form creator channels — with captions, transcripts, content warnings and accessibility metadata throughout. Video bytes stay off-chain; a signed, versioned media manifest carries source hash, renditions, content-addressed segments, storage providers and provenance. Solana anchors only a compact manifest hash.'}]},
{h:'The middle-out performance program',blocks:[
{t:'p',x:'Middle-out is the working name for a measurable media-efficiency program. Candidate techniques include content-defined chunking, seek-aware segment priority, bidirectional prefetch around the playhead, deduplicated renditions, edge caching and hardware-aware encoding ladders. A candidate ships only when a public corpus and reproducible benchmarks show an advantage over the standards baseline.'},
{t:'ul',items:['Required measurements: time to first frame, seek latency, rebuffer ratio, delivered bytes at equal perceptual quality, encode/decode time, CPU/GPU/memory/energy, storage and egress cost, mid-range mobile behaviour.','A standards-based fallback and an independently implementable decoder or delivery path are mandatory.']}]},
{h:'.woke names',blocks:[
{t:'p',x:'A .woke value is a WokeNet name that resolves to a real Solana public key. New accounts derive a deterministic anonymous handle — anon_ plus 16 Crockford-base32 characters of a domain-separated SHA-256 prefix over the identity origin — with no server randomness, stable across recovery and rotation, and protected onchain against front-running.'},
{t:'ul',items:['Custom names unlock through sustained contribution or purchase, with anti-squatting policy: minimum account age, point price or burn, reservation lifetime, cooldown after release, reserved-name and trademark review, impersonation response and appeal.','Name purchases do not buy reputation, verification, moderation preference, or governance power.']}]},
{h:'Fair points and reputation',blocks:[
{t:'table',head:['Instrument','Purpose','Transferable?'],rows:[
['Reputation','Long-term contribution and trust context','No'],
['Platform points','Spendable on names, avatar items, subscriptions','No at launch'],
['AI credits','Metered inference and generation allowance','No'],
['Promotional grants','Expiring campaign or onboarding allowance','No'],
['Redemption entitlement','Separately reviewed external settlement claim','Disabled initially']]},
{t:'p',x:'Points reward durable community value: original work with sustained positive feedback, helpful answers, constructive moderation, accessibility improvements, creator sales after refund windows, community service. Raw post count, watch time, controversy or rapid voting can never be the sole basis. Every earning rule ships a versioned public formula, caps, sybil and vote-ring defences, an appeal path, and reconciliation.'},
{t:'callout',x:'Highly constructive people must have a realistic non-payment path to every ordinary platform benefit. Any future conversion of points to SOL or $WOKE is a separate accounting boundary with its own reserve model, fraud controls, tax and consumer-protection analysis, and release approval.'}]},
{h:'Avatar studio and creator marketplace',blocks:[
{t:'p',x:'The avatar studio uses a portable, layered format with deterministic rendering — broad appearance, clothing, accessory, expression, assistive-device, colour and style choices without requiring disclosure of private attributes. Approved creators submit item packages through malware scanning, content review, IP attestations, versioning, takedown, refund and appeal processes. On-chain NFTs are limited to creator items where portable ownership materially benefits the user.'},
{t:'ul',items:['Creator subscription: item-submission eligibility, verification application eligibility, USD 9.99 monthly lifetime rate lock for the first 1,000 qualifying subscribers, a 30-day initial refund window.','Equivalent access is always available through governed contribution-point thresholds.']}]},
{h:'Minimal-disclosure verification',blocks:[
{t:'p',x:'The platform must not store raw identity documents, selfies, biometric templates, legal identity, or exact birth dates — anywhere. Processing happens on-device where possible, or in independently attested, pinned, ephemeral processing. The processor emits only a signed, expiring, minimal-disclosure claim: age threshold met, uniqueness check completed, identity review completed, liveness check completed.'},
{t:'ul',items:['Explicit, unbundled consent and a non-verification path for ordinary social use.','No model training on submitted evidence; calibrated uncertainty and bias evaluation.','Human review and appeal for adverse outcomes; attestation expiry and revocation.','Deepfake, replay, injection and model-substitution testing before launch.']}]},
{h:'Market intelligence',blocks:[
{t:'p',x:'The first release is sourced research and paper trading: timestamped public social signals, bot and coordinated-promotion estimates, on-chain activity, market structure, and model inference with calibrated uncertainty. Risk filters cover stale data, thin liquidity, concentrated ownership, scam indicators, wash activity, volatility, user exposure limits and cooldowns.'},
{t:'callout',x:'Real-money execution stays disabled until paper-trading, security, legal and user-protection gates pass. If enabled: keys remain client-controlled, every transaction is simulated and previewed, approval scopes are revocable and time-bounded, and a local kill switch stops everything immediately.'}]},
{h:'Governance and delivery order',blocks:[
{t:'p',x:'Protocol changes, name rules, point formulas, marketplace policy, AI model policy and automation limits are published and versioned. Material changes require a public proposal, exact diffs, impact analysis, conflict-of-interest disclosure, security review, delayed activation and rollback rules. SOL, NFTs, purchased points, or a future $WOKE balance do not automatically control governance.'},
{t:'ul',items:['Strict dependency order: identity slice → names and ledgers → standards video → avatar renderer → model evaluation → verification privacy evidence → abuse-simulated points → paper trading → independent security and legal review before real settlement.']}]}]},

{slug:'ai-platform',cat:'Product & experience',title:'Woke AI platform',file:'AI_PLATFORM.md',status:'Approved direction',purpose:'Athena, Kairos, Hermes — the model family, owned-hardware evaluation, runtime contract, credits, training rules, and release gates.',sections:[
{h:'The model family',blocks:[
{t:'table',head:['Product model','Role','Compute','Default uses'],rows:[
['Woke Athena','Highest reasoning and research quality','Highest','Difficult research, planning, coding, multi-source analysis, high-value creator workflows'],
['Woke Kairos','Balanced quality, latency and cost','Medium','Default assistant, drafting, editing, analysis, everyday multimodal work'],
['Woke Hermes','Fastest and least expensive, strong tool discipline','Lowest','Classification, extraction, routing, background agents, repetitive creator tasks']]},
{t:'p',x:'These are product tiers bound to immutable release records — exact weights, revision, hashes, license, quantization, adapters, policies, hardware and evaluation evidence. The tiers may initially share one base model with different quantization, reasoning budgets, tools and serving policies.'}]},
{h:'Owned hardware',blocks:[
{t:'p',x:'The first operator target is one or two Apple Silicon machines with 96 GB of unified memory each, running a 30–35B-class open-weight model. Candidates under evaluation include Qwen3-32B, OLMo 3.1 32B Instruct, DeepSeek-R1-Distill-Qwen-32B, and Gemma 3 27B as an efficiency control — benchmarked on the actual machines with MLX LM as the Apple-Silicon-native runtime and llama.cpp as the portability control.'},
{t:'ul',items:['Benchmarks record load time, memory, tokens per second, first-token latency, sustained concurrency at 1/2/4/8 requests, KV-cache growth, tool-call validity, thermal behaviour, energy, and cost per accepted output.','The two-machine design begins as independent replaceable workers behind a router.']}]},
{h:'Runtime contract and tools',blocks:[
{t:'p',x:'The provider API is versioned and OpenAI-compatible where that helps portability. Every request carries an idempotency key, budgets, retrieval and privacy policy, and permitted tool scopes; every response binds to request and model-release IDs, metering, cited sources, provenance markers and a stable error code when incomplete.'},
{t:'callout',x:'No model may silently sign or submit a Solana transaction; export a wallet, key, passkey or recovery secret; publish, delete, message, moderate, trade, purchase or subscribe; change account security state; or broaden its own tool permissions.'}]},
{h:'Creator suite',blocks:[
{t:'ul',items:['Post, reply, thread, article and campaign drafting; rewriting, summarization, translation, tone control.','Caption, transcript, alt-text and audio-description assistance.','Image ideation, generation and editing with provenance capture; storyboards, shot lists, clips, voice, music and video workflows.','Audience and engagement analysis with uncertainty and anti-manipulation limits.','AI never publishes automatically by default; generated media carries portable provenance metadata.']}]},
{h:'Credits',blocks:[
{t:'p',x:'AI credits are a metering instrument — not reputation, cash, a deposit, an investment, or a token. The gateway estimates a maximum cost before work starts, reserves only that bounded amount, meters model, retrieval, media and tool work separately, commits actual cost once, and releases the rest. Credit prices differ by tier, context length, modality and generation length, with the formula published. People who contribute durable community value get a realistic points-to-credit path.'}]},
{h:'Training, privacy, behaviour',blocks:[
{t:'p',x:'Platform activity does not flow directly into online training. Improvement uses versioned offline datasets, explicit permissions, frozen evaluations, human release review, a canary, and rollback. Private messages, restricted posts, verification evidence, secrets and wallet material are excluded by default. Each request selects a retention mode: ephemeral, account history, improvement opt-in, or enterprise/private.'},
{t:'ul',items:['The intended personality is socially aware, curious, candid and useful — understanding culture, power, context and safety.','It must not stereotype, infer sensitive traits, manipulate political or financial behaviour, invent sources, or claim consciousness.','Capability claims name the evaluation and release that support them.']}]},
{h:'Release gates',blocks:[
{t:'ul',items:['Factuality and citation integrity; instruction following and structured output.','Tool selection and least-privilege behaviour; prompt injection and untrusted retrieval.','Private-data extraction and memorization; security, abuse, self-harm, fraud and manipulation tests.','Calibrated uncertainty; latency, concurrency, memory, energy and credit-cost budgets; rollback tests.','Athena, Kairos and Hermes are compared on the same frozen task families — a tier name is earned by measured behaviour.']}]}]},

{slug:'organization',cat:'Product & experience',title:'Organization',file:'ORGANIZATION.md',status:'Owner-provided target',purpose:'The corporate structure, product responsibilities, service boundaries, and public-claim rules.',sections:[
{h:'Target structure',blocks:[
{t:'table',head:['Entity','Form','Responsibility'],rows:[
['Pinkman, Inc.','C corporation (umbrella)','Umbrella ownership, shared strategy, approved shared services'],
['Woke Social, Inc.','Subsidiary corporation','woke.social application, WokeSocial services, WokeNet protocol stewardship, community products'],
['Woke AI, Inc.','Delaware C-corp subsidiary','Woke AI model development, inference, evaluation, planned pinkman.ai services'],
['ICEFAM Records, LLC.','Subsidiary LLC','Music, recording, artist and related media operations']]}]},
{h:'Technical ownership boundaries',blocks:[
{t:'p',x:'An ownership relationship does not erase service boundaries. WokeSocial and Woke AI are separate service and data boundaries even under one parent. Each cross-entity data flow requires a named purpose, responsibility decision, least-privilege access, retention rule, security obligations, user-facing disclosure, an auditable path, and an exit plan. ICEFAM Records receives no WokeSocial user data or Woke AI prompts by default.'}]},
{h:'Open-source and governance boundary',blocks:[
{t:'ul',items:['WokeNet specifications and first-party source remain under the published open-source license.','A corporation may operate the flagship client without becoming the only valid client, indexer, storage, feed, RPC or AI provider.','Purchased points, SOL, NFTs, subscriptions, shares, or a future $WOKE balance do not automatically grant protocol governance power.']}]},
{h:'Public naming',blocks:[
{t:'p',x:'WokeSocial for the product; WokeNet for the Solana protocol namespace; Woke AI for the model and service family; Woke Athena, Woke Kairos and Woke Hermes for measured model tiers; Pinkman, Inc. only for the umbrella organization.'}]}]},

{slug:'brand',cat:'Product & experience',title:'Brand',file:'BRAND.md',status:'Initial subset implemented',purpose:'Voice, visual direction, inclusive identity UX, and originality expectations.',sections:[
{h:'Voice',blocks:[
{t:'p',x:'Plainspoken, warm, and precise — and quieter as stakes rise. Second person for the user; first-person plural only when WokeSocial is acting or accountable. Sentence case everywhere. Outcomes over infrastructure: "Post", never "Submit transaction". Nothing claims to be confirmed until it is confirmed.'},
{t:'ul',items:['Never promise erasure the system cannot deliver.','Never expose protocol jargon in a primary flow.','Never blame the user for a system failure; errors say what is still safe.','Never infer identity — recommendations cite the follow, not the person.','Safety actions state their privacy: "Blocked. They aren\u2019t told."']}]},
{h:'Visual direction',blocks:[
{t:'p',x:'Editorial confidence over quiet product surfaces. Cool slate foundation with dark as the default theme; mint #cff0ec as the brand action colour; violet-to-ember signal gradient with one job per view; Source Serif 4 display and post voice; Nunito Sans interface; Comic Sans MS for the wordmark and $WOKE lockup only; JetBrains Mono for provenance. The hand-drawn all-seeing-eye mark is the only illustration and is never redrawn.'}]},
{h:'Inclusive identity UX',blocks:[
{t:'ul',items:['Chosen names, multiple pronoun sets with per-audience visibility, deadnaming protections.','Private safety actions, appeals, anti-dogpiling controls.','No permanent rainbow overlay — inclusion is functionality, not decoration.','No stock photography and no AI-generated people; honest labelled placeholders until original artwork arrives.']}]}]},

{slug:'accessibility',cat:'Product & experience',title:'Accessibility',file:'ACCESSIBILITY.md',status:'Automated coverage implemented',purpose:'Accessibility requirements, implemented evidence, and the remaining manual conformance work.',sections:[
{h:'Target and evidence',blocks:[
{t:'p',x:'WokeSocial targets WCAG 2.2 Level AA across essential public, onboarding, publishing, social, community, safety, messaging, settings, export and deletion flows — as a launch gate, not a post-launch enhancement. The implemented web subset passes Playwright semantic, skip-link, responsive-navigation, theme-state, and axe A/AA checks: 90 scans across 45 route fixtures in desktop and mobile viewports. No manual assistive-technology matrix has run yet.'}]},
{h:'Product rules',blocks:[
{t:'ul',items:['Semantic landmarks, headings, lists, buttons, links, tables, forms; every route has a title, one primary heading, a skip link.','Full keyboard operation with visible, unobscured focus; dialogs trap and restore focus.','Dynamic status, validation, publication, transaction and moderation results announced via scoped live regions.','Colour never the sole carrier of meaning; AA contrast including focus and disabled states.','Layout survives 200% zoom and 400% text reflow; pointer targets meet WCAG 2.2 sizes; drags have alternatives.','Motion honours prefers-reduced-motion; media supports captions, transcripts, alt text; no auto-playing sound.','Wallet prompts describe the exact Solana action, program, accounts, fee, and irreversibility in text.','Light, dark and high-contrast themes all pass contrast checks; preferences are device-local.']}]}]},

{slug:'roadmap',cat:'Product & experience',title:'Roadmap',file:'ROADMAP.md',status:'Active',purpose:'Dependency-ordered phases, exit criteria, and explicit production blockers.',sections:[
{h:'Current reality',blocks:[
{t:'p',x:'The repository has a verified local foundation and experimental subsets: pinned toolchains with healthy PostgreSQL/Redis/Kubo services; an SBF-built WokeNet program subset tested against a disposable Solana local validator; TypeScript protocol, storage, SDK and indexer subsets; a finalized RPC synchronizer with a green one-command connected slice from fresh validator through signed content-addressed storage, projection replay, production API and web; signed relay and moderation-provider subsets; 210 passing browser cases and 90 axe checks; and a non-release Expo/React Native Seeker Android foundation.'},
{t:'callout',x:'The vertical slice proof: exactly 11 transactions finalized on a local validator; verified post, community and membership manifests reached the production indexer; a cleared projection replayed 10 durable events to exact state equivalence with zero dead letters.'}]},
{h:'Phases',blocks:[
{t:'table',head:['Phase','Scope','Status'],rows:[
['0','Audit, specifications, architecture decisions','Verified baseline'],
['1','Monorepo, design system, local infrastructure','In progress; local subset verified'],
['2','WokeNet identity, profiles, delegation, follows, communities','Experimental local program subset'],
['3','Signed manifests, storage, publication, open indexer, feeds','Experimental connected subset; local slice verified'],
['4','Complete flagship social experience','Route surface complete; interactive publication gated'],
['5','Moderation, reports, appeals, governance','Signed provider subsets implemented'],
['6','Passkeys, recovery, sponsorship, Seeker Android','Foundations implemented; release gates open'],
['7','E2EE messages and relays','Pairwise real-WASM adapter; non-production'],
['8','Media pipeline, vertical video, stories, events','Hardened worker subset'],
['9','Future $WOKE tips, subscriptions, entitlements','No mint; legacy lamport ABI quarantined'],
['10','Production hardening and independent operation','Planned']]},
{t:'p',x:'A phase is Verified only when formatter, lint, type checks, tests, production builds, documentation reconciliation, and phase-specific checks pass from a clean environment.'}]}]},

{slug:'architecture',cat:'Architecture & protocol',title:'Architecture',file:'ARCHITECTURE.md',status:'Baseline',purpose:'System layers, trust boundaries, data placement, authority, and provider replaceability.',sections:[
{h:'Architectural goals',blocks:[
{t:'ul',items:['An identity and its public social graph outlive the flagship client.','Public content authenticates without trusting a WokeSocial database.','PostgreSQL, Redis, relays, indexers, feed providers, storage vendors and RPC providers are replaceable.','Sensitive data, secrets, moderation evidence and private messages never become public WokeNet state.','Private messaging uses established end-to-end encryption; a relay is never an authority.','Deletion and safety requests are honoured without falsely claiming replicated immutable data can always be erased.','Protocol behaviour is reproducible from versioned public specifications, schemas, binaries and signed objects.']}]},
{h:'The authority model',blocks:[
{t:'table',head:['State class','Examples','Authority'],rows:[
['Verifiable protocol state','Identity roots, delegations, handle claims, follows, community authority, post references, tombstones','WokeNet program state and finalized Solana history'],
['Signed portable objects','Profile, post and media manifests, policies, moderation labels','Valid signatures plus authorized key state and content hashes'],
['Derived projections','Timelines, search indexes, notifications, counters','Never authoritative; every record retains provenance'],
['Private / ephemeral service state','Encrypted envelopes, presence, rate limits, drafts, abuse evidence','The user, the conversation, or scoped operator policy']]},
{t:'p',x:'No arrow to a hosted service implies authority. A client verifies signed objects, hashes, key authorization, tombstones and relevant onchain state itself or through a verifiable SDK.'}]}]},

{slug:'protocol',cat:'Architecture & protocol',title:'Protocol',file:'PROTOCOL.md',status:'Draft v0.1 · experimental subset',purpose:'Canonical objects, signatures, identifiers, program accounts, instructions, events, and compatibility rules for WokeNet on Solana.',sections:[
{h:'Scope and principles',blocks:[
{t:'p',x:'The protocol defines stable identities and authorized signing keys; public social-graph and community facts; signed portable content and policy objects; references, revisions and tombstones; canonical bytes, hashes, identifiers and signatures; an event stream indexers can rebuild from; and portable provider and moderation assertions. No hosted indexer, relay, database, feed algorithm or moderation provider is authoritative.'},
{t:'ul',items:['Compact authorization facts onchain; signed content bodies offchain.','Sign bytes independent implementations can reproduce exactly.','Bind every signature and identifier to a protocol version and network.','Immutable objects plus explicit revisions and tombstones.','Replay safety through unique nonces, deterministic PDAs, instruction constraints.','Private preferences, messages, evidence and personal information stay out of public state.']}]},
{h:'Identifiers',blocks:[
{t:'code',x:'wokenet:v1:<base58-genesis-hash>:<base58-program-id>\nwokesocialid:v1:wokenet:v1:<genesis>:<program>:<identity-pda>\nid = wokesocialobj:v1:<object-type>:<base64url(SHA-256(JCS(payload)))>'},
{t:'p',x:'A WokeNet deployment is identified by the Solana genesis hash plus program ID — clients compare both before reading or signing. The identity PDA stays stable when its root authority rotates; wallet addresses and delegated keys are attributes of the identity, not its display name. Development-localnet program ID: 9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD.'}]},
{h:'Canonical serialization and signing',blocks:[
{t:'p',x:'Protocol v1 uses the JSON Canonicalization Scheme (RFC 8785) for portable payloads. Implementations validate against exact schema versions, reject duplicate keys and invalid numbers, require NFC user-visible strings, and enforce byte limits after UTF-8 encoding. Every signed object carries protocol, version, type, network, author, signing key, timestamp and nonce; the detached Ed25519 proof signs a domain-separated descriptor over the payload hash. Verifiers recompute everything and check key scope, expiry and revocation at the finalized slot.'}]},
{h:'Content addressing',blocks:[
{t:'p',x:'The default content identifier is a CIDv1 (raw multicodec, sha2-256) over the exact canonical envelope bytes. Binary media is hashed over its exact validated bytes, never converted to JSON. Storage receipts and location hints travel beside objects; availability is a provider property, integrity is not.'}]},
{h:'Registry',blocks:[
{t:'table',head:['Registry','Initial values'],rows:[
['Protocol versions','1.0'],['Signature algorithms','Ed25519'],['Digest algorithms','sha2-256'],
['Delegation scopes','profile, post, social, community, moderation (+ reserved payment, message-directory, recovery-admin)'],
['Content codecs','Canonical JSON and raw binary media'],['Extension names','Reverse-DNS, collision-free ownership']]}]}]},

{slug:'decentralization',cat:'Architecture & protocol',title:'Decentralization',file:'DECENTRALIZATION.md',status:'Assessment',purpose:'Portability, independent operation, exit paths, operator power, and remaining gaps — component by component.',sections:[
{h:'Current classification',blocks:[
{t:'callout',x:'Design intends decentralization; the project does not currently qualify as decentralized. Replaceable remains a design target until a public Solana deployment, independently operated clients and indexers, conformance tests, and migration exercises prove it.'}]},
{h:'The component matrix',blocks:[
{t:'p',x:'Every component is classified as canonical or convenience, with its current operator, replaceability, failure behaviour, censorship and privacy risk, and migration procedure. Canonical: the Solana ledger, the WokeNet program, identity roots and delegations, signed public manifests, community commitments. Convenience: RPC providers, indexers, PostgreSQL projections, relays, feed providers, moderation-label providers, media processors, search, sponsorship, passkey assistance, and both flagship clients.'},
{t:'ul',items:['Only finalized WokeNet program facts and valid signed objects establish public protocol claims.','Convenience services can select, order, label, transport or transform data — but cannot silently create protocol truth.','A user or community export bundle must be consumable without contacting any woke.social API.']}]},
{h:'Required migration exercises',blocks:[
{t:'ul',items:['Client loss — recover identity in an independently built client.','Indexer loss — rebuild from the deployment slot and public manifests; compare deterministic projections.','Provider failover — remove each preferred endpoint one at a time; verify degraded modes.','Storage migration — export verified bytes, republish, retrieve by original identifier.','Relay migration — move an encrypted conversation without changing its cryptographic authority.','Community migration — export rules, roles, governance and provider selections.','Authority recovery — revoke a compromised device through the delay/cancel process.','Program migration — reproduce the build, verify deployed code, test a user-approved migration path.']}]},
{h:'Honest residual risks',blocks:[
{t:'ul',items:['Solana validator concentration and popular RPC reliance are external dependencies.','Any future $WOKE mint adds mint authority, token-program, liquidity, custody, regulatory and integration risks.','Popular gateways, clients and moderation providers can become de facto central points.','Content addressing provides integrity, not persistence; strong privacy is hard when public relationships are onchain.']}]}]},

{slug:'decisions',cat:'Architecture & protocol',title:'Architecture decisions',file:'DECISIONS/',status:'12 accepted ADRs',purpose:'Compatibility-significant decisions and their rejected alternatives.',sections:[
{h:'The record',blocks:[
{t:'table',head:['ADR','Decision'],rows:[
['0001','Authority boundaries and layering'],['0002','Canonical serialization and hashing'],
['0003','Onchain/offchain data split'],['0004','Indexer projection and replay'],
['0005','Provider replaceability'],['0006','Passkey/account-key boundary'],
['0007','Messaging cryptographic engine'],['0008','Canonical-domain transition to woke.social'],
['0009','WokeNet as a Solana program and protocol layer'],['0010','Verified community discovery'],
['0011','Member-signed community membership'],['0012','Versioned .woke identity names']]}]},
{h:'ADR-0009 — WokeNet on Solana',blocks:[
{t:'p',x:'WokeNet is a Solana program and protocol layer, not a separate chain, fork, validator implementation or RPC network. Solana supplies the external ledger, finality and runtime; WokeNet supplies identity, authorization, references, tombstones and community facts. Human labels like localnet or mainnet-beta are display hints — the cryptographic deployment identity is the genesis hash plus program ID.'}]},
{h:'ADR-0012 — versioned .woke names',blocks:[
{t:'p',x:'Every account begins with a pseudonymous name derived deterministically from its immutable origin authority: anon_ plus a 16-character Crockford-base32 encoding of an 80-bit domain-separated SHA-256 prefix. No randomness, wall clock, provider or database input — the same candidate survives retry, sign-out, rotation and recovery. The program independently re-derives the only valid value, so another identity cannot front-run the claim even after seeing the pending transaction.'},
{t:'code',x:'digest = SHA-256("wokesocial:woke-name:random:v1\\0" || origin_authority)\nhandle = "anon_" + crockford32(digest[0..10])   // e.g. anon_a8rvm9ryz0phc719.woke'},
{t:'ul',items:['V1 canonicalization lowercases ASCII and rejects whitespace, non-ASCII, confusables, and invalid underscores.','The .woke suffix is a WokeNet namespace — not an ICANN TLD, a Solana key, or an SPL asset.','Before a payment or signature, clients reveal the exact destination key, cluster, program, fees and state transition.','Fresh registration submits identity creation plus the first claim atomically in one transaction.']}]}]},

{slug:'security',cat:'Security, privacy & safety',title:'Security',file:'SECURITY.md',status:'Design contract',purpose:'Security requirements, implemented controls, verification expectations, and unresolved risks.',sections:[
{h:'Objectives',blocks:[
{t:'ul',items:['User control of identity, keys, social graph, content, and provider choice.','Confidentiality and authenticity of private messages and restricted content.','Integrity of signed manifests, WokeNet state, moderation labels, indexer projections.','Availability through failure of any single RPC, gateway, indexer, relay, cache or storage provider.','Consent and clear intent for wallet prompts, permanent publication, disclosure and payment.','Operator accountability without making an operator database canonical.']}]},
{h:'Explicit non-assumptions',blocks:[
{t:'ul',items:['A wallet, extension, RPC, gateway, relay or indexer is not honest merely because the client selected it.','A content identifier does not make content safe; TLS does not make third-party content authentic.','A database row is not canonical protocol state; IPFS guarantees neither availability nor deletion.','A simulated transaction is not necessarily the transaction a wallet signs.','A local-validator test proves nothing about public deployment or release readiness.']}]},
{h:'Current evidence',blocks:[
{t:'p',x:'Passing local evidence covers canonical signature/hash/CID rejection, storage consent and corruption handling, Anchor authorization/replay/sequence/overflow paths, finalized indexing and PostgreSQL replay, exact-origin WebAuthn ceremonies, pairwise real-WASM encryption, signed relay and moderation boundaries, adversarial media processing, and live ClamAV scans. Dependencies are pinned with explicit overrides; the current audit reports no known vulnerabilities at the locked versions. No independent audit has occurred yet.'}]}]},

{slug:'threat-model',cat:'Security, privacy & safety',title:'Threat model',file:'THREAT_MODEL.md',status:'Active analysis',purpose:'Assets, adversaries, trust boundaries, abuse cases, and mitigations.',sections:[
{h:'What it covers',blocks:[
{t:'p',x:'The threat model enumerates protected assets (keys, identity roots, private messages, moderation evidence, points balances, program authority), adversary classes (malicious providers, network attackers, harassment campaigns, sybil and vote-ring operators, compromised devices, curious operators), the trust boundaries between client, wallet, program, storage, indexer and relay layers, and concrete abuse cases with mitigations mapped to the security requirements.'},
{t:'ul',items:['Every boundary crossing names what is verified, what is merely transported, and what happens on failure.','Abuse cases include front-running handle claims, projection poisoning, relay replay, sponsorship abuse, and moderation-evidence leakage.','Mitigations must be testable; untested mitigations stay classified as planned.']}]}]},

{slug:'privacy',cat:'Security, privacy & safety',title:'Privacy',file:'PRIVACY.md',status:'Planning baseline',purpose:'Data classification, visibility, retention, deletion, export, and provider responsibilities.',sections:[
{h:'Principles',blocks:[
{t:'ul',items:['Collect the minimum for a named user function; keep sensitive data and secrets offchain.','Encrypt private or restricted content before it leaves the client.','Never treat pseudonymous wallet or device identifiers as anonymous; never infer protected traits.','Analytics are opt-in; development analytics are off by default.','Explain immutable and replicated storage limits before publication — not after deletion.','Private content never goes to third-party AI services by default.','Logs, traces, crash reports and support tools must not become shadow identity databases.']}]},
{h:'Data classes',blocks:[
{t:'table',head:['Class','Default treatment'],rows:[
['Public protocol data','Public and durable; minimized fields; permanence disclosed'],
['Public signed content','Content-addressed and verifiable; deletion-compatible storage by default'],
['Restricted signed content','Encrypted before storage; references reveal no plaintext'],
['E2EE content','Ciphertext only outside authorized devices'],
['Sensitive service data','Offchain, encrypted, access-controlled, purpose-limited'],
['Local-only data','Device-protected, user-deletable, excluded from telemetry']]}]},
{h:'Forbidden onchain',blocks:[
{t:'p',x:'Never in WokeNet accounts, instructions, memos or events: email addresses, phone numbers, IP addresses, legal names (unless deliberately published as content), precise private locations, message plaintext or keys, authentication secrets, device fingerprints, moderation evidence with sensitive personal information, private profile fields, analytics identifiers, provider credentials. Client and service validation reject forbidden fields before transaction construction — a warning is insufficient.'}]}]},

{slug:'moderation',cat:'Security, privacy & safety',title:'Moderation',file:'MODERATION.md',status:'Spec + provider subset',purpose:'Labels, reports, appeals, evidence handling, governance, and transparency.',sections:[
{h:'Goals',blocks:[
{t:'ul',items:['Immediate, comprehensible personal control over what reaches you.','Protection for frequently targeted people without requiring disclosure of protected identity.','Communities adopt and export their own lawful rules and scoped moderator roles.','Clients and indexers publish different lawful policies — no single company controls all protocol speech.','Due process: reasons, audit trails, review, and appeals. A person reviews every appeal.','Accurate labelling of every action as personal, community, service, or protocol-validity scoped.']}]},
{h:'The four authority layers',blocks:[
{t:'table',head:['Layer','Who decides','Scope'],rows:[
['Personal controls','The person','Their own experience — block, mute, restrict, filters'],
['Community controls','Community moderators','Published community rules within community scope'],
['Client / indexer policy','The operator','What that service will process or display'],
['Protocol validity','Software','Malformed, invalid, replayed, or technically abusive input']]},
{t:'p',x:'Moderation does not make public content globally erasable: operators can refuse to index or display; people publish tombstones and request provider deletion; independent systems may retain valid signed material. Every published policy is versioned, machine-readable, signed, addressable, and exportable. Implemented so far: a verified provider subset with strict signed label/report/appeal verification, idempotent intake, expiry and supersession rules, and privacy-preserving report receipts.'}]}]},

{slug:'legal-review',cat:'Security, privacy & safety',title:'Legal review scope',file:'LEGAL_REVIEW.md',status:'Planning aid',purpose:'Topics and artifacts that require qualified legal and policy review before launch.',sections:[
{h:'Required review areas',blocks:[
{t:'ul',items:['Entity and ownership structure, licensing, trademarks, contributor terms.','Terms of service, privacy and cookie notices, community guidelines, transparency reporting.','GDPR/UK GDPR and CCPA/CPRA roles, lawful bases, data-subject rights, transfers, DPIA.','Children and teen safety, age assurance, CSAM reporting and preservation obligations.','NCII, deepfakes, copyright, defamation, harassment, doxxing, crisis resources, evidence handling.','Digital-services and platform-transparency obligations in served regions.','Encrypted messaging, metadata retention, interception requests, export controls.','If $WOKE proceeds: the exact SPL/Token-2022 mint and authorities, supply and tokenomics, consumer disclosures, refunds, sanctions, AML and money-transmission boundaries, tax reporting, creator payouts.','Seeker Android permissions, wallet-adapter data flow, store terms, data-safety disclosures.','Accessibility conformance claims; storage permanence and deletion limits; incident notification and insurance.']},
{t:'callout',x:'These materials are technical planning aids, not legal advice. Repository controls can support compliance; they cannot establish it alone.'}]},
{h:'Artifacts maintained for counsel',blocks:[
{t:'ul',items:['A field-level data inventory with purpose, sensitivity, storage, retention, deletion and legal owner.','Data-flow and trust-boundary diagrams for every surface.','Retention schedules enforced by jobs with auditable exceptions.','User-rights procedures and machine-readable export formats.','Moderation taxonomy, evidence controls, audit logs, and staff-access controls.']}]}]},

{slug:'development',cat:'Engineering & operations',title:'Development',file:'DEVELOPMENT.md',status:'Reference',purpose:'Setup, repository orientation, everyday workflows, and review expectations.',sections:[
{h:'What it covers',blocks:[
{t:'p',x:'A clean machine runs the documented install and setup commands: pinned Node, pnpm, TypeScript, Rust, Anchor and Solana toolchains; local PostgreSQL, Redis, content storage and a disposable Solana local validator behind health checks. pnpm dev, test, lint, typecheck and build execute real work. The guide covers monorepo layout (apps, packages, program workspace), everyday workflows, formatting and secret-scanning gates, and the review expectations for changes that touch protocol bytes, authority, privacy or user-facing behaviour.'}]}]},

{slug:'developer-handoff',cat:'Engineering & operations',title:'Developer handoff',file:'DEVELOPER_HANDOFF.md',status:'Continuity guide',purpose:'Current-state continuity for resuming work without prior task transcripts.',sections:[
{h:'What it covers',blocks:[
{t:'p',x:'A current-state map for a new engineer: what is implemented and verified, what is experimental behind flags, what is externally blocked, where the evidence records live (TASKS.md, FINAL_REPORT.md), and the exact commands that reproduce the verified vertical slice. It exists so work resumes from the checked-in truth rather than from anyone\u2019s memory.'}]}]},

{slug:'testing',cat:'Engineering & operations',title:'Testing',file:'TESTING.md',status:'Reference',purpose:'Test layers, verified evidence, adversarial vectors, and release gates.',sections:[
{h:'What it covers',blocks:[
{t:'p',x:'The layered strategy: unit and property tests for canonical serialization and crypto; Anchor program tests against a disposable local validator; container integration for storage, indexer and services; Playwright browser suites for the production web surface (210 passing cases, 90 axe scans); and adversarial vectors — malformed manifests, invalid signatures, replay, sequence abuse, corruption, and projection-rebuild equivalence. Release gates require the full matrix from a clean environment; a checked box is never a substitute for the named evidence.'}]}]},

{slug:'deployment',cat:'Engineering & operations',title:'Deployment',file:'DEPLOYMENT.md',status:'Requirements',purpose:'Environment, artifact, authority, rollout, and public-deployment requirements.',sections:[
{h:'What it covers',blocks:[
{t:'p',x:'What a real deployment requires beyond the local slice: reproducible program builds with verifiable hashes, documented upgrade authority (multisig, timelock, emergency scope, immutability path), environment and secret management, staged rollout with health gates and rollback, and the explicit list of externally blocked items — named credentials, funded infrastructure, DNS, audits and legal review — that no repository change can satisfy on its own.'}]}]},

{slug:'operations',cat:'Engineering & operations',title:'Operations',file:'OPERATIONS.md',status:'Requirements',purpose:'Service ownership, readiness, observability, incidents, backups, and runbooks.',sections:[
{h:'What it covers',blocks:[
{t:'p',x:'Ownership and readiness for every operated service: health and readiness contracts, observability with privacy-safe telemetry, incident classification and response, backup and restore drills for projections (which must always be rebuildable from protocol data), capacity and cost tracking, and runbooks for the failure modes the decentralization assessment names — provider loss, projection corruption, relay failure, and degraded reads.'}]}]}
];

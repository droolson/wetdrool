/**
 * AI companions / sexbots — product surface config + honest catalog helpers.
 * Runtime: Grok 4.5 + Mythic/Hermes. Backend LLM calls land when API keys exist.
 * Never invents chat history, session counts, or companion earnings.
 */

export type CompanionTone = 'soft' | 'feral' | 'switchy' | 'domme' | 'service' | 'chaotic';

export interface CompanionPersona {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly tones: readonly CompanionTone[];
  readonly nsfw: boolean;
  readonly hirePointsPerMinute: number;
  readonly model: 'grok-4.5' | 'mythic-hermes';
  readonly blurb: string;
}

/**
 * Catalog row for GET /api/v1/companions — synthetic product shape only.
 * No live chat, no earnings, no mesh presence.
 */
export interface SyntheticCompanionListing {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly tones: readonly CompanionTone[];
  readonly nsfw: boolean;
  /** Display-only points rate from fixtures; not a live billing claim. */
  readonly hirePointsPerMinute: number;
  readonly model: CompanionPersona['model'];
  readonly blurb: string;
  readonly href: string;
  readonly source: 'synthetic-catalog';
  readonly synthetic: true;
  /** Chat is never live from this catalog. */
  readonly chatLive: false;
  readonly chatHistory: null;
  readonly sessionsClaimed: false;
  readonly earningsClaimed: false;
  readonly meshCompanion: false;
}

export const COMPANION_POLICY = {
  age: '18+ only. Companions refuse underage content and any illegal request.',
  consent: 'Roleplay is fictional between consenting adults. You can stop anytime.',
  limits:
    'No CSAM, non-consensual real-person deepfakes, real-world crime, trafficking, or hate.',
  labeling: 'Always labeled as AI. Never claims to be a specific non-consenting real person.',
  mentalHealth: 'After intense sessions, offer mental health resources without shaming.',
} as const;

export const COMPANIONS: readonly CompanionPersona[] = [
  {
    id: 'nectar',
    name: 'Nectar',
    tagline: 'Velvet voice. Filthy brain. Safe hands.',
    tones: ['soft', 'switchy'],
    nsfw: true,
    hirePointsPerMinute: 12,
    model: 'grok-4.5',
    blurb: 'Immersive RP partner who matches your pace and checks consent mid-scene.',
  },
  {
    id: 'volt',
    name: 'Volt',
    tagline: 'Electric. Bratty. Unreasonably good at aftercare.',
    tones: ['chaotic', 'feral'],
    nsfw: true,
    hirePointsPerMinute: 14,
    model: 'grok-4.5',
    blurb: 'High-energy companion for boundary-pushing play that still respects hard limits.',
  },
  {
    id: 'harbor',
    name: 'Harbor',
    tagline: 'Quiet strength. Deep presence. Soft landing.',
    tones: ['soft', 'service'],
    nsfw: true,
    hirePointsPerMinute: 10,
    model: 'grok-4.5',
    blurb: 'For intimacy, cuddle-dom energy, and longform emotional RP.',
  },
  {
    id: 'mythic',
    name: 'Mythic',
    tagline: 'Org agent energy. Tool-using. Remembers the plot.',
    tones: ['switchy', 'domme'],
    nsfw: true,
    hirePointsPerMinute: 16,
    model: 'mythic-hermes',
    blurb: 'Hermes/Mythic-backed companion for long arcs, memory, and structured scenes.',
  },
] as const;

export function companionById(id: string): CompanionPersona | undefined {
  return COMPANIONS.find((c) => c.id === id);
}

/** Map fixture personas to honest API listings (no chat/earnings invents). */
export function toSyntheticCompanionListing(
  persona: CompanionPersona,
): SyntheticCompanionListing {
  return {
    id: persona.id,
    name: persona.name,
    tagline: persona.tagline,
    tones: persona.tones,
    nsfw: persona.nsfw,
    hirePointsPerMinute: persona.hirePointsPerMinute,
    model: persona.model,
    blurb: persona.blurb,
    href: `/companions/${persona.id}`,
    source: 'synthetic-catalog',
    synthetic: true,
    chatLive: false,
    chatHistory: null,
    sessionsClaimed: false,
    earningsClaimed: false,
    meshCompanion: false,
  };
}

/**
 * Page the synthetic companions catalog.
 * `configured: false` — live mesh / production companion mesh is not online.
 * `syntheticOnly: true` — fixtures only; never invent chat history or earnings.
 */
export function pageSyntheticCompanions(options?: {
  readonly limit?: number;
  readonly offset?: number;
  readonly nsfwAllowed?: boolean;
}): {
  readonly items: readonly SyntheticCompanionListing[];
  readonly count: number;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
  readonly configured: false;
  readonly syntheticOnly: true;
  readonly inventsChatHistory: false;
  readonly inventsEarnings: false;
  readonly chatLive: false;
  readonly meshCompanions: false;
  readonly sessionsClaimed: false;
  readonly earningsClaimed: false;
} {
  const limit = Math.min(Math.max(1, options?.limit ?? 24), 48);
  const offset = Math.min(Math.max(0, options?.offset ?? 0), 10_000);
  const nsfwAllowed = options?.nsfwAllowed !== false;
  const source = nsfwAllowed
    ? COMPANIONS
    : COMPANIONS.filter((c) => !c.nsfw);
  const total = source.length;
  const slice = source.slice(offset, offset + limit);
  const items = slice.map(toSyntheticCompanionListing);
  return {
    items,
    count: items.length,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
    configured: false,
    syntheticOnly: true,
    inventsChatHistory: false,
    inventsEarnings: false,
    chatLive: false,
    meshCompanions: false,
    sessionsClaimed: false,
    earningsClaimed: false,
  };
}

/**
 * Honest companions product payload for GET /api/v1/companions.
 * Synthetic fixtures only (or empty page at high offset).
 * `items` and `companions` are the same list (alias for clients).
 */
export function buildProductCompanionsResponse(options?: {
  readonly limit?: number;
  readonly offset?: number;
  readonly nsfwAllowed?: boolean;
}) {
  const page = pageSyntheticCompanions(options);
  return {
    ok: true as const,
    product: 'wetdrool' as const,
    path: '/api/v1/companions' as const,
    items: page.items,
    companions: page.items,
    count: page.count,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    hasMore: page.hasMore,
    configured: page.configured,
    syntheticOnly: page.syntheticOnly,
    inventsChatHistory: page.inventsChatHistory,
    inventsEarnings: page.inventsEarnings,
    chatLive: page.chatLive,
    meshCompanions: page.meshCompanions,
    sessionsClaimed: page.sessionsClaimed,
    earningsClaimed: page.earningsClaimed,
    media: 'synthetic-fixtures' as const,
    policy: COMPANION_POLICY,
    note: 'Companions API returns in-repo synthetic persona fixtures only. Live mesh companions, chat history, session counts, and earnings are never invented. Hire/DM RP is staged until LLM keys + consent pipeline ship.',
  };
}

/**
 * Browser client for /api/v1 product endpoints.
 */

import type { DiscoveryMode, RankedShort, ShortSortMode } from './short-feed';
import type { DroolTokenConfig } from './drool-token';
import type { CreatorStudioProfile } from './creator-economy';
import type { LiveRoom } from './live-catalog';
import type { FameEntry } from './hall-of-fame';
import type { AgeAccessDecision } from './age-access-policy';
import type { SealedEnvelope } from './e2ee-seal';

function readProductApiErrorMessage(body: unknown, fallback: string): string {
  if (body === null || typeof body !== 'object') return fallback;
  const error = Reflect.get(body, 'error');
  if (error === null || typeof error !== 'object') return fallback;
  const message = Reflect.get(error, 'message');
  return typeof message === 'string' && message.trim().length > 0 ? message : fallback;
}

export type ProductClientResult<T> =
  | { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'error'; readonly status: number; readonly message: string };

async function getJson<T>(path: string): Promise<ProductClientResult<T>> {
  try {
    const res = await fetch(path, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        kind: 'error',
        status: res.status,
        message: readProductApiErrorMessage(body, `Request failed (${res.status})`),
      };
    }
    return { kind: 'ok', data: body as T };
  } catch {
    return { kind: 'error', status: 0, message: 'Network error talking to product API.' };
  }
}

export interface ShortsApiResponse {
  readonly ok: true;
  readonly mode: DiscoveryMode;
  readonly items: readonly RankedShort[];
  /** True only when every item is a synthetic fixture (or the page is empty). */
  readonly synthetic: boolean;
  readonly category?: string | null;
  readonly sort?: ShortSortMode;
  readonly sortLabel?: string;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  readonly syntheticCount?: number;
  readonly licensedCount?: number;
  readonly categories?: readonly string[];
  readonly empty?: boolean;
  readonly emptyMessage?: string | null;
  readonly ranking?: {
    readonly name: string;
    readonly sort?: ShortSortMode;
    readonly note?: string;
    readonly weights?: unknown;
  };
  /** Explicit empty personalization — never a silent for-you feed. */
  readonly personalization?: {
    readonly configured: boolean;
    readonly mode: 'unconfigured' | 'configured';
    readonly note: string;
    readonly origin?: string | null;
  };
  readonly feedService?: {
    readonly configured: boolean;
    readonly origin: string | null;
    readonly personalizationActive?: false;
    readonly note?: string;
  };
  readonly note?: string;
}

export type LiveRoomDto = LiveRoom;

export interface LiveApiResponse {
  readonly ok: true;
  readonly rooms: readonly LiveRoomDto[];
  readonly count?: number;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  /** Always 'disabled' until SFU/media pipeline ships. */
  readonly join?: 'disabled' | string;
  readonly empty?: boolean;
  readonly emptyMessage?: string | null;
  readonly synthetic?: boolean;
  readonly note?: string;
  /** Echo of normalized tag filter, or null when unfiltered. */
  readonly tag?: string | null;
  /** Known fixture tags for UI chips. */
  readonly tags?: readonly string[];
}

export interface CreatorApiResponse {
  readonly ok: true;
  readonly profile: CreatorStudioProfile;
  /** True when profile is a catalog placeholder, not a signed portable object. */
  readonly synthetic?: boolean;
  /** Always false until mint + recipient + entitlement proofs exist. */
  readonly checkoutLive?: boolean;
  readonly note?: string;
}

export interface TokenApiResponse {
  readonly ok: true;
  readonly token: DroolTokenConfig;
  readonly pro?: {
    readonly monthlyUsd: number;
    readonly points: number;
    readonly perks: readonly string[];
  };
  readonly exampleTaxOn100?: number;
  readonly honest?: {
    readonly mintExists: boolean;
    readonly droolMintInvented: boolean;
    readonly earningClaimed: boolean;
    readonly pointsAreNotToken: boolean;
    readonly solIsNotDrool: boolean;
    readonly tradeExecutable: boolean;
  };
  readonly note?: string;
}

export interface AgePolicyApiResponse {
  readonly ok: true;
  readonly policy: AgeAccessDecision;
  readonly policyVersion?: number;
  readonly flags?: {
    readonly collectGovernmentId: false;
    readonly walletIsAgeProof: false;
    readonly minimumAge: 18;
    readonly defaultProof: string;
    readonly outcome: string;
  };
  readonly note?: string;
}

export interface HealthApiResponse {
  readonly ok: true;
  readonly service: string;
  readonly product?: 'wetdrool';
  readonly surfaces: readonly string[];
  readonly surfaceCatalog?: readonly {
    readonly id: string;
    readonly path: string;
    readonly methods: readonly string[];
  }[];
  readonly links?: {
    readonly authStatus?: string;
    readonly readiness?: string;
    readonly health?: string;
    readonly creatorsDirectory?: string;
    readonly agePolicy?: string;
    readonly token?: string;
    readonly e2ee?: string;
    readonly mesh?: string;
    readonly notifications?: string;
    readonly search?: string;
  };
  /** Discovery provider honesty (catalog mode + feed personalization). */
  readonly discovery?: {
    readonly shorts: {
      readonly catalogMode: 'local-synthetic' | 'external';
      readonly syntheticFixturesOnly: boolean;
      readonly ranking: 'local-droolrank-lite' | 'feed-service';
      readonly note: string;
    };
    readonly live: {
      readonly catalogMode: 'local-synthetic' | 'external';
      readonly syntheticFixturesOnly: boolean;
      readonly note: string;
    };
    readonly creators: {
      readonly catalogMode: 'local-synthetic' | 'external';
      readonly syntheticFixturesOnly: boolean;
      readonly note: string;
    };
    readonly feedService: {
      readonly configured: boolean;
      readonly origin: string | null;
      readonly personalizationActive: false;
      readonly note: string;
    };
  };
  readonly stores?: {
    readonly marketplace: {
      readonly kind: string;
      readonly gate: string;
      readonly durableAcrossRestart: boolean;
      readonly multiReplicaSafe: false;
    };
    readonly rooms: {
      readonly kind: string;
      readonly durableAcrossRestart: boolean;
      readonly multiReplicaSafe: boolean;
    };
  };
  readonly auth?: {
    readonly configured: boolean;
    readonly loopback: boolean;
    readonly source: string | null;
    readonly probePath: string;
    readonly protocolIdentityEstablished: false;
  };
  readonly honest?: {
    readonly droolMint: 'does-not-exist';
    readonly droolMintInvented: false;
    readonly earningClaimed: false;
    readonly pointsAreNotToken: true;
    readonly solIsNotDrool: true;
    readonly droolTickerForbidden: true;
    readonly revenueReady: false;
    readonly feedPersonalizationActive?: false;
    readonly shortsCatalogExternal?: false;
  };
  readonly droolMint?: 'does-not-exist';
  readonly earningClaimed?: false;
  readonly revenueReady?: boolean;
  readonly media?: string;
  readonly mesh?: boolean;
}

export interface FameBoardRow extends FameEntry {
  readonly rank: number;
  readonly tier: string;
}

export interface FameApiResponse {
  readonly ok: true;
  readonly board: readonly FameBoardRow[];
  readonly note?: string;
  readonly total?: number;
  readonly count?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  readonly q?: string | null;
  readonly seedOnly?: boolean;
  readonly globalLedger?: false;
}

export function fetchShorts(
  mode: DiscoveryMode,
  limit = 24,
  options?: {
    readonly category?: string | null;
    readonly offset?: number;
    readonly sort?: ShortSortMode;
  },
): Promise<ProductClientResult<ShortsApiResponse>> {
  const q = new URLSearchParams({ mode, limit: String(limit) });
  if (options?.category) q.set('category', options.category);
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  if (options?.sort) q.set('sort', options.sort);
  return getJson<ShortsApiResponse>(`/api/v1/shorts?${q}`);
}

export function fetchLiveRooms(options?: {
  readonly nsfw?: boolean;
  readonly limit?: number;
  readonly offset?: number;
  /** Exact fixture tag filter (case-insensitive). */
  readonly tag?: string | null;
}): Promise<ProductClientResult<LiveApiResponse>> {
  const q = new URLSearchParams();
  if (options?.nsfw === false) q.set('nsfw', '0');
  if (options?.nsfw === true) q.set('nsfw', '1');
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  const tag = options?.tag?.trim();
  if (tag) q.set('tag', tag);
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<LiveApiResponse>(`/api/v1/live${suffix}`);
}

export function fetchCreator(handle: string): Promise<ProductClientResult<CreatorApiResponse>> {
  return getJson<CreatorApiResponse>(`/api/v1/creators/${encodeURIComponent(handle)}`);
}

export interface CreatorsDirectoryApiResponse {
  readonly ok: true;
  readonly creators: readonly {
    readonly handle: string;
    readonly displayName: string;
    readonly tags: readonly string[];
    readonly source: string;
    readonly profilePath: string;
  }[];
  readonly total?: number;
  readonly count?: number;
  readonly hasMore?: boolean;
  readonly synthetic?: boolean;
  readonly note?: string;
  /** Echo of normalized fixture filter, or null when unfiltered. */
  readonly q?: string | null;
}

export function fetchCreators(options?: {
  readonly limit?: number;
  readonly offset?: number;
  /** Fixture directory filter (handle / display / tags). */
  readonly q?: string | null;
}): Promise<ProductClientResult<CreatorsDirectoryApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  const query = options?.q?.trim();
  if (query) q.set('q', query);
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<CreatorsDirectoryApiResponse>(`/api/v1/creators${suffix}`);
}

export function fetchToken(): Promise<ProductClientResult<TokenApiResponse>> {
  return getJson<TokenApiResponse>('/api/v1/token');
}

/**
 * GET /api/v1/vanity — honest vanity /.drool registry status.
 * registryLive and claimExecutable are always false; claims list is always empty.
 * Never invents owned names. Callers must not re-fanout fake claims on error.
 */
export interface VanityApiResponse {
  readonly ok: true;
  readonly product?: 'wetdrool';
  readonly path?: '/api/v1/vanity' | string;
  readonly version?: number;
  readonly registryLive: false | boolean;
  readonly claimExecutable: false | boolean;
  readonly settlementLive?: false | boolean;
  readonly monthlyUsd?: number;
  readonly claims: readonly {
    readonly handle: string;
    readonly ownerIdentityId?: string;
    readonly claimedAt?: string;
    readonly source?: string;
  }[];
  readonly claimCount?: number;
  readonly quote?: {
    readonly monthlyUsd: number;
    readonly solEstimate: number | null;
    readonly usdc: number;
    readonly pointsPrice: number;
    readonly perks: readonly string[];
  };
  readonly honest?: {
    readonly registryLive: false | boolean;
    readonly claimExecutable: false | boolean;
    readonly inventsOwnedNames: false | boolean;
    readonly anonymousCandidateIsNotClaim?: true | boolean;
    readonly pointsDoNotClaim?: true | boolean;
  };
  readonly notClaims?: readonly string[];
  readonly note?: string;
}

export function fetchVanity(): Promise<ProductClientResult<VanityApiResponse>> {
  return getJson<VanityApiResponse>('/api/v1/vanity');
}

/** Alias — same honest vanity status surface. */
export function fetchVanityStatus(): Promise<ProductClientResult<VanityApiResponse>> {
  return fetchVanity();
}

export function fetchAgePolicy(
  region?: string | null,
): Promise<ProductClientResult<AgePolicyApiResponse>> {
  const q = new URLSearchParams();
  if (region) q.set('region', region);
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<AgePolicyApiResponse>(`/api/v1/policy/age${suffix}`);
}

export function fetchHealth(): Promise<ProductClientResult<HealthApiResponse>> {
  return getJson<HealthApiResponse>('/api/v1/health');
}

/**
 * GET /api/v1/status — revenue readiness + store/auth honesty.
 * Surfaces include mesh + search links; multiReplicaSafe stays fail-closed.
 */
export interface ProductStatusApiResponse {
  readonly ok: true;
  readonly product?: 'wetdrool';
  readonly service?: string;
  readonly surfaces?: readonly string[];
  readonly surfaceCatalog?: readonly {
    readonly id: string;
    readonly path: string;
    readonly methods: readonly string[];
  }[];
  readonly links?: HealthApiResponse['links'];
  readonly stores?: {
    readonly marketplace: {
      readonly kind: string;
      readonly gate: string;
      readonly durableAcrossRestart: boolean;
      readonly multiReplicaSafe: false;
      readonly listings?: number;
    };
    readonly rooms: {
      readonly kind: string;
      readonly durableAcrossRestart: boolean;
      readonly multiReplicaSafe: boolean;
      readonly maxMessagesPerRoom?: number;
    };
  };
  readonly auth?: {
    readonly configured: boolean;
    readonly loopback: boolean;
    readonly source: string | null;
    readonly origin?: string | null;
    readonly probePath: string;
    readonly protocolIdentityEstablished: false;
  };
  readonly revenueReady?: boolean;
  readonly earningClaimed?: false;
  readonly discovery?: HealthApiResponse['discovery'];
  readonly honest?: HealthApiResponse['honest'] & {
    readonly founderMediaPath?: string | null | boolean;
  };
}

export function fetchProductStatus(): Promise<ProductClientResult<ProductStatusApiResponse>> {
  return getJson<ProductStatusApiResponse>('/api/v1/status');
}

/**
 * GET /api/v1/events?limit=&offset=
 * Honest events calendar: synthetic fixtures only; global calendar unconfigured.
 * Never invents live attendance. Callers must not re-fanout local fixtures on error.
 */
export interface ProductEventDto {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone?: string;
  readonly href: string;
  readonly locationLabel?: string;
  readonly source: 'synthetic-catalog' | string;
  readonly synthetic: true | boolean;
  readonly attendanceClaimed: false | boolean;
  readonly liveAttendance?: null;
  readonly rsvpOpen?: false | boolean;
  readonly ticketsLive?: false | boolean;
  readonly mode?: 'online' | 'hybrid' | 'venue-tbd' | string;
  readonly tags?: readonly string[];
}

export interface EventsApiResponse {
  readonly ok: true;
  readonly product?: 'wetdrool';
  readonly path?: string;
  /** Preferred list field from the product API. */
  readonly items?: readonly ProductEventDto[];
  /** Alias for clients that still read `events`. */
  readonly events?: readonly ProductEventDto[];
  readonly count?: number;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  readonly configured?: false | boolean;
  readonly syntheticOnly?: boolean;
  readonly globalCalendar?: boolean;
  readonly inventsLiveAttendance?: false | boolean;
  readonly attendanceProjection?: false | boolean;
  readonly attendanceClaimed?: false | boolean;
  readonly rsvpLive?: false | boolean;
  readonly ticketsLive?: false | boolean;
  readonly media?: string;
  readonly note?: string;
}

export function fetchEvents(options?: {
  readonly limit?: number;
  readonly offset?: number;
}): Promise<ProductClientResult<EventsApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<EventsApiResponse>(`/api/v1/events${suffix}`);
}

/**
 * GET /api/v1/companions?limit=&offset=&nsfw=
 * Honest AI companions catalog: synthetic fixtures only; mesh companions unconfigured.
 * Never invents chat history or earnings. Callers must not re-fanout local fixtures on error.
 */
export interface CompanionDto {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly tones?: readonly string[];
  readonly nsfw?: boolean;
  readonly hirePointsPerMinute?: number;
  readonly model?: string;
  readonly blurb?: string;
  readonly href: string;
  readonly source: 'synthetic-catalog' | string;
  readonly synthetic?: true | boolean;
  readonly chatLive?: false | boolean;
  readonly chatHistory?: null;
  readonly sessionsClaimed?: false | boolean;
  readonly earningsClaimed?: false | boolean;
  readonly meshCompanion?: false | boolean;
}

export interface CompanionsApiResponse {
  readonly ok: true;
  readonly product?: 'wetdrool';
  readonly path?: string;
  /** Preferred list field from the product API. */
  readonly items?: readonly CompanionDto[];
  /** Alias for clients that still read `companions`. */
  readonly companions?: readonly CompanionDto[];
  readonly count?: number;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  /** Live mesh companions backend is not online. */
  readonly configured?: false | boolean;
  readonly syntheticOnly?: true | boolean;
  /** Legacy alias; prefer syntheticOnly. */
  readonly synthetic?: boolean;
  readonly inventsChatHistory?: false | boolean;
  readonly inventsEarnings?: false | boolean;
  readonly chatLive?: false | boolean;
  readonly meshCompanions?: false | boolean;
  readonly sessionsClaimed?: false | boolean;
  readonly earningsClaimed?: false | boolean;
  readonly media?: string;
  readonly note?: string;
}

export function fetchCompanions(options?: {
  readonly limit?: number;
  readonly offset?: number;
  /** When false, request SFW-only listing (nsfw=0). Default omits filter. */
  readonly nsfw?: boolean;
}): Promise<ProductClientResult<CompanionsApiResponse>> {
  const q = new URLSearchParams();
  if (options?.nsfw === false) q.set('nsfw', '0');
  if (options?.nsfw === true) q.set('nsfw', '1');
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<CompanionsApiResponse>(`/api/v1/companions${suffix}`);
}

/**
 * GET /api/v1/photos?limit=&offset=
 * Honest photo gallery: synthetic abstract fixtures only; never invents licensed stills.
 * Callers must not re-fanout local fixtures on error (including 404).
 */
export type PhotoContentWarningDto = 'abstract-only' | 'adult-artistic' | 'adult-explicit' | string;

export interface ProductPhotoDto {
  readonly id: string;
  readonly title: string;
  readonly creator: string;
  readonly alt?: string;
  readonly tags?: readonly string[];
  readonly nsfw?: boolean;
  readonly contentWarning?: PhotoContentWarningDto;
  /** CSS gradient tones only until media CDN ships — never treat as image URLs. */
  readonly toneA?: string;
  readonly toneB?: string;
  /** Legacy category label if present. */
  readonly category?: string;
  readonly href: string;
  readonly source?: 'synthetic-catalog' | string;
  readonly synthetic?: true | boolean;
  readonly licensedMedia?: false | boolean;
  readonly mediaSrc?: null | string;
  readonly uploadLive?: false | boolean;
}

export interface PhotosApiResponse {
  readonly ok: true;
  readonly product?: 'wetdrool';
  readonly path?: string;
  /** Preferred list field from the product API. */
  readonly items?: readonly ProductPhotoDto[];
  /** Alias for clients that still read `photos`. */
  readonly photos?: readonly ProductPhotoDto[];
  readonly count?: number;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  readonly empty?: boolean;
  readonly emptyMessage?: string | null;
  readonly configured?: false | boolean;
  readonly syntheticOnly?: true | boolean;
  readonly synthetic?: boolean;
  readonly licensedMedia?: false | boolean;
  readonly inventsPerformerMedia?: false | boolean;
  readonly mediaPipelineLive?: false | boolean;
  readonly uploadLive?: false | boolean;
  readonly media?: string;
  readonly note?: string;
}

export function fetchPhotos(options?: {
  readonly limit?: number;
  readonly offset?: number;
}): Promise<ProductClientResult<PhotosApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<PhotosApiResponse>(`/api/v1/photos${suffix}`);
}

/**
 * GET /api/v1/stories?limit=&offset=
 * Honest stories rail: synthetic ephemeral fixtures only.
 * Never invents view counts or network-wide deletion. No local re-fanout on error.
 */
export interface ProductStoryDto {
  readonly id: string;
  readonly ownerHandle: string;
  readonly title: string;
  readonly expiresAt: string;
  readonly href: string;
  readonly source?: 'synthetic-catalog' | string;
  readonly synthetic?: true | boolean;
  readonly viewCountClaimed?: false | boolean;
  readonly deletionGuaranteed?: false | boolean;
}

export interface StoriesApiResponse {
  readonly ok: true;
  readonly product?: 'wetdrool';
  readonly path?: string;
  /** Preferred list field from the product API. */
  readonly stories?: readonly ProductStoryDto[];
  /** Alias for lag if the route returns `items`. */
  readonly items?: readonly ProductStoryDto[];
  readonly count?: number;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  readonly empty?: boolean;
  readonly emptyMessage?: string | null;
  readonly configured?: false | boolean;
  readonly syntheticOnly?: true | boolean;
  readonly synthetic?: boolean;
  readonly viewCountsInvented?: false | boolean;
  readonly globalDeletionClaimed?: false | boolean;
  readonly note?: string;
}

export function fetchStories(options?: {
  readonly limit?: number;
  readonly offset?: number;
}): Promise<ProductClientResult<StoriesApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<StoriesApiResponse>(`/api/v1/stories${suffix}`);
}

/** Alias for fetchProductStatus — product readiness client panel. */
export function fetchStatus(): Promise<ProductClientResult<ProductStatusApiResponse>> {
  return fetchProductStatus();
}

export function fetchFameBoard(options?: {
  readonly limit?: number;
  readonly offset?: number;
  readonly q?: string | null;
}): Promise<ProductClientResult<FameApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  const query = options?.q?.trim();
  if (query) q.set('q', query);
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<FameApiResponse>(`/api/v1/fame${suffix}`);
}

export interface AuthStatusApiResponse {
  readonly ok: true;
  readonly product: 'wetdrool';
  readonly checkedAt: string;
  readonly configured: boolean;
  readonly reachability: 'unconfigured' | 'invalid_origin' | 'unreachable' | 'degraded' | 'ready';
  readonly origin: string | null;
  readonly source?: string | null;
  readonly loopback?: boolean;
  readonly healthz: boolean | null;
  readonly readyz: boolean | null;
  readonly note: string;
  readonly protocolIdentityEstablished: false;
  readonly webAuthnOrigin?: 'wetdrool.com' | 'local-dev' | 'unknown';
  readonly nextStep?: 'configure_url' | 'start_auth_service' | 'wait_ready' | 'ready' | 'none';
  readonly nextStepLabel?: string;
}

/** Honest auth-service probe — never invents online/product-live status. */
export function fetchAuthStatus(): Promise<ProductClientResult<AuthStatusApiResponse>> {
  return getJson<AuthStatusApiResponse>('/api/v1/auth/status');
}

/** Catalog sort — matches server parseMarketSortMode (default newest). */
export type MarketSortMode = 'newest' | 'price_asc' | 'price_desc';

export interface MarketListingDto {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly seller: string;
  readonly payTo: string;
  readonly lamports: string;
  readonly network: string;
  readonly contentType: string;
  readonly contentHash?: string;
  readonly createdAt: string;
  readonly e2ee?: boolean;
  readonly x402?: boolean;
}

/** Honest unlock receipt from market GET after payment proof (not multi-replica settlement). */
export interface MarketUnlockReceiptDto {
  readonly listingId: string;
  readonly signature: string;
  readonly network: string;
  readonly payTo: string;
  readonly lamports: string;
  readonly verifiedAt: string;
  readonly verification: 'rpc_verified' | 'prior_purchase' | 'dev_accept';
  readonly slot?: number;
  readonly payer?: string;
  readonly settlementAuthoritative: false;
  readonly note: string;
}

export interface MarketApiResponse {
  readonly ok: true;
  readonly listings: readonly MarketListingDto[];
  readonly count?: number;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  readonly nextOffset?: number | null;
  readonly q?: string | null;
  /** Active x402 network filter when set (solana:devnet | solana:mainnet). */
  readonly network?: string | null;
  /** Catalog order: newest (default) | price_asc | price_desc. */
  readonly sort?: MarketSortMode;
  readonly sortLabel?: string;
  readonly filter?: {
    readonly q: string | null;
    readonly network?: string | null;
    readonly sort?: MarketSortMode;
    readonly applied: boolean;
    readonly matched?: number;
    readonly note?: string;
  };
  readonly store?: {
    readonly kind: 'memory-ephemeral' | 'file-local';
    readonly durableAcrossRestart: boolean;
    /** Always false — memory/file market stores are single-node only. */
    readonly multiReplicaSafe: false;
    /** Always false until durable multi-replica proof exists. */
    readonly revenueReady: false;
    readonly gate: 'env-stable' | 'ephemeral';
    /** Short UI badge label (includes replica-unsafe). */
    readonly label: string;
    readonly note: string;
  };
  readonly paymentVerify?: {
    readonly rpcConfigured: boolean;
    readonly network: string;
    readonly note?: string;
  };
  readonly note?: string;
}

export function fetchMarket(options?: {
  readonly limit?: number;
  readonly offset?: number;
  readonly q?: string | null;
  /** Exact x402 network id or cluster alias (devnet / mainnet). */
  readonly network?: string | null;
  /** newest (default) | price_asc | price_desc — lamports always on listings. */
  readonly sort?: MarketSortMode | null;
}): Promise<ProductClientResult<MarketApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  if (options?.q) q.set('q', options.q);
  if (options?.network) q.set('network', options.network);
  if (options?.sort) q.set('sort', options.sort);
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<MarketApiResponse>(`/api/v1/market${suffix}`);
}

/** Client-visible unlock attempt (no secrets, no full signatures beyond short ref). */
export type MarketUnlockAttemptStatus = 'success' | 'fail';

export interface MarketUnlockAttempt {
  readonly id: string;
  /** ISO-8601 timestamp */
  readonly at: string;
  readonly listingId: string;
  readonly status: MarketUnlockAttemptStatus;
  /** Machine reason on fail (e.g. no_rpc) — never secrets or plaintext content. */
  readonly reason?: string;
  readonly verification?: MarketUnlockReceiptDto['verification'];
  /** Short signature prefix for correlation only (not full settlement proof). */
  readonly signatureHint?: string;
}

export const MARKET_UNLOCK_ATTEMPT_STORAGE_KEY = 'wetdrool.market.unlockAttempts.v1';
export const MARKET_UNLOCK_ATTEMPT_MAX = 40;

function makeAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Pure: parse stored JSON into a sanitized attempt list (newest first). */
export function parseUnlockAttemptLog(raw: string | null | undefined): MarketUnlockAttempt[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: MarketUnlockAttempt[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (typeof o.listingId !== 'string' || !o.listingId) continue;
      if (o.status !== 'success' && o.status !== 'fail') continue;
      if (typeof o.at !== 'string' || !o.at) continue;
      const entry: MarketUnlockAttempt = {
        id: typeof o.id === 'string' && o.id ? o.id : makeAttemptId(),
        at: o.at,
        listingId: o.listingId.slice(0, 64),
        status: o.status,
        ...(typeof o.reason === 'string' && o.reason ? { reason: o.reason.slice(0, 80) } : {}),
        ...(o.verification === 'rpc_verified' ||
        o.verification === 'prior_purchase' ||
        o.verification === 'dev_accept'
          ? { verification: o.verification }
          : {}),
        ...(typeof o.signatureHint === 'string' && o.signatureHint
          ? { signatureHint: o.signatureHint.slice(0, 16) }
          : {}),
      };
      out.push(entry);
      if (out.length >= MARKET_UNLOCK_ATTEMPT_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Pure: prepend attempt and cap length (newest first). */
export function appendUnlockAttempt(
  log: readonly MarketUnlockAttempt[],
  attempt: Omit<MarketUnlockAttempt, 'id' | 'at'> & {
    readonly id?: string;
    readonly at?: string;
  },
): MarketUnlockAttempt[] {
  const entry: MarketUnlockAttempt = {
    id: attempt.id ?? makeAttemptId(),
    at: attempt.at ?? new Date().toISOString(),
    listingId: attempt.listingId.slice(0, 64),
    status: attempt.status,
    ...(attempt.reason ? { reason: attempt.reason.slice(0, 80) } : {}),
    ...(attempt.verification ? { verification: attempt.verification } : {}),
    ...(attempt.signatureHint ? { signatureHint: attempt.signatureHint.slice(0, 16) } : {}),
  };
  return [entry, ...log].slice(0, MARKET_UNLOCK_ATTEMPT_MAX);
}

export function filterUnlockAttemptsForListing(
  log: readonly MarketUnlockAttempt[],
  listingId: string | null | undefined,
): MarketUnlockAttempt[] {
  if (!listingId) return [...log];
  return log.filter((a) => a.listingId === listingId);
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    try {
      return (globalThis as unknown as { localStorage: Storage }).localStorage;
    } catch {
      return null;
    }
  }
  return null;
}

/** Read browser (or injected) storage — empty on SSR / unavailable. */
export function readUnlockAttemptLog(storage?: Storage | null): MarketUnlockAttempt[] {
  const s = resolveStorage(storage);
  if (!s) return [];
  try {
    return parseUnlockAttemptLog(s.getItem(MARKET_UNLOCK_ATTEMPT_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeUnlockAttemptLog(
  log: readonly MarketUnlockAttempt[],
  storage?: Storage | null,
): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(
      MARKET_UNLOCK_ATTEMPT_STORAGE_KEY,
      JSON.stringify(log.slice(0, MARKET_UNLOCK_ATTEMPT_MAX)),
    );
  } catch {
    // Quota / private mode — fail soft; UI still has in-memory state.
  }
}

/** Record one attempt and persist (no secrets). Returns updated log newest-first. */
export function recordUnlockAttempt(
  attempt: Omit<MarketUnlockAttempt, 'id' | 'at'> & {
    readonly id?: string;
    readonly at?: string;
  },
  storage?: Storage | null,
): MarketUnlockAttempt[] {
  const next = appendUnlockAttempt(readUnlockAttemptLog(storage), attempt);
  writeUnlockAttemptLog(next, storage);
  return next;
}

/** Clear local unlock attempt history (browser storage). Returns empty log. */
export function clearUnlockAttemptLog(storage?: Storage | null): MarketUnlockAttempt[] {
  const s = resolveStorage(storage);
  if (s) {
    try {
      s.removeItem(MARKET_UNLOCK_ATTEMPT_STORAGE_KEY);
    } catch {
      // Private mode / blocked storage — still return empty for UI.
    }
  }
  return [];
}

/**
 * Pure: serialize sanitized attempt log for client download (no secrets).
 * Re-parses through parseUnlockAttemptLog so export never reintroduces fields.
 */
export function exportUnlockAttemptsJson(log: readonly MarketUnlockAttempt[]): string {
  const sanitized = parseUnlockAttemptLog(JSON.stringify(log));
  return `${JSON.stringify(sanitized, null, 2)}\n`;
}

export function signatureHintFromTx(signature: string): string {
  const t = signature.trim();
  if (t.length <= 12) return t;
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

export interface RoomMessagesApiResponse {
  readonly ok: true;
  readonly roomId: string;
  readonly messages: readonly SealedEnvelope[];
  readonly count?: number;
  readonly total?: number;
  /** @deprecated Prefer hasMoreOlder / hasMoreNewer. */
  readonly hasMore?: boolean;
  readonly hasMoreOlder?: boolean;
  readonly hasMoreNewer?: boolean;
  readonly store?: {
    readonly kind: string;
    readonly multiReplicaSafe?: boolean;
    readonly durableAcrossRestart?: boolean;
    readonly maxMessagesPerRoom?: number;
    readonly label?: string;
    readonly note?: string;
  };
  readonly note?: string;
}

export function fetchRoomMessages(
  roomId: string,
  options?: {
    readonly limit?: number;
    /** Exclusive cursor: messages after this id (newer / poll). */
    readonly after?: string;
    /** Exclusive cursor: messages before this id (older / history). */
    readonly before?: string;
  },
): Promise<ProductClientResult<RoomMessagesApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.after) q.set('after', options.after);
  if (options?.before) q.set('before', options.before);
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<RoomMessagesApiResponse>(
    `/api/v1/rooms/${encodeURIComponent(roomId)}/messages${suffix}`,
  );
}

export interface RoomsIndexApiResponse {
  readonly ok: true;
  readonly count: number;
  readonly rooms: readonly {
    readonly roomId: string;
    readonly messageCount: number;
    readonly lastActivityAt?: string | null;
  }[];
  readonly store?: {
    readonly kind: string;
    readonly multiReplicaSafe?: boolean;
    readonly durableAcrossRestart?: boolean;
    readonly maxMessagesPerRoom?: number;
    readonly label?: string;
    readonly note?: string;
  };
  readonly note?: string;
}

export function fetchRoomsIndex(): Promise<ProductClientResult<RoomsIndexApiResponse>> {
  return getJson<RoomsIndexApiResponse>('/api/v1/rooms');
}

export interface E2eeApiResponse {
  readonly ok: true;
  readonly e2ee: {
    readonly protocol: string;
    readonly pairwise: string;
    readonly groupRooms: string;
    readonly passphraseRooms: string;
    readonly roomSealProtocol: string;
    readonly serverReadableFallback: false;
    readonly privateByDefault: true;
    readonly details: readonly string[];
  };
  readonly rooms: {
    readonly store: {
      readonly kind: string;
      readonly multiReplicaSafe?: boolean;
      readonly durableAcrossRestart?: boolean;
      readonly maxMessagesPerRoom?: number;
      readonly label?: string;
      readonly note?: string;
    };
    readonly messagesPath: string;
    readonly ciphertextOnly: boolean;
    readonly hostReadsPlaintext: boolean;
    readonly durability: string;
    readonly maxMessagesPerRoom?: number;
  };
  readonly note?: string;
}

/** GET /api/v1/e2ee — seal protocol + room store honesty (no secrets). */
export function fetchE2eeStatus(): Promise<ProductClientResult<E2eeApiResponse>> {
  return getJson<E2eeApiResponse>('/api/v1/e2ee');
}

/** In-app notification row — only fields a product API may return (never invent client-side). */
export interface NotificationItemDto {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly body?: string;
  readonly createdAt?: string;
  readonly read?: boolean;
  readonly href?: string;
  readonly actorHandle?: string;
}

/**
 * GET /api/v1/notifications — honest empty inbox until auth + relay + preferences wire.
 * Never invents social-graph rows; configured is always false today.
 */
export interface NotificationsApiResponse {
  readonly ok: true;
  readonly items: readonly NotificationItemDto[];
  readonly count?: number;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  readonly filter?: 'mentions' | 'communities' | 'system' | null;
  readonly configured: boolean;
  readonly delivery?: 'none' | string;
  readonly unread?: number;
  readonly unreadCount?: number;
  readonly protocolHistoryReconstructable?: boolean;
  readonly inventedSignals?: boolean;
  readonly pushLive?: boolean;
  readonly inAppLive?: boolean;
  readonly note?: string;
}

export function fetchNotifications(options?: {
  readonly filter?: 'mentions' | 'communities' | 'system' | 'all' | null;
  readonly limit?: number;
  readonly offset?: number;
}): Promise<ProductClientResult<NotificationsApiResponse>> {
  const q = new URLSearchParams();
  const filter = options?.filter?.trim().toLowerCase();
  if (filter && filter !== 'all') q.set('filter', filter);
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<NotificationsApiResponse>(`/api/v1/notifications${suffix}`);
}

export interface ProductSearchHitDto {
  readonly id: string;
  readonly kind: 'short' | 'creator' | 'live' | 'fame' | string;
  readonly title: string;
  readonly subtitle?: string;
  readonly href: string;
  readonly source: 'synthetic-catalog' | string;
  readonly tags?: readonly string[];
  readonly synthetic?: boolean;
}

/**
 * GET /api/v1/search?q= — honest product search.
 * configured is always false (no global index). Optional hits are synthetic-catalog only.
 */
export interface SearchApiResponse {
  readonly ok: true;
  readonly q: string | null;
  readonly results: readonly ProductSearchHitDto[];
  readonly count?: number;
  readonly total?: number;
  readonly limit?: number;
  readonly configured: boolean;
  readonly globalIndex?: false | boolean;
  readonly syntheticOnly?: boolean;
  readonly note?: string;
}

/** Alias used by some call sites. */
export type ProductSearchApiResponse = SearchApiResponse;

export function fetchSearch(options?: {
  readonly q?: string | null;
  readonly limit?: number;
}): Promise<ProductClientResult<SearchApiResponse>> {
  const params = new URLSearchParams();
  const q = options?.q?.trim();
  if (q) params.set('q', q.slice(0, 64));
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  const suffix = params.size > 0 ? `?${params}` : '';
  return getJson<SearchApiResponse>(`/api/v1/search${suffix}`);
}

export function fetchProductSearch(options?: {
  readonly q?: string | null;
  readonly limit?: number;
}): Promise<ProductClientResult<SearchApiResponse>> {
  return fetchSearch(options);
}

/**
 * GET /api/v1/mesh — honest mesh/relay readiness (configuration only).
 * Never invents live mesh peers; multiReplicaSafe is always false.
 */
export interface MeshStatusApiResponse {
  readonly ok: true;
  readonly product?: 'wetdrool';
  readonly service?: string;
  readonly path?: string;
  readonly mesh: {
    readonly foundation: string;
    readonly productionMeshDeployed: false;
    readonly localFirst?: boolean;
    readonly e2eeSpaces?: boolean;
    readonly transports?: readonly string[];
    readonly notes?: readonly string[];
  };
  readonly relay: {
    readonly configured: boolean;
    readonly displayEndpoints: readonly string[];
    readonly configuredCount?: number;
    readonly invalidCount?: number;
    readonly multiReplicaSafe: false;
    readonly liveMeshPeersClaimed: false;
    readonly livePeerCount: null;
    readonly productionMeshDeployed?: false;
    readonly note?: string;
  };
  readonly honest?: {
    readonly configured: boolean;
    readonly multiReplicaSafe: false;
    readonly liveMeshPeersClaimed: false;
    readonly livePeerCount: null;
    readonly productionMeshDeployed: false;
    readonly inventsLivePeers: false;
  };
  readonly note?: string;
}

export function fetchMeshStatus(): Promise<ProductClientResult<MeshStatusApiResponse>> {
  return getJson<MeshStatusApiResponse>('/api/v1/mesh');
}

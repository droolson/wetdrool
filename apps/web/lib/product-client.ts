/**
 * Browser client for /api/v1 product endpoints.
 */

import type { DiscoveryMode, RankedShort } from './short-feed';
import type { DroolTokenConfig } from './drool-token';
import type { CreatorStudioProfile } from './creator-economy';
import type { LiveRoom } from './live-catalog';
import type { FameEntry } from './hall-of-fame';
import { readProductApiErrorMessage } from './product-api';

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
    readonly note?: string;
    readonly weights?: unknown;
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
  readonly join?: string;
  readonly synthetic?: boolean;
  readonly note?: string;
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
  readonly policy: import('./age-access-policy').AgeAccessDecision;
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
    readonly creatorsDirectory?: string;
    readonly agePolicy?: string;
    readonly token?: string;
    readonly e2ee?: string;
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
  readonly seedOnly?: boolean;
  readonly globalLedger?: false;
}

export function fetchShorts(
  mode: DiscoveryMode,
  limit = 24,
  options?: { readonly category?: string | null; readonly offset?: number },
): Promise<ProductClientResult<ShortsApiResponse>> {
  const q = new URLSearchParams({ mode, limit: String(limit) });
  if (options?.category) q.set('category', options.category);
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  return getJson<ShortsApiResponse>(`/api/v1/shorts?${q}`);
}

export function fetchLiveRooms(options?: {
  readonly nsfw?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}): Promise<ProductClientResult<LiveApiResponse>> {
  const q = new URLSearchParams();
  if (options?.nsfw === false) q.set('nsfw', '0');
  if (options?.nsfw === true) q.set('nsfw', '1');
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<LiveApiResponse>(`/api/v1/live${suffix}`);
}

export function fetchCreator(
  handle: string,
): Promise<ProductClientResult<CreatorApiResponse>> {
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
}

export function fetchCreators(options?: {
  readonly limit?: number;
  readonly offset?: number;
}): Promise<ProductClientResult<CreatorsDirectoryApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<CreatorsDirectoryApiResponse>(`/api/v1/creators${suffix}`);
}

export function fetchToken(): Promise<ProductClientResult<TokenApiResponse>> {
  return getJson<TokenApiResponse>('/api/v1/token');
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

export function fetchFameBoard(options?: {
  readonly limit?: number;
  readonly offset?: number;
}): Promise<ProductClientResult<FameApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
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
}

/** Honest auth-service probe — never invents online/product-live status. */
export function fetchAuthStatus(): Promise<ProductClientResult<AuthStatusApiResponse>> {
  return getJson<AuthStatusApiResponse>('/api/v1/auth/status');
}

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
  readonly filter?: {
    readonly q: string | null;
    readonly applied: boolean;
    readonly matched?: number;
    readonly note?: string;
  };
  readonly store?: {
    readonly kind: 'memory-ephemeral' | 'file-local';
    readonly durableAcrossRestart?: boolean;
    readonly multiReplicaSafe?: boolean;
    /** Always false until durable multi-replica proof exists. */
    readonly revenueReady?: false;
    readonly gate?: 'env-stable' | 'ephemeral';
    readonly note?: string;
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
}): Promise<ProductClientResult<MarketApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
  if (options?.q) q.set('q', options.q);
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<MarketApiResponse>(`/api/v1/market${suffix}`);
}

export interface RoomMessagesApiResponse {
  readonly ok: true;
  readonly roomId: string;
  readonly messages: readonly import('./e2ee-seal').SealedEnvelope[];
  readonly count?: number;
  readonly total?: number;
  readonly hasMore?: boolean;
  readonly store?: {
    readonly kind: string;
    readonly multiReplicaSafe?: boolean;
    readonly durableAcrossRestart?: boolean;
    readonly note?: string;
  };
  readonly note?: string;
}

export function fetchRoomMessages(
  roomId: string,
  options?: { readonly limit?: number; readonly after?: string },
): Promise<ProductClientResult<RoomMessagesApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.after) q.set('after', options.after);
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<RoomMessagesApiResponse>(
    `/api/v1/rooms/${encodeURIComponent(roomId)}/messages${suffix}`,
  );
}

export interface RoomsIndexApiResponse {
  readonly ok: true;
  readonly count: number;
  readonly rooms: readonly { readonly roomId: string; readonly messageCount: number }[];
  readonly store?: {
    readonly kind: string;
    readonly multiReplicaSafe?: boolean;
    readonly durableAcrossRestart?: boolean;
    readonly note?: string;
  };
  readonly note?: string;
}

export function fetchRoomsIndex(): Promise<ProductClientResult<RoomsIndexApiResponse>> {
  return getJson<RoomsIndexApiResponse>('/api/v1/rooms');
}

/**
 * Browser client for /api/v1 product endpoints.
 */

import type { DiscoveryMode, RankedShort } from './short-feed';
import type { DroolTokenConfig } from './drool-token';
import type { CreatorStudioProfile } from './creator-economy';
import type { LiveRoom } from './live-catalog';
import type { FameEntry } from './hall-of-fame';

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
      const msg =
        body &&
        typeof body === 'object' &&
        'error' in body &&
        body.error &&
        typeof body.error === 'object' &&
        'message' in body.error &&
        typeof (body.error as { message: unknown }).message === 'string'
          ? (body.error as { message: string }).message
          : `Request failed (${res.status})`;
      return { kind: 'error', status: res.status, message: msg };
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
  /** True only when every item is a synthetic fixture. */
  readonly synthetic: boolean;
  readonly category?: string | null;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  readonly syntheticCount?: number;
  readonly licensedCount?: number;
  readonly categories?: readonly string[];
  readonly ranking?: {
    readonly name: string;
    readonly note?: string;
  };
  readonly note?: string;
}

export type LiveRoomDto = LiveRoom;

export interface LiveApiResponse {
  readonly ok: true;
  readonly rooms: readonly LiveRoomDto[];
  readonly count?: number;
  readonly join?: string;
  readonly synthetic?: boolean;
  readonly note?: string;
}

export interface CreatorApiResponse {
  readonly ok: true;
  readonly profile: CreatorStudioProfile;
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
  readonly surfaces: readonly string[];
}

export interface FameBoardRow extends FameEntry {
  readonly rank: number;
  readonly tier: string;
}

export interface FameApiResponse {
  readonly ok: true;
  readonly board: readonly FameBoardRow[];
  readonly note?: string;
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
}): Promise<ProductClientResult<LiveApiResponse>> {
  const q = new URLSearchParams();
  if (options?.nsfw === false) q.set('nsfw', '0');
  if (options?.nsfw === true) q.set('nsfw', '1');
  const suffix = q.size > 0 ? `?${q}` : '';
  return getJson<LiveApiResponse>(`/api/v1/live${suffix}`);
}

export function fetchCreator(
  handle: string,
): Promise<ProductClientResult<CreatorApiResponse>> {
  return getJson<CreatorApiResponse>(`/api/v1/creators/${encodeURIComponent(handle)}`);
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

export function fetchFameBoard(): Promise<ProductClientResult<FameApiResponse>> {
  return getJson<FameApiResponse>('/api/v1/fame');
}

export interface AuthStatusApiResponse {
  readonly ok: true;
  readonly reachability: 'unconfigured' | 'invalid_origin' | 'unreachable' | 'degraded' | 'ready';
  readonly origin: string | null;
  readonly healthz: boolean | null;
  readonly readyz: boolean | null;
  readonly note: string;
  readonly protocolIdentityEstablished: false;
}

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

export interface MarketApiResponse {
  readonly ok: true;
  readonly listings: readonly MarketListingDto[];
  readonly count?: number;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  readonly store?: {
    readonly kind: 'memory-ephemeral' | 'file-local';
    readonly durableAcrossRestart?: boolean;
    readonly multiReplicaSafe?: boolean;
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
}): Promise<ProductClientResult<MarketApiResponse>> {
  const q = new URLSearchParams();
  if (options?.limit !== undefined) q.set('limit', String(options.limit));
  if (options?.offset !== undefined) q.set('offset', String(options.offset));
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

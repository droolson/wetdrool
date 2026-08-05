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
): Promise<ProductClientResult<ShortsApiResponse>> {
  const q = new URLSearchParams({ mode, limit: String(limit) });
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

export function fetchHealth(): Promise<ProductClientResult<HealthApiResponse>> {
  return getJson<HealthApiResponse>('/api/v1/health');
}

export function fetchFameBoard(): Promise<ProductClientResult<FameApiResponse>> {
  return getJson<FameApiResponse>('/api/v1/fame');
}

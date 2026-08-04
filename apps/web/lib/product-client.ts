/**
 * Browser client for /api/v1 product endpoints.
 */

import type { DiscoveryMode, RankedShort } from './short-feed';
import type { DroolTokenConfig } from './drool-token';
import type { CreatorStudioProfile } from './creator-economy';

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
  readonly synthetic: true;
}

export interface LiveRoomDto {
  readonly id: string;
  readonly title: string;
  readonly host: string;
  readonly nsfw: boolean;
  readonly tags: readonly string[];
  readonly viewersHint: string;
  readonly status: 'staged';
}

export interface LiveApiResponse {
  readonly ok: true;
  readonly rooms: readonly LiveRoomDto[];
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

export function fetchShorts(
  mode: DiscoveryMode,
  limit = 24,
): Promise<ProductClientResult<ShortsApiResponse>> {
  const q = new URLSearchParams({ mode, limit: String(limit) });
  return getJson<ShortsApiResponse>(`/api/v1/shorts?${q}`);
}

export function fetchLiveRooms(): Promise<ProductClientResult<LiveApiResponse>> {
  return getJson<LiveApiResponse>('/api/v1/live');
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

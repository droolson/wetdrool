import type { AuthStore, CleanupExpiredResult } from './store.js';

export interface AuthRetentionPolicy {
  readonly pendingAccountRetentionMs: number;
  readonly ceremonyRetentionMs: number;
  readonly sessionRetentionMs: number;
  readonly batchSize: number;
}

export function cleanupExpiredAuthRecords(
  store: AuthStore,
  policy: AuthRetentionPolicy,
  now = new Date(),
): Promise<CleanupExpiredResult> {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError('Authentication cleanup time is invalid.');
  return store.cleanupExpired({
    now: now.toISOString(),
    pendingAccountCreatedBefore: cutoff(nowMs, policy.pendingAccountRetentionMs),
    ceremonyInactiveBefore: cutoff(nowMs, policy.ceremonyRetentionMs),
    sessionInactiveBefore: cutoff(nowMs, policy.sessionRetentionMs),
    batchSize: policy.batchSize,
  });
}

function cutoff(nowMs: number, retentionMs: number): string {
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 0 || retentionMs > nowMs) {
    throw new TypeError('Authentication retention duration is invalid.');
  }
  return new Date(nowMs - retentionMs).toISOString();
}

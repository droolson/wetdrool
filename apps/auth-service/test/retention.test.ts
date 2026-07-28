import { describe, expect, it } from 'vitest';

import {
  cleanupExpiredAuthRecords,
  MemoryAuthStore,
  type AccountRecord,
  type CeremonyRecord,
  type SessionRecord,
  type StoredKeyBundle,
} from '../src/index.js';
import { credentialId, wrappedKeyBundle } from './fixtures.js';

const now = new Date('2026-07-28T20:00:00.000Z');

describe('authentication record retention', () => {
  it('removes only stale bounded state and preserves active accounts and recent records', async () => {
    const store = new MemoryAuthStore();
    const abandoned = account('A', '2026-07-28T17:00:00.000Z');
    const recentPending = account('B', '2026-07-28T19:30:00.000Z');
    const active = account('C', '2026-07-28T17:00:00.000Z');
    await store.createProvisionalAccount(
      abandoned,
      ceremony('A', abandoned.accountId, '2026-07-28T17:05:00.000Z'),
    );
    await store.createProvisionalAccount(
      recentPending,
      ceremony('B', recentPending.accountId, '2026-07-28T19:35:00.000Z'),
    );
    await store.createProvisionalAccount(
      active,
      ceremony('C', active.accountId, '2026-07-28T17:05:00.000Z'),
    );
    const activeCredentialId = credentialId(70);
    const activatedAt = '2026-07-28T17:01:00.000Z';
    await store.finalizeFirstCredential(
      active.accountId,
      {
        credentialId: activeCredentialId,
        accountId: active.accountId,
        publicKey: Uint8Array.of(1),
        counter: 0,
        transports: ['internal'],
        deviceType: 'multiDevice',
        backedUp: false,
        createdAt: activatedAt,
      },
      await storedRootBundle(active.accountId, activeCredentialId, activatedAt),
      activatedAt,
    );
    await store.putCeremony(ceremony('D', undefined, '2026-07-28T18:00:00.000Z'));
    await store.putCeremony(ceremony('E', undefined, '2026-07-28T19:30:00.000Z'));
    await store.putSession(session('A', active.accountId, '2026-07-28T18:30:00.000Z'));
    await store.putSession(
      session('B', active.accountId, '2026-07-28T21:00:00.000Z', '2026-07-28T18:30:00.000Z'),
    );
    await store.putSession(session('C', active.accountId, '2026-07-28T19:30:00.000Z'));
    await store.putSession(session('D', active.accountId, '2026-07-28T21:00:00.000Z'));

    await expect(
      cleanupExpiredAuthRecords(
        store,
        {
          pendingAccountRetentionMs: 60 * 60_000,
          ceremonyRetentionMs: 60 * 60_000,
          sessionRetentionMs: 60 * 60_000,
          batchSize: 10,
        },
        now,
      ),
    ).resolves.toEqual({
      pendingAccountsDeleted: 1,
      ceremoniesDeleted: 2,
      sessionsDeleted: 2,
    });

    await expect(store.getAccount(abandoned.accountId)).resolves.toBeUndefined();
    await expect(store.getAccount(recentPending.accountId)).resolves.toMatchObject({
      status: 'pending',
    });
    await expect(store.getAccount(active.accountId)).resolves.toMatchObject({
      status: 'active',
    });
    await expect(store.getSession(sessionId('A'))).resolves.toBeUndefined();
    await expect(store.getSession(sessionId('B'))).resolves.toBeUndefined();
    await expect(store.getSession(sessionId('C'))).resolves.toBeDefined();
    await expect(store.getSession(sessionId('D'))).resolves.toBeDefined();
  });

  it('rejects future cutoffs, invalid durations, and unbounded batches', async () => {
    const store = new MemoryAuthStore();
    await expect(
      store.cleanupExpired({
        now: now.toISOString(),
        pendingAccountCreatedBefore: '2026-07-28T21:00:00.000Z',
        ceremonyInactiveBefore: now.toISOString(),
        sessionInactiveBefore: now.toISOString(),
        batchSize: 1,
      }),
    ).rejects.toThrow('Invalid authentication-retention cleanup bounds');
    expect(() =>
      cleanupExpiredAuthRecords(
        store,
        {
          pendingAccountRetentionMs: -1,
          ceremonyRetentionMs: 0,
          sessionRetentionMs: 0,
          batchSize: 1,
        },
        now,
      ),
    ).toThrow('Authentication retention duration is invalid');
    await expect(
      store.cleanupExpired({
        now: now.toISOString(),
        pendingAccountCreatedBefore: now.toISOString(),
        ceremonyInactiveBefore: now.toISOString(),
        sessionInactiveBefore: now.toISOString(),
        batchSize: 5_001,
      }),
    ).rejects.toThrow('Invalid authentication-retention cleanup bounds');
  });
});

function account(seed: string, createdAt: string): AccountRecord {
  return {
    accountId: `acct_${seed.repeat(22)}`,
    webauthnUserHandle: Uint8Array.from({ length: 32 }, () => seed.charCodeAt(0)),
    status: 'pending',
    createdAt,
  };
}

function ceremony(seed: string, accountId: string | undefined, expiresAt: string): CeremonyRecord {
  return {
    ceremonyId: `cer_${seed.repeat(22)}`,
    purpose: accountId === undefined ? 'authenticate' : 'register-account',
    ...(accountId === undefined ? {} : { accountId }),
    challengeHash: Uint8Array.from({ length: 32 }, () => seed.charCodeAt(0)),
    expiresAt,
    attempts: 0,
    maxAttempts: 1,
    createdAt: new Date(Date.parse(expiresAt) - 5 * 60_000).toISOString(),
  };
}

function session(
  seed: string,
  accountId: string,
  expiresAt: string,
  revokedAt?: string,
): SessionRecord {
  return {
    sessionId: sessionId(seed),
    accountId,
    secretHash: Uint8Array.from({ length: 32 }, () => seed.charCodeAt(0)),
    csrfHash: Uint8Array.from({ length: 32 }, () => seed.charCodeAt(0) + 1),
    createdAt: '2026-07-28T17:00:00.000Z',
    expiresAt,
    lastAuthenticatedAt: '2026-07-28T17:00:00.000Z',
    ...(revokedAt === undefined ? {} : { revokedAt }),
  };
}

function sessionId(seed: string): string {
  return `ses_${seed.repeat(22)}`;
}

async function storedRootBundle(
  accountId: string,
  credentialIdValue: string,
  updatedAt: string,
): Promise<StoredKeyBundle> {
  const bundle = await wrappedKeyBundle(credentialIdValue);
  return {
    accountId,
    credentialId: credentialIdValue,
    keyKind: bundle.keyKind,
    publicKey: bundle.publicKey,
    bundle,
    updatedAt,
  };
}

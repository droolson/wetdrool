import { randomBytes } from 'node:crypto';

import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  AuthService,
  cleanupExpiredAuthRecords,
  migrateAuth,
  PostgresAuthStore,
  type AccountRecord,
  type CeremonyRecord,
  type SessionRecord,
  type StoredKeyBundle,
} from '../src/index.js';
import {
  authenticationResponse,
  credentialId,
  FakeCeremonyVerifier,
  registrationResponse,
  wrappedKeyBundle,
} from './fixtures.js';

const databaseUrl =
  process.env['AUTH_INTEGRATION_DATABASE_URL'] ??
  process.env['AUTH_DATABASE_URL'] ??
  'postgresql://wokesocial_auth_runtime:local-auth-runtime-only@127.0.0.1:5432/wokesocial';
const migrationDatabaseUrl =
  process.env['AUTH_INTEGRATION_DATABASE_MIGRATION_URL'] ??
  process.env['AUTH_DATABASE_MIGRATION_URL'] ??
  'postgresql://wokesocial_auth_migration:local-auth-migration-only@127.0.0.1:5432/wokesocial';

describe('PostgreSQL authentication integration', () => {
  it('persists atomic ceremonies, credentials, sessions, and ciphertext lifecycle', async () => {
    await Promise.all([migrateAuth(migrationDatabaseUrl), migrateAuth(migrationDatabaseUrl)]);
    const store = new PostgresAuthStore(databaseUrl);
    const verifier = new FakeCeremonyVerifier();
    const now = () => new Date('2026-07-28T20:00:00.000Z');
    const service = new AuthService({
      store,
      verifier,
      now,
      rpName: 'WokeSocial Integration',
      rpId: 'localhost',
      origin: 'http://localhost:4300',
    });
    const accounts: string[] = [];

    try {
      await store.readiness();
      const registration = await service.registrationOptions();
      accounts.push(registration.accountId);
      const firstId = credentialId(51);
      const firstBundle = await wrappedKeyBundle(firstId);
      const first = await service.verifyFirstRegistration({
        accountId: registration.accountId,
        ceremonyId: registration.ceremonyId,
        response: registrationResponse(firstId),
        bundle: firstBundle,
      });
      await expect(
        service.verifyFirstRegistration({
          accountId: registration.accountId,
          ceremonyId: registration.ceremonyId,
          response: registrationResponse(firstId),
          bundle: firstBundle,
        }),
      ).rejects.toMatchObject({ code: 'ceremony-unavailable' });

      const authenticated = await service.resolveSession(first.session.cookieValue);
      if (authenticated === undefined) throw new Error('Expected durable session.');
      const addOptions = await service.additionalCredentialOptions(authenticated);
      const secondId = credentialId(52);
      await service.verifyAdditionalCredential(authenticated, {
        ceremonyId: addOptions.ceremonyId,
        response: registrationResponse(secondId),
        bundle: await wrappedKeyBundle(secondId),
      });
      await expect(store.listCredentials(registration.accountId)).resolves.toHaveLength(2);
      await expect(service.listKeyBundles(registration.accountId)).resolves.toHaveLength(2);

      const mismatchedOptions = await service.additionalCredentialOptions(authenticated);
      const mismatchedId = credentialId(53);
      await expect(
        service.verifyAdditionalCredential(authenticated, {
          ceremonyId: mismatchedOptions.ceremonyId,
          response: registrationResponse(mismatchedId),
          bundle: await wrappedKeyBundle(mismatchedId, { publicKey: bytes(120, 32) }),
        }),
      ).rejects.toMatchObject({ code: 'bundle-invalid' });
      await expect(store.getCredential(mismatchedId)).resolves.toBeUndefined();
      await expect(store.listCredentials(registration.accountId)).resolves.toHaveLength(2);
      await expect(service.listKeyBundles(registration.accountId)).resolves.toHaveLength(2);

      const burned = await service.authenticationOptions();
      verifier.failNextAuthentication = true;
      const burnedInput = {
        ceremonyId: burned.ceremonyId,
        response: authenticationResponse(firstId, registration.options.user.id),
      };
      await expect(service.verifyAuthentication(burnedInput)).rejects.toMatchObject({
        code: 'verification-failed',
      });
      await expect(service.verifyAuthentication(burnedInput)).rejects.toMatchObject({
        code: 'verification-failed',
      });

      const loginOptions = await service.authenticationOptions();
      const login = await service.verifyAuthentication({
        ceremonyId: loginOptions.ceremonyId,
        response: authenticationResponse(firstId, registration.options.user.id),
      });
      expect(login.credential).toMatchObject({
        counter: 1,
        backedUp: true,
        lastUsedAt: now().toISOString(),
      });

      verifier.nextAuthentication = { newCounter: 0 };
      const rollbackOptions = await service.authenticationOptions();
      await expect(
        service.verifyAuthentication({
          ceremonyId: rollbackOptions.ceremonyId,
          response: authenticationResponse(firstId, registration.options.user.id),
        }),
      ).rejects.toMatchObject({ code: 'verification-failed' });
      await expect(store.getCredential(firstId)).resolves.toMatchObject({ counter: 1 });

      await expect(service.listKeyBundles(registration.accountId)).resolves.toHaveLength(2);
      await service.revokeCredential(authenticated, firstId);
      await expect(service.resolveSession(first.session.cookieValue)).resolves.toBeUndefined();
      await expect(service.resolveSession(login.session.cookieValue)).resolves.toBeUndefined();
      await expect(service.listKeyBundles(registration.accountId)).resolves.toMatchObject([
        { credentialId: secondId },
      ]);
      await expect(service.revokeCredential(authenticated, secondId)).rejects.toMatchObject({
        code: 'last-credential',
      });

      const duplicateRegistration = await service.registrationOptions();
      accounts.push(duplicateRegistration.accountId);
      await expect(
        service.verifyFirstRegistration({
          accountId: duplicateRegistration.accountId,
          ceremonyId: duplicateRegistration.ceremonyId,
          response: registrationResponse(secondId),
          bundle: await wrappedKeyBundle(secondId),
        }),
      ).rejects.toMatchObject({ code: 'credential-duplicate' });

      const sql = postgres(databaseUrl, { max: 1 });
      try {
        const rows = await sql<
          {
            credential_count: string;
            active_session_count: string;
            migration_checksums_valid: boolean;
          }[]
        >`
          SELECT
            (
              SELECT count(*)::text
              FROM auth_credentials
              WHERE account_id = ${registration.accountId}
            ) AS credential_count,
            (
              SELECT count(*)::text
              FROM auth_sessions
              WHERE account_id = ${registration.accountId}
                AND revoked_at IS NULL
            ) AS active_session_count,
            (
              SELECT bool_and(checksum ~ '^[0-9a-f]{64}$')
              FROM auth_schema_migrations
            ) AS migration_checksums_valid
        `;
        expect(rows[0]).toEqual({
          credential_count: '2',
          active_session_count: '0',
          migration_checksums_valid: true,
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanupAccounts(databaseUrl, accounts);
      await store.close();
    }
  }, 45_000);

  it('rolls back the credential transition when atomic session persistence fails', async () => {
    await migrateAuth(migrationDatabaseUrl);
    const store = new PostgresAuthStore(databaseUrl);
    const verifier = new FakeCeremonyVerifier();
    const now = () => new Date('2026-07-28T20:00:00.000Z');
    const service = new AuthService({
      store,
      verifier,
      now,
      rpName: 'WokeSocial Integration',
      rpId: 'localhost',
      origin: 'http://localhost:4300',
    });
    const registration = await service.registrationOptions();
    const id = credentialId(54);

    try {
      const first = await service.verifyFirstRegistration({
        accountId: registration.accountId,
        ceremonyId: registration.ceremonyId,
        response: registrationResponse(id),
        bundle: await wrappedKeyBundle(id),
      });
      const duplicateSession = {
        ...first.session.session,
        lastAuthenticatedAt: now().toISOString(),
      };

      await expect(
        store.completeAuthentication(
          {
            credentialId: id,
            previousCounter: 0,
            newCounter: 1,
            deviceType: 'multiDevice',
            backedUp: true,
            usedAt: now().toISOString(),
          },
          duplicateSession,
        ),
      ).rejects.toMatchObject({ code: 'database-error' });
      const credential = await store.getCredential(id);
      expect(credential).toMatchObject({
        counter: 0,
        backedUp: false,
      });
      expect(credential?.lastUsedAt).toBeUndefined();
      await expect(store.getSession(duplicateSession.sessionId)).resolves.toBeDefined();
    } finally {
      await cleanupAccounts(databaseUrl, [registration.accountId]);
      await store.close();
    }
  }, 45_000);

  it('cleans stale rows in bounded batches without deleting active or recent records', async () => {
    await migrateAuth(migrationDatabaseUrl);
    const store = new PostgresAuthStore(databaseUrl);
    const abandoned = retentionAccount('2000-12-30T00:00:00.000Z');
    const recentPending = retentionAccount('2001-01-01T12:00:00.000Z');
    const active = retentionAccount('2000-12-30T00:00:00.000Z');
    const standaloneCeremonies = [
      retentionCeremony(undefined, '2000-12-31T01:00:00.000Z'),
      retentionCeremony(undefined, '2000-12-31T02:00:00.000Z'),
    ];
    const accountIds = [abandoned.accountId, recentPending.accountId, active.accountId];

    try {
      await store.createProvisionalAccount(
        abandoned,
        retentionCeremony(abandoned.accountId, '2000-12-30T00:05:00.000Z'),
      );
      await store.createProvisionalAccount(
        recentPending,
        retentionCeremony(recentPending.accountId, '2001-01-01T12:05:00.000Z'),
      );
      await store.createProvisionalAccount(
        active,
        retentionCeremony(active.accountId, '2000-12-30T00:05:00.000Z'),
      );
      const activeCredentialId = randomBytes(32).toString('base64url');
      const activatedAt = '2000-12-30T00:01:00.000Z';
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
      const staleSession = retentionSession(active.accountId, '2000-12-31T00:00:00.000Z');
      const recentSession = retentionSession(active.accountId, '2001-01-01T12:00:00.000Z');
      await store.putSession(staleSession);
      await store.putSession(recentSession);

      await expect(
        cleanupExpiredAuthRecords(
          store,
          {
            pendingAccountRetentionMs: 86_400_000,
            ceremonyRetentionMs: 86_400_000,
            sessionRetentionMs: 86_400_000,
            batchSize: 10,
          },
          new Date('2001-01-02T00:00:00.000Z'),
        ),
      ).resolves.toEqual({
        pendingAccountsDeleted: 1,
        ceremoniesDeleted: 1,
        sessionsDeleted: 1,
      });
      await expect(store.getAccount(abandoned.accountId)).resolves.toBeUndefined();
      await expect(store.getAccount(recentPending.accountId)).resolves.toMatchObject({
        status: 'pending',
      });
      await expect(store.getAccount(active.accountId)).resolves.toMatchObject({
        status: 'active',
      });
      await expect(store.getSession(staleSession.sessionId)).resolves.toBeUndefined();
      await expect(store.getSession(recentSession.sessionId)).resolves.toBeDefined();

      await Promise.all(standaloneCeremonies.map((ceremony) => store.putCeremony(ceremony)));
      const bounded = await cleanupExpiredAuthRecords(
        store,
        {
          pendingAccountRetentionMs: 86_400_000,
          ceremonyRetentionMs: 86_400_000,
          sessionRetentionMs: 86_400_000,
          batchSize: 1,
        },
        new Date('2001-01-02T00:00:00.000Z'),
      );
      expect(bounded.ceremoniesDeleted).toBe(1);
      const sql = postgres(databaseUrl, { max: 1 });
      try {
        const rows = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM auth_ceremonies
          WHERE ceremony_id IN ${sql(standaloneCeremonies.map((item) => item.ceremonyId))}
        `;
        expect(rows[0]?.count).toBe('1');
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanupAccounts(databaseUrl, accountIds);
      await cleanupCeremonies(
        databaseUrl,
        standaloneCeremonies.map((ceremony) => ceremony.ceremonyId),
      );
      await store.close();
    }
  }, 45_000);

  it('fails readiness when required columns or runtime privileges are unavailable', async () => {
    await migrateAuth(migrationDatabaseUrl);
    const store = new PostgresAuthStore(databaseUrl);
    const runtimeSql = postgres(databaseUrl, { max: 1 });
    const migrationSql = postgres(migrationDatabaseUrl, { max: 1 });
    const runtimeRows = await runtimeSql<{ current_user: string }[]>`SELECT current_user`;
    const runtimeRole = runtimeRows[0]?.current_user;
    if (runtimeRole === undefined) throw new Error('Expected a PostgreSQL runtime role.');

    try {
      await expect(store.readiness()).resolves.toBeUndefined();

      await migrationSql`
        REVOKE SELECT ON auth_sessions FROM ${migrationSql(runtimeRole)}
      `;
      await expect(store.readiness()).rejects.toThrow();
      await migrationSql`
        GRANT SELECT ON auth_sessions TO ${migrationSql(runtimeRole)}
      `;
      await expect(store.readiness()).resolves.toBeUndefined();

      const writePrivilegeChanges = [
        {
          revoke: () =>
            migrationSql`REVOKE INSERT ON auth_sessions FROM ${migrationSql(runtimeRole)}`,
          grant: () => migrationSql`GRANT INSERT ON auth_sessions TO ${migrationSql(runtimeRole)}`,
        },
        {
          revoke: () =>
            migrationSql`REVOKE UPDATE ON auth_sessions FROM ${migrationSql(runtimeRole)}`,
          grant: () => migrationSql`GRANT UPDATE ON auth_sessions TO ${migrationSql(runtimeRole)}`,
        },
        {
          revoke: () =>
            migrationSql`REVOKE DELETE ON auth_sessions FROM ${migrationSql(runtimeRole)}`,
          grant: () => migrationSql`GRANT DELETE ON auth_sessions TO ${migrationSql(runtimeRole)}`,
        },
      ];
      for (const change of writePrivilegeChanges) {
        await change.revoke();
        await expect(store.readiness()).rejects.toThrow();
        await change.grant();
        await expect(store.readiness()).resolves.toBeUndefined();
      }

      const forbiddenLedgerPrivilegeChanges = [
        {
          grant: () =>
            migrationSql`GRANT INSERT ON auth_schema_migrations TO ${migrationSql(runtimeRole)}`,
          revoke: () =>
            migrationSql`REVOKE INSERT ON auth_schema_migrations FROM ${migrationSql(runtimeRole)}`,
        },
        {
          grant: () =>
            migrationSql`GRANT UPDATE ON auth_schema_migrations TO ${migrationSql(runtimeRole)}`,
          revoke: () =>
            migrationSql`REVOKE UPDATE ON auth_schema_migrations FROM ${migrationSql(runtimeRole)}`,
        },
        {
          grant: () =>
            migrationSql`GRANT DELETE ON auth_schema_migrations TO ${migrationSql(runtimeRole)}`,
          revoke: () =>
            migrationSql`REVOKE DELETE ON auth_schema_migrations FROM ${migrationSql(runtimeRole)}`,
        },
      ];
      for (const change of forbiddenLedgerPrivilegeChanges) {
        await change.grant();
        try {
          await expect(store.readiness()).rejects.toThrow();
        } finally {
          await change.revoke();
        }
        await expect(store.readiness()).resolves.toBeUndefined();
      }

      await migrationSql`
        ALTER TABLE auth_sessions RENAME COLUMN csrf_hash TO csrf_hash_readiness_probe
      `;
      try {
        await expect(store.readiness()).rejects.toThrow();
      } finally {
        await migrationSql`
          ALTER TABLE auth_sessions RENAME COLUMN csrf_hash_readiness_probe TO csrf_hash
        `;
      }
      await expect(store.readiness()).resolves.toBeUndefined();
    } finally {
      await migrationSql`
        GRANT SELECT, INSERT, UPDATE, DELETE
        ON auth_sessions
        TO ${migrationSql(runtimeRole)}
      `;
      await migrationSql`
        REVOKE INSERT, UPDATE, DELETE
        ON auth_schema_migrations
        FROM ${migrationSql(runtimeRole)}
      `;
      await Promise.all([
        store.close(),
        runtimeSql.end({ timeout: 5 }),
        migrationSql.end({ timeout: 5 }),
      ]);
    }
  }, 45_000);
});

async function cleanupAccounts(databaseUrl: string, accountIds: readonly string[]) {
  if (accountIds.length === 0) return;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`DELETE FROM auth_accounts WHERE account_id IN ${sql(accountIds)}`;
    await sql`
      DELETE FROM auth_ceremonies
      WHERE account_id IS NULL
        AND created_at = '2026-07-28T20:00:00.000Z'
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function cleanupCeremonies(databaseUrl: string, ceremonyIds: readonly string[]) {
  if (ceremonyIds.length === 0) return;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`DELETE FROM auth_ceremonies WHERE ceremony_id IN ${sql(ceremonyIds)}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function retentionAccount(createdAt: string): AccountRecord {
  return {
    accountId: `acct_${randomBytes(16).toString('base64url')}`,
    webauthnUserHandle: randomBytes(32),
    status: 'pending',
    createdAt,
  };
}

function retentionCeremony(accountId: string | undefined, expiresAt: string): CeremonyRecord {
  return {
    ceremonyId: `cer_${randomBytes(16).toString('base64url')}`,
    purpose: accountId === undefined ? 'authenticate' : 'register-account',
    ...(accountId === undefined ? {} : { accountId }),
    challengeHash: randomBytes(32),
    expiresAt,
    attempts: 0,
    maxAttempts: 1,
    createdAt: new Date(Date.parse(expiresAt) - 5 * 60_000).toISOString(),
  };
}

function retentionSession(accountId: string, expiresAt: string): SessionRecord {
  const createdAt = new Date(Date.parse(expiresAt) - 60 * 60_000).toISOString();
  return {
    sessionId: `ses_${randomBytes(16).toString('base64url')}`,
    accountId,
    secretHash: randomBytes(32),
    csrfHash: randomBytes(32),
    createdAt,
    expiresAt,
    lastAuthenticatedAt: createdAt,
  };
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

function bytes(seed: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (seed + index) & 0xff);
}

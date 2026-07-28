import postgres, { type Sql, type TransactionSql } from 'postgres';

import type { AuthenticatorTransportFuture, CredentialDeviceType } from '@simplewebauthn/server';
import type { PasskeyWrappedKeyBundle } from '@socially-woke/crypto';

import { AuthServiceError } from './errors.js';
import { counterAdvances } from './memory-store.js';
import type {
  AccountRecord,
  CeremonyRecord,
  CredentialAuthenticationUpdate,
  CredentialRecord,
  SessionRecord,
  StoredKeyBundle,
} from './models.js';
import {
  assertCleanupExpiredInput,
  type AuthStore,
  type CleanupExpiredInput,
  type CleanupExpiredResult,
  type ConsumeCeremonyInput,
  type RotateSessionInput,
} from './store.js';

export class PostgresAuthStore implements AuthStore {
  readonly kind = 'postgres';
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      transform: { undefined: null },
    });
  }

  async createProvisionalAccount(account: AccountRecord, ceremony: CeremonyRecord): Promise<void> {
    try {
      await this.#sql.begin(async (sql) => {
        await sql`
          INSERT INTO auth_accounts (
            account_id, webauthn_user_handle, status, created_at, activated_at
          ) VALUES (
            ${account.accountId}, ${account.webauthnUserHandle}, ${account.status},
            ${account.createdAt}, ${account.activatedAt ?? null}
          )
        `;
        await insertCeremony(sql, ceremony);
      });
    } catch (error) {
      throw databaseFailure('Account registration could not be initialized.', error);
    }
  }

  async getAccount(accountId: string): Promise<AccountRecord | undefined> {
    const rows = await this.#sql<AccountRow[]>`
      SELECT * FROM auth_accounts WHERE account_id = ${accountId}
    `;
    return rows[0] === undefined ? undefined : accountFromRow(rows[0]);
  }

  async putCeremony(ceremony: CeremonyRecord): Promise<void> {
    try {
      await insertCeremony(this.#sql, ceremony);
    } catch (error) {
      throw databaseFailure('Ceremony could not be initialized.', error);
    }
  }

  async consumeCeremony(input: ConsumeCeremonyInput): Promise<CeremonyRecord | undefined> {
    const rows = await this.#sql<CeremonyRow[]>`
      UPDATE auth_ceremonies
      SET account_id = COALESCE(account_id, ${input.accountId ?? null}),
          attempts = attempts + 1,
          consumed_at = ${input.now}
      WHERE ceremony_id = ${input.ceremonyId}
        AND purpose = ${input.purpose}
        AND consumed_at IS NULL
        AND attempts < max_attempts
        AND expires_at > ${input.now}
        AND (account_id IS NULL OR account_id = ${input.accountId ?? null})
      RETURNING *
    `;
    return rows[0] === undefined ? undefined : ceremonyFromRow(rows[0]);
  }

  async getCredential(credentialId: string): Promise<CredentialRecord | undefined> {
    const rows = await this.#sql<CredentialRow[]>`
      SELECT * FROM auth_credentials WHERE credential_id = ${credentialId}
    `;
    return rows[0] === undefined ? undefined : credentialFromRow(rows[0]);
  }

  async listCredentials(accountId: string): Promise<readonly CredentialRecord[]> {
    const rows = await this.#sql<CredentialRow[]>`
      SELECT *
      FROM auth_credentials
      WHERE account_id = ${accountId}
      ORDER BY created_at, credential_id
    `;
    return rows.map(credentialFromRow);
  }

  async finalizeFirstCredential(
    accountId: string,
    credential: CredentialRecord,
    activatedAt: string,
  ): Promise<void> {
    try {
      await this.#sql.begin(async (sql) => {
        const activated = await sql`
          UPDATE auth_accounts
          SET status = 'active', activated_at = ${activatedAt}
          WHERE account_id = ${accountId}
            AND status = 'pending'
          RETURNING account_id
        `;
        if (activated.length !== 1) {
          throw new AuthServiceError('Account is unavailable.', 'account-unavailable');
        }
        await insertCredential(sql, credential);
      });
    } catch (error) {
      if (error instanceof AuthServiceError) throw error;
      if (isUniqueViolation(error)) {
        throw new AuthServiceError('Credential ID is already registered.', 'credential-duplicate');
      }
      throw databaseFailure('Credential could not be registered.', error);
    }
  }

  async addCredential(accountId: string, credential: CredentialRecord): Promise<void> {
    try {
      await this.#sql.begin(async (sql) => {
        const account = await sql`
          SELECT 1
          FROM auth_accounts
          WHERE account_id = ${accountId}
            AND status = 'active'
          FOR UPDATE
        `;
        if (account.length !== 1 || credential.accountId !== accountId) {
          throw new AuthServiceError('Account is unavailable.', 'account-unavailable');
        }
        await insertCredential(sql, credential);
      });
    } catch (error) {
      if (error instanceof AuthServiceError) throw error;
      if (isUniqueViolation(error)) {
        throw new AuthServiceError('Credential ID is already registered.', 'credential-duplicate');
      }
      throw databaseFailure('Credential could not be registered.', error);
    }
  }

  async updateCredentialAfterAuthentication(
    update: CredentialAuthenticationUpdate,
  ): Promise<CredentialRecord> {
    if (!counterAdvances(update.previousCounter, update.newCounter)) {
      throw new AuthServiceError(
        'Credential counter did not advance monotonically.',
        'verification-failed',
      );
    }
    const rows = await this.#sql<CredentialRow[]>`
      UPDATE auth_credentials
      SET counter = ${update.newCounter},
          device_type = ${update.deviceType},
          backed_up = ${update.backedUp},
          last_used_at = ${update.usedAt}
      WHERE credential_id = ${update.credentialId}
        AND revoked_at IS NULL
        AND counter = ${update.previousCounter}
        AND (
          (${update.previousCounter} = 0 AND ${update.newCounter} >= 0)
          OR ${update.newCounter} > ${update.previousCounter}
        )
      RETURNING *
    `;
    if (rows[0] === undefined) {
      throw new AuthServiceError(
        'Credential state no longer matches the verified assertion.',
        'verification-failed',
      );
    }
    return credentialFromRow(rows[0]);
  }

  async revokeCredential(
    accountId: string,
    credentialId: string,
    revokedAt: string,
  ): Promise<CredentialRecord> {
    return this.#sql.begin(async (sql) => {
      const active = await sql<CredentialRow[]>`
        SELECT *
        FROM auth_credentials
        WHERE account_id = ${accountId}
          AND revoked_at IS NULL
        ORDER BY credential_id
        FOR UPDATE
      `;
      const target = active.find((credential) => credential.credential_id === credentialId);
      if (target === undefined) {
        throw new AuthServiceError('Credential is unavailable.', 'credential-unavailable');
      }
      if (active.length <= 1) {
        throw new AuthServiceError(
          'The last active credential cannot be revoked while recovery is unavailable.',
          'last-credential',
        );
      }
      const rows = await sql<CredentialRow[]>`
        UPDATE auth_credentials
        SET revoked_at = ${revokedAt}
        WHERE credential_id = ${credentialId}
          AND account_id = ${accountId}
          AND revoked_at IS NULL
        RETURNING *
      `;
      await sql`
        DELETE FROM auth_key_bundles
        WHERE credential_id = ${credentialId}
          AND account_id = ${accountId}
      `;
      await sql`
        UPDATE auth_sessions
        SET revoked_at = ${revokedAt}
        WHERE account_id = ${accountId}
          AND revoked_at IS NULL
      `;
      const row = rows[0];
      if (row === undefined) {
        throw new AuthServiceError('Credential is unavailable.', 'credential-unavailable');
      }
      return credentialFromRow(row);
    });
  }

  async putSession(session: SessionRecord): Promise<void> {
    await this.#sql`
      INSERT INTO auth_sessions (
        session_id, account_id, secret_hash, csrf_hash, created_at, expires_at,
        last_authenticated_at, step_up_at, revoked_at
      ) VALUES (
        ${session.sessionId}, ${session.accountId}, ${session.secretHash},
        ${session.csrfHash}, ${session.createdAt}, ${session.expiresAt},
        ${session.lastAuthenticatedAt}, ${session.stepUpAt ?? null},
        ${session.revokedAt ?? null}
      )
    `;
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const rows = await this.#sql<SessionRow[]>`
      SELECT * FROM auth_sessions WHERE session_id = ${sessionId}
    `;
    return rows[0] === undefined ? undefined : sessionFromRow(rows[0]);
  }

  async rotateSession(input: RotateSessionInput): Promise<SessionRecord> {
    const rows = await this.#sql<SessionRow[]>`
      UPDATE auth_sessions
      SET secret_hash = ${input.secretHash},
          csrf_hash = ${input.csrfHash},
          expires_at = ${input.expiresAt},
          last_authenticated_at = ${input.authenticatedAt},
          step_up_at = CASE
            WHEN ${input.stepUp} THEN ${input.authenticatedAt}
            ELSE step_up_at
          END
      WHERE session_id = ${input.sessionId}
        AND account_id = ${input.accountId}
        AND revoked_at IS NULL
        AND expires_at > ${input.authenticatedAt}
      RETURNING *
    `;
    if (rows[0] === undefined) {
      throw new AuthServiceError('Authenticated session is unavailable.', 'session-required');
    }
    return sessionFromRow(rows[0]);
  }

  async revokeSession(sessionId: string, revokedAt: string): Promise<void> {
    await this.#sql`
      UPDATE auth_sessions
      SET revoked_at = ${revokedAt}
      WHERE session_id = ${sessionId}
        AND revoked_at IS NULL
    `;
  }

  async putKeyBundle(bundle: StoredKeyBundle): Promise<void> {
    await this.#sql.begin(async (sql) => {
      const credential = await sql`
        SELECT 1
        FROM auth_credentials
        WHERE credential_id = ${bundle.credentialId}
          AND account_id = ${bundle.accountId}
          AND revoked_at IS NULL
        FOR UPDATE
      `;
      if (credential.length !== 1) {
        throw new AuthServiceError('Credential is unavailable.', 'credential-unavailable');
      }
      await sql`
        INSERT INTO auth_key_bundles (
          account_id, credential_id, key_kind, public_key, bundle, updated_at
        ) VALUES (
          ${bundle.accountId}, ${bundle.credentialId}, ${bundle.keyKind},
          ${bundle.publicKey}, ${sql.json(toJsonValue(bundle.bundle))}, ${bundle.updatedAt}
        )
        ON CONFLICT (credential_id, key_kind, public_key)
        DO UPDATE SET
          account_id = EXCLUDED.account_id,
          bundle = EXCLUDED.bundle,
          updated_at = EXCLUDED.updated_at
      `;
    });
  }

  async listKeyBundles(accountId: string): Promise<readonly StoredKeyBundle[]> {
    const rows = await this.#sql<KeyBundleRow[]>`
      SELECT *
      FROM auth_key_bundles
      WHERE account_id = ${accountId}
      ORDER BY key_kind, public_key, credential_id
    `;
    return rows.map(bundleFromRow);
  }

  async cleanupExpired(input: CleanupExpiredInput): Promise<CleanupExpiredResult> {
    assertCleanupExpiredInput(input);
    return this.#sql.begin(async (sql) => {
      const abandonedAccounts = await sql`
        WITH candidates AS (
          SELECT account_id
          FROM auth_accounts
          WHERE status = 'pending'
            AND created_at <= ${input.pendingAccountCreatedBefore}
          ORDER BY created_at, account_id
          LIMIT ${input.batchSize}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM auth_accounts AS account
        USING candidates
        WHERE account.account_id = candidates.account_id
        RETURNING account.account_id
      `;
      const ceremonies = await sql`
        WITH candidates AS (
          SELECT ceremony_id
          FROM auth_ceremonies
          WHERE expires_at <= ${input.ceremonyInactiveBefore}
             OR consumed_at <= ${input.ceremonyInactiveBefore}
          ORDER BY COALESCE(consumed_at, expires_at), ceremony_id
          LIMIT ${input.batchSize}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM auth_ceremonies AS ceremony
        USING candidates
        WHERE ceremony.ceremony_id = candidates.ceremony_id
        RETURNING ceremony.ceremony_id
      `;
      const sessions = await sql`
        WITH candidates AS (
          SELECT session_id
          FROM auth_sessions
          WHERE expires_at <= ${input.sessionInactiveBefore}
             OR revoked_at <= ${input.sessionInactiveBefore}
          ORDER BY COALESCE(revoked_at, expires_at), session_id
          LIMIT ${input.batchSize}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM auth_sessions AS session
        USING candidates
        WHERE session.session_id = candidates.session_id
        RETURNING session.session_id
      `;
      return {
        pendingAccountsDeleted: abandonedAccounts.length,
        ceremoniesDeleted: ceremonies.length,
        sessionsDeleted: sessions.length,
      };
    });
  }

  async readiness(): Promise<void> {
    await this.#sql`SELECT 1`;
  }

  async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }
}

interface AccountRow {
  account_id: string;
  webauthn_user_handle: Uint8Array;
  status: 'pending' | 'active';
  created_at: Date | string;
  activated_at: Date | string | null;
}

interface CeremonyRow {
  ceremony_id: string;
  purpose: CeremonyRecord['purpose'];
  account_id: string | null;
  challenge_hash: Uint8Array;
  expires_at: Date | string;
  attempts: number;
  max_attempts: number;
  consumed_at: Date | string | null;
  created_at: Date | string;
}

interface CredentialRow {
  credential_id: string;
  account_id: string;
  public_key: Uint8Array;
  counter: string;
  transports: AuthenticatorTransportFuture[];
  device_type: CredentialDeviceType;
  backed_up: boolean;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}

interface SessionRow {
  session_id: string;
  account_id: string;
  secret_hash: Uint8Array;
  csrf_hash: Uint8Array;
  created_at: Date | string;
  expires_at: Date | string;
  last_authenticated_at: Date | string;
  step_up_at: Date | string | null;
  revoked_at: Date | string | null;
}

interface KeyBundleRow {
  account_id: string;
  credential_id: string;
  key_kind: StoredKeyBundle['keyKind'];
  public_key: string;
  bundle: PasskeyWrappedKeyBundle;
  updated_at: Date | string;
}

function accountFromRow(row: AccountRow): AccountRecord {
  return {
    accountId: row.account_id,
    webauthnUserHandle: Uint8Array.from(row.webauthn_user_handle),
    status: row.status,
    createdAt: dateString(row.created_at),
    ...(row.activated_at === null ? {} : { activatedAt: dateString(row.activated_at) }),
  };
}

function ceremonyFromRow(row: CeremonyRow): CeremonyRecord {
  return {
    ceremonyId: row.ceremony_id,
    purpose: row.purpose,
    ...(row.account_id === null ? {} : { accountId: row.account_id }),
    challengeHash: Uint8Array.from(row.challenge_hash),
    expiresAt: dateString(row.expires_at),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: dateString(row.created_at),
    ...(row.consumed_at === null ? {} : { consumedAt: dateString(row.consumed_at) }),
  };
}

function credentialFromRow(row: CredentialRow): CredentialRecord {
  return {
    credentialId: row.credential_id,
    accountId: row.account_id,
    publicKey: Uint8Array.from(row.public_key),
    counter: Number(row.counter),
    transports: [...row.transports],
    deviceType: row.device_type,
    backedUp: row.backed_up,
    createdAt: dateString(row.created_at),
    ...(row.last_used_at === null ? {} : { lastUsedAt: dateString(row.last_used_at) }),
    ...(row.revoked_at === null ? {} : { revokedAt: dateString(row.revoked_at) }),
  };
}

function sessionFromRow(row: SessionRow): SessionRecord {
  return {
    sessionId: row.session_id,
    accountId: row.account_id,
    secretHash: Uint8Array.from(row.secret_hash),
    csrfHash: Uint8Array.from(row.csrf_hash),
    createdAt: dateString(row.created_at),
    expiresAt: dateString(row.expires_at),
    lastAuthenticatedAt: dateString(row.last_authenticated_at),
    ...(row.step_up_at === null ? {} : { stepUpAt: dateString(row.step_up_at) }),
    ...(row.revoked_at === null ? {} : { revokedAt: dateString(row.revoked_at) }),
  };
}

function bundleFromRow(row: KeyBundleRow): StoredKeyBundle {
  return {
    accountId: row.account_id,
    credentialId: row.credential_id,
    keyKind: row.key_kind,
    publicKey: row.public_key,
    bundle: row.bundle,
    updatedAt: dateString(row.updated_at),
  };
}

function insertCeremony(sql: Sql | TransactionSql, ceremony: CeremonyRecord) {
  return sql`
    INSERT INTO auth_ceremonies (
      ceremony_id, purpose, account_id, challenge_hash, expires_at,
      attempts, max_attempts, consumed_at, created_at
    ) VALUES (
      ${ceremony.ceremonyId}, ${ceremony.purpose}, ${ceremony.accountId ?? null},
      ${ceremony.challengeHash}, ${ceremony.expiresAt}, ${ceremony.attempts},
      ${ceremony.maxAttempts}, ${ceremony.consumedAt ?? null}, ${ceremony.createdAt}
    )
  `;
}

function insertCredential(sql: Sql | TransactionSql, credential: CredentialRecord) {
  return sql`
    INSERT INTO auth_credentials (
      credential_id, account_id, public_key, counter, transports, device_type,
      backed_up, created_at, last_used_at, revoked_at
    ) VALUES (
      ${credential.credentialId}, ${credential.accountId}, ${credential.publicKey},
      ${credential.counter}, ${sql.json([...credential.transports])},
      ${credential.deviceType}, ${credential.backedUp}, ${credential.createdAt},
      ${credential.lastUsedAt ?? null}, ${credential.revokedAt ?? null}
    )
  `;
}

function dateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toJsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

function databaseFailure(message: string, cause: unknown): AuthServiceError {
  return new AuthServiceError(message, 'database-error', { cause });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

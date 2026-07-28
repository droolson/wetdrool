import type {
  AccountRecord,
  CeremonyPurpose,
  CeremonyRecord,
  CredentialAuthenticationUpdate,
  CredentialRecord,
  SessionRecord,
  StoredKeyBundle,
} from './models.js';

export interface ConsumeCeremonyInput {
  readonly ceremonyId: string;
  readonly purpose: CeremonyPurpose;
  readonly accountId?: string;
  readonly now: string;
}

export interface RotateSessionInput {
  readonly sessionId: string;
  readonly accountId: string;
  readonly secretHash: Uint8Array;
  readonly csrfHash: Uint8Array;
  readonly expiresAt: string;
  readonly authenticatedAt: string;
  readonly stepUp: boolean;
}

export interface CleanupExpiredInput {
  /** Defensive upper bound: no cutoff may be later than this instant. */
  readonly now: string;
  /** Pending accounts created at or before this instant are abandoned. */
  readonly pendingAccountCreatedBefore: string;
  /** Consumed or expired ceremonies inactive at or before this instant are stale. */
  readonly ceremonyInactiveBefore: string;
  /** Revoked or expired sessions inactive at or before this instant are stale. */
  readonly sessionInactiveBefore: string;
  /** Maximum rows selected from each record family in one maintenance pass. */
  readonly batchSize: number;
}

export interface CleanupExpiredResult {
  readonly pendingAccountsDeleted: number;
  /** Direct deletes only; cascades from abandoned accounts are not double-counted. */
  readonly ceremoniesDeleted: number;
  readonly sessionsDeleted: number;
}

export interface AuthStore {
  readonly kind: 'memory-development-only' | 'postgres';
  createProvisionalAccount(account: AccountRecord, ceremony: CeremonyRecord): Promise<void>;
  getAccount(accountId: string): Promise<AccountRecord | undefined>;
  putCeremony(ceremony: CeremonyRecord): Promise<void>;
  consumeCeremony(input: ConsumeCeremonyInput): Promise<CeremonyRecord | undefined>;
  getCredential(credentialId: string): Promise<CredentialRecord | undefined>;
  listCredentials(accountId: string): Promise<readonly CredentialRecord[]>;
  finalizeFirstCredential(
    accountId: string,
    credential: CredentialRecord,
    rootBundle: StoredKeyBundle,
    activatedAt: string,
  ): Promise<void>;
  addCredential(
    accountId: string,
    credential: CredentialRecord,
    rootBundle: StoredKeyBundle,
  ): Promise<void>;
  /**
   * Atomically commits an authenticated credential-state transition and the
   * session issued from that exact transition. This serialization boundary
   * prevents credential revocation from racing between verification and
   * session persistence.
   */
  completeAuthentication(
    update: CredentialAuthenticationUpdate,
    session: SessionRecord,
  ): Promise<CredentialRecord>;
  updateCredentialAfterAuthentication(
    update: CredentialAuthenticationUpdate,
  ): Promise<CredentialRecord>;
  /** Atomically revokes the credential, its bundles, and every session for the account. */
  revokeCredential(
    accountId: string,
    credentialId: string,
    revokedAt: string,
  ): Promise<CredentialRecord>;
  putSession(session: SessionRecord): Promise<void>;
  getSession(sessionId: string): Promise<SessionRecord | undefined>;
  rotateSession(input: RotateSessionInput): Promise<SessionRecord>;
  revokeSession(sessionId: string, revokedAt: string): Promise<void>;
  listKeyBundles(accountId: string): Promise<readonly StoredKeyBundle[]>;
  cleanupExpired(input: CleanupExpiredInput): Promise<CleanupExpiredResult>;
  readiness(): Promise<void>;
  close(): Promise<void>;
}

export function assertCleanupExpiredInput(input: CleanupExpiredInput): void {
  const now = Date.parse(input.now);
  const cutoffs = [
    input.pendingAccountCreatedBefore,
    input.ceremonyInactiveBefore,
    input.sessionInactiveBefore,
  ].map(Date.parse);
  if (
    !Number.isFinite(now) ||
    cutoffs.some((cutoff) => !Number.isFinite(cutoff) || cutoff > now) ||
    !Number.isSafeInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > 5_000
  ) {
    throw new TypeError('Invalid authentication-retention cleanup bounds.');
  }
}

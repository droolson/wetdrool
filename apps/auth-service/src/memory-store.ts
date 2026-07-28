import { AuthServiceError } from './errors.js';
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

export class MemoryAuthStore implements AuthStore {
  readonly kind = 'memory-development-only';
  readonly #accounts = new Map<string, AccountRecord>();
  readonly #ceremonies = new Map<string, CeremonyRecord>();
  readonly #credentials = new Map<string, CredentialRecord>();
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #bundles = new Map<string, StoredKeyBundle>();

  async createProvisionalAccount(account: AccountRecord, ceremony: CeremonyRecord): Promise<void> {
    if (
      this.#accounts.has(account.accountId) ||
      [...this.#accounts.values()].some((item) =>
        bytesEqual(item.webauthnUserHandle, account.webauthnUserHandle),
      ) ||
      this.#ceremonies.has(ceremony.ceremonyId) ||
      ceremony.accountId !== account.accountId
    ) {
      throw new AuthServiceError(
        'Account registration could not be initialized.',
        'invalid-request',
      );
    }
    this.#accounts.set(account.accountId, cloneAccount(account));
    this.#ceremonies.set(ceremony.ceremonyId, cloneCeremony(ceremony));
  }

  async getAccount(accountId: string): Promise<AccountRecord | undefined> {
    const account = this.#accounts.get(accountId);
    return account === undefined ? undefined : cloneAccount(account);
  }

  async putCeremony(ceremony: CeremonyRecord): Promise<void> {
    if (
      this.#ceremonies.has(ceremony.ceremonyId) ||
      (ceremony.accountId !== undefined && !this.#accounts.has(ceremony.accountId))
    ) {
      throw new AuthServiceError('Ceremony could not be initialized.', 'invalid-request');
    }
    this.#ceremonies.set(ceremony.ceremonyId, cloneCeremony(ceremony));
  }

  async consumeCeremony(input: ConsumeCeremonyInput): Promise<CeremonyRecord | undefined> {
    const ceremony = this.#ceremonies.get(input.ceremonyId);
    if (
      ceremony === undefined ||
      ceremony.purpose !== input.purpose ||
      ceremony.consumedAt !== undefined ||
      ceremony.attempts >= ceremony.maxAttempts ||
      Date.parse(ceremony.expiresAt) <= Date.parse(input.now) ||
      (ceremony.accountId !== undefined && ceremony.accountId !== input.accountId)
    ) {
      return undefined;
    }
    const consumed: CeremonyRecord = {
      ...ceremony,
      ...(ceremony.accountId === undefined && input.accountId !== undefined
        ? { accountId: input.accountId }
        : {}),
      attempts: ceremony.attempts + 1,
      consumedAt: input.now,
    };
    this.#ceremonies.set(input.ceremonyId, consumed);
    return cloneCeremony(consumed);
  }

  async getCredential(credentialId: string): Promise<CredentialRecord | undefined> {
    const credential = this.#credentials.get(credentialId);
    return credential === undefined ? undefined : cloneCredential(credential);
  }

  async listCredentials(accountId: string): Promise<readonly CredentialRecord[]> {
    return [...this.#credentials.values()]
      .filter((credential) => credential.accountId === accountId)
      .sort((left, right) => {
        const created = left.createdAt.localeCompare(right.createdAt);
        return created === 0 ? left.credentialId.localeCompare(right.credentialId) : created;
      })
      .map(cloneCredential);
  }

  async finalizeFirstCredential(
    accountId: string,
    credential: CredentialRecord,
    activatedAt: string,
  ): Promise<void> {
    const account = this.#accounts.get(accountId);
    if (
      account === undefined ||
      account.status !== 'pending' ||
      credential.accountId !== accountId ||
      this.#credentials.has(credential.credentialId)
    ) {
      throw new AuthServiceError(
        'Credential ID is already registered or the account is unavailable.',
        'credential-duplicate',
      );
    }
    this.#credentials.set(credential.credentialId, cloneCredential(credential));
    this.#accounts.set(accountId, {
      ...account,
      status: 'active',
      activatedAt,
    });
  }

  async addCredential(accountId: string, credential: CredentialRecord): Promise<void> {
    const account = this.#accounts.get(accountId);
    if (
      account?.status !== 'active' ||
      credential.accountId !== accountId ||
      this.#credentials.has(credential.credentialId)
    ) {
      throw new AuthServiceError(
        'Credential ID is already registered or the account is unavailable.',
        'credential-duplicate',
      );
    }
    this.#credentials.set(credential.credentialId, cloneCredential(credential));
  }

  async updateCredentialAfterAuthentication(
    update: CredentialAuthenticationUpdate,
  ): Promise<CredentialRecord> {
    const credential = this.#credentials.get(update.credentialId);
    if (
      credential === undefined ||
      credential.revokedAt !== undefined ||
      credential.counter !== update.previousCounter ||
      !counterAdvances(update.previousCounter, update.newCounter)
    ) {
      throw new AuthServiceError(
        'Credential state no longer matches the verified assertion.',
        'verification-failed',
      );
    }
    const updated: CredentialRecord = {
      ...credential,
      counter: update.newCounter,
      deviceType: update.deviceType,
      backedUp: update.backedUp,
      lastUsedAt: update.usedAt,
    };
    this.#credentials.set(credential.credentialId, updated);
    return cloneCredential(updated);
  }

  async revokeCredential(
    accountId: string,
    credentialId: string,
    revokedAt: string,
  ): Promise<CredentialRecord> {
    const credential = this.#credentials.get(credentialId);
    const active = [...this.#credentials.values()].filter(
      (item) => item.accountId === accountId && item.revokedAt === undefined,
    );
    if (
      credential === undefined ||
      credential.accountId !== accountId ||
      credential.revokedAt !== undefined
    ) {
      throw new AuthServiceError('Credential is unavailable.', 'credential-unavailable');
    }
    if (active.length <= 1) {
      throw new AuthServiceError(
        'The last active credential cannot be revoked while recovery is unavailable.',
        'last-credential',
      );
    }
    const revoked = { ...credential, revokedAt };
    this.#credentials.set(credentialId, revoked);
    for (const [key, bundle] of this.#bundles) {
      if (bundle.credentialId === credentialId) this.#bundles.delete(key);
    }
    for (const [sessionId, session] of this.#sessions) {
      if (session.accountId === accountId && session.revokedAt === undefined) {
        this.#sessions.set(sessionId, { ...session, revokedAt });
      }
    }
    return cloneCredential(revoked);
  }

  async putSession(session: SessionRecord): Promise<void> {
    if (this.#sessions.has(session.sessionId) || !this.#accounts.has(session.accountId)) {
      throw new AuthServiceError('Session could not be created.', 'verification-failed');
    }
    this.#sessions.set(session.sessionId, cloneSession(session));
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const session = this.#sessions.get(sessionId);
    return session === undefined ? undefined : cloneSession(session);
  }

  async rotateSession(input: RotateSessionInput): Promise<SessionRecord> {
    const session = this.#sessions.get(input.sessionId);
    if (
      session === undefined ||
      session.accountId !== input.accountId ||
      session.revokedAt !== undefined ||
      Date.parse(session.expiresAt) <= Date.parse(input.authenticatedAt)
    ) {
      throw new AuthServiceError('Authenticated session is unavailable.', 'session-required');
    }
    const rotated: SessionRecord = {
      ...session,
      secretHash: input.secretHash.slice(),
      csrfHash: input.csrfHash.slice(),
      expiresAt: input.expiresAt,
      lastAuthenticatedAt: input.authenticatedAt,
      ...(input.stepUp ? { stepUpAt: input.authenticatedAt } : {}),
    };
    this.#sessions.set(input.sessionId, rotated);
    return cloneSession(rotated);
  }

  async revokeSession(sessionId: string, revokedAt: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (session !== undefined && session.revokedAt === undefined) {
      this.#sessions.set(sessionId, { ...session, revokedAt });
    }
  }

  async putKeyBundle(bundle: StoredKeyBundle): Promise<void> {
    const credential = this.#credentials.get(bundle.credentialId);
    if (
      credential === undefined ||
      credential.accountId !== bundle.accountId ||
      credential.revokedAt !== undefined
    ) {
      throw new AuthServiceError('Credential is unavailable.', 'credential-unavailable');
    }
    this.#bundles.set(bundleKey(bundle), cloneBundle(bundle));
  }

  async listKeyBundles(accountId: string): Promise<readonly StoredKeyBundle[]> {
    return [...this.#bundles.values()]
      .filter((bundle) => bundle.accountId === accountId)
      .sort((left, right) => bundleKey(left).localeCompare(bundleKey(right)))
      .map(cloneBundle);
  }

  async cleanupExpired(input: CleanupExpiredInput): Promise<CleanupExpiredResult> {
    assertCleanupExpiredInput(input);

    const abandonedAccountIds = [...this.#accounts.values()]
      .filter(
        (account) =>
          account.status === 'pending' &&
          Date.parse(account.createdAt) <= Date.parse(input.pendingAccountCreatedBefore),
      )
      .sort((left, right) => {
        const created = left.createdAt.localeCompare(right.createdAt);
        return created === 0 ? left.accountId.localeCompare(right.accountId) : created;
      })
      .slice(0, input.batchSize)
      .map((account) => account.accountId);
    for (const accountId of abandonedAccountIds) this.#deleteAccountCascade(accountId);

    const ceremonyIds = [...this.#ceremonies.values()]
      .filter(
        (ceremony) =>
          Date.parse(ceremony.expiresAt) <= Date.parse(input.ceremonyInactiveBefore) ||
          (ceremony.consumedAt !== undefined &&
            Date.parse(ceremony.consumedAt) <= Date.parse(input.ceremonyInactiveBefore)),
      )
      .sort((left, right) => {
        const inactiveLeft = left.consumedAt ?? left.expiresAt;
        const inactiveRight = right.consumedAt ?? right.expiresAt;
        const inactive = inactiveLeft.localeCompare(inactiveRight);
        return inactive === 0 ? left.ceremonyId.localeCompare(right.ceremonyId) : inactive;
      })
      .slice(0, input.batchSize)
      .map((ceremony) => ceremony.ceremonyId);
    for (const ceremonyId of ceremonyIds) this.#ceremonies.delete(ceremonyId);

    const sessionIds = [...this.#sessions.values()]
      .filter(
        (session) =>
          Date.parse(session.expiresAt) <= Date.parse(input.sessionInactiveBefore) ||
          (session.revokedAt !== undefined &&
            Date.parse(session.revokedAt) <= Date.parse(input.sessionInactiveBefore)),
      )
      .sort((left, right) => {
        const inactiveLeft = left.revokedAt ?? left.expiresAt;
        const inactiveRight = right.revokedAt ?? right.expiresAt;
        const inactive = inactiveLeft.localeCompare(inactiveRight);
        return inactive === 0 ? left.sessionId.localeCompare(right.sessionId) : inactive;
      })
      .slice(0, input.batchSize)
      .map((session) => session.sessionId);
    for (const sessionId of sessionIds) this.#sessions.delete(sessionId);

    return {
      pendingAccountsDeleted: abandonedAccountIds.length,
      ceremoniesDeleted: ceremonyIds.length,
      sessionsDeleted: sessionIds.length,
    };
  }

  readiness(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  #deleteAccountCascade(accountId: string): void {
    this.#accounts.delete(accountId);
    for (const [ceremonyId, ceremony] of this.#ceremonies) {
      if (ceremony.accountId === accountId) this.#ceremonies.delete(ceremonyId);
    }
    for (const [credentialId, credential] of this.#credentials) {
      if (credential.accountId === accountId) this.#credentials.delete(credentialId);
    }
    for (const [sessionId, session] of this.#sessions) {
      if (session.accountId === accountId) this.#sessions.delete(sessionId);
    }
    for (const [key, bundle] of this.#bundles) {
      if (bundle.accountId === accountId) this.#bundles.delete(key);
    }
  }
}

export function counterAdvances(previous: number, next: number): boolean {
  return (
    Number.isSafeInteger(previous) &&
    Number.isSafeInteger(next) &&
    previous >= 0 &&
    next >= 0 &&
    next >= previous &&
    (previous === 0 || next > previous)
  );
}

function bundleKey(bundle: StoredKeyBundle): string {
  return `${bundle.credentialId}\u0000${bundle.keyKind}\u0000${bundle.publicKey}`;
}

function cloneAccount(account: AccountRecord): AccountRecord {
  return { ...account, webauthnUserHandle: account.webauthnUserHandle.slice() };
}

function cloneCeremony(ceremony: CeremonyRecord): CeremonyRecord {
  return { ...ceremony, challengeHash: ceremony.challengeHash.slice() };
}

function cloneCredential(credential: CredentialRecord): CredentialRecord {
  return {
    ...credential,
    publicKey: credential.publicKey.slice(),
    transports: [...credential.transports],
  };
}

function cloneSession(session: SessionRecord): SessionRecord {
  return {
    ...session,
    secretHash: session.secretHash.slice(),
    csrfHash: session.csrfHash.slice(),
  };
}

function cloneBundle(bundle: StoredKeyBundle): StoredKeyBundle {
  return { ...bundle, bundle: structuredClone(bundle.bundle) };
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

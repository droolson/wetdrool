import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { secureRandomBytes } from '@socially-woke/crypto';

import { validateKeyBundle } from './bundle-validator.js';
import { CeremonyManager } from './ceremony-manager.js';
import {
  assertAuthenticationResult,
  credentialFromVerification,
  discoverableUserHandleMatches,
} from './credential-state.js';
import { AuthServiceError } from './errors.js';
import type { CredentialRecord, SessionRecord, StoredKeyBundle } from './models.js';
import { randomAccountId } from './security.js';
import {
  type AuthenticatedSession,
  type IssuedSession,
  SessionManager,
} from './session-manager.js';
import type { AuthStore } from './store.js';
import {
  accountAuthenticationOptions,
  additionalCredentialOptions,
  discoverableAuthenticationOptions,
  newAccountRegistrationOptions,
} from './webauthn-options.js';
import {
  SimpleWebAuthnCeremonyVerifier,
  type CeremonyVerifier,
  type VerifiedAuthentication,
} from './webauthn-verifier.js';

const DEFAULT_CEREMONY_TTL_MS = 5 * 60_000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60_000;
const DEFAULT_STEP_UP_TTL_MS = 5 * 60_000;

export interface AuthServiceOptions {
  readonly store: AuthStore;
  readonly rpName: string;
  readonly rpId: string;
  readonly origin: string;
  readonly verifier?: CeremonyVerifier;
  readonly now?: () => Date;
  readonly ceremonyTtlMs?: number;
  readonly sessionTtlMs?: number;
  readonly stepUpTtlMs?: number;
}

export type { AuthenticatedSession, IssuedSession } from './session-manager.js';

export class AuthService {
  readonly store: AuthStore;
  readonly rpName: string;
  readonly rpId: string;
  readonly origin: string;
  readonly #now: () => Date;
  readonly #ceremonies: CeremonyManager;
  readonly #sessions: SessionManager;

  constructor(options: AuthServiceOptions) {
    this.store = options.store;
    this.rpName = options.rpName;
    this.rpId = options.rpId;
    this.origin = options.origin;
    this.#now = options.now ?? (() => new Date());
    const ceremonyTtlMs = positiveDuration(
      options.ceremonyTtlMs ?? DEFAULT_CEREMONY_TTL_MS,
      'ceremony TTL',
    );
    const sessionTtlMs = positiveDuration(
      options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
      'session TTL',
    );
    const stepUpTtlMs = positiveDuration(
      options.stepUpTtlMs ?? DEFAULT_STEP_UP_TTL_MS,
      'step-up TTL',
    );
    this.#ceremonies = new CeremonyManager(
      options.verifier ?? new SimpleWebAuthnCeremonyVerifier(),
      this.origin,
      this.rpId,
      ceremonyTtlMs,
    );
    this.#sessions = new SessionManager(this.store, sessionTtlMs, stepUpTtlMs);
  }

  async registrationOptions(): Promise<{
    readonly accountId: string;
    readonly ceremonyId: string;
    readonly expiresAt: string;
    readonly options: PublicKeyCredentialCreationOptionsJSON;
  }> {
    const now = this.#now();
    const accountId = randomAccountId();
    const userHandle = Uint8Array.from(secureRandomBytes(32));
    const options = await newAccountRegistrationOptions(
      this.#relyingPartyOptions(),
      accountId,
      userHandle,
    );
    const ceremony = this.#ceremonies.create('register-account', options.challenge, now, accountId);
    await this.store.createProvisionalAccount(
      {
        accountId,
        webauthnUserHandle: userHandle,
        status: 'pending',
        createdAt: now.toISOString(),
      },
      ceremony,
    );
    return {
      accountId,
      ceremonyId: ceremony.ceremonyId,
      expiresAt: ceremony.expiresAt,
      options,
    };
  }

  async verifyFirstRegistration(input: {
    readonly accountId: string;
    readonly ceremonyId: string;
    readonly response: RegistrationResponseJSON;
  }): Promise<{ readonly credential: CredentialRecord; readonly session: IssuedSession }> {
    const now = this.#now();
    const account = await this.store.getAccount(input.accountId);
    const ceremony = await this.store.consumeCeremony({
      ceremonyId: input.ceremonyId,
      purpose: 'register-account',
      accountId: input.accountId,
      now: now.toISOString(),
    });
    if (account?.status !== 'pending' || ceremony === undefined) {
      throw ceremonyUnavailable();
    }
    const verified = await this.#ceremonies.verifyRegistration(input.response, ceremony);
    const credential = credentialFromVerification(account.accountId, verified, now);
    await this.store.finalizeFirstCredential(account.accountId, credential, now.toISOString());
    return {
      credential,
      session: await this.#sessions.create(account.accountId, now, true),
    };
  }

  async authenticationOptions(): Promise<{
    readonly ceremonyId: string;
    readonly expiresAt: string;
    readonly options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const now = this.#now();
    const options = await discoverableAuthenticationOptions(this.#relyingPartyOptions());
    const ceremony = this.#ceremonies.create('authenticate', options.challenge, now);
    await this.store.putCeremony(ceremony);
    return {
      ceremonyId: ceremony.ceremonyId,
      expiresAt: ceremony.expiresAt,
      options,
    };
  }

  async verifyAuthentication(input: {
    readonly ceremonyId: string;
    readonly response: AuthenticationResponseJSON;
  }): Promise<{ readonly credential: CredentialRecord; readonly session: IssuedSession }> {
    const now = this.#now();
    const credential = await this.store.getCredential(input.response.id);
    const account =
      credential === undefined ? undefined : await this.store.getAccount(credential.accountId);
    const ceremony = await this.store.consumeCeremony({
      ceremonyId: input.ceremonyId,
      purpose: 'authenticate',
      ...(account === undefined ? {} : { accountId: account.accountId }),
      now: now.toISOString(),
    });
    if (
      ceremony === undefined ||
      credential === undefined ||
      credential?.revokedAt !== undefined ||
      account?.status !== 'active' ||
      !discoverableUserHandleMatches(input.response, account.webauthnUserHandle)
    ) {
      throw verificationFailed();
    }
    const verified = await this.#ceremonies.verifyAuthentication(
      input.response,
      ceremony,
      credential,
    );
    const updated = await this.#updateCredential(credential, verified, now);
    return {
      credential: updated,
      session: await this.#sessions.create(account.accountId, now, false),
    };
  }

  async stepUpOptions(authenticated: AuthenticatedSession): Promise<{
    readonly ceremonyId: string;
    readonly expiresAt: string;
    readonly options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const now = this.#now();
    const credentials = (await this.store.listCredentials(authenticated.account.accountId)).filter(
      (credential) => credential.revokedAt === undefined,
    );
    if (credentials.length === 0) {
      throw new AuthServiceError('No active credential is available.', 'credential-unavailable');
    }
    const options = await accountAuthenticationOptions(this.#relyingPartyOptions(), credentials);
    const ceremony = this.#ceremonies.create(
      'step-up',
      options.challenge,
      now,
      authenticated.account.accountId,
    );
    await this.store.putCeremony(ceremony);
    return {
      ceremonyId: ceremony.ceremonyId,
      expiresAt: ceremony.expiresAt,
      options,
    };
  }

  async verifyStepUp(
    authenticated: AuthenticatedSession,
    input: {
      readonly ceremonyId: string;
      readonly response: AuthenticationResponseJSON;
    },
  ): Promise<{ readonly credential: CredentialRecord; readonly session: IssuedSession }> {
    const now = this.#now();
    const credential = await this.store.getCredential(input.response.id);
    const ceremony = await this.store.consumeCeremony({
      ceremonyId: input.ceremonyId,
      purpose: 'step-up',
      accountId: authenticated.account.accountId,
      now: now.toISOString(),
    });
    if (
      ceremony === undefined ||
      credential === undefined ||
      credential.accountId !== authenticated.account.accountId ||
      credential.revokedAt !== undefined
    ) {
      throw verificationFailed();
    }
    const verified = await this.#ceremonies.verifyAuthentication(
      input.response,
      ceremony,
      credential,
    );
    const updated = await this.#updateCredential(credential, verified, now);
    return {
      credential: updated,
      session: await this.#sessions.rotate(authenticated.session, now, true),
    };
  }

  async additionalCredentialOptions(authenticated: AuthenticatedSession): Promise<{
    readonly ceremonyId: string;
    readonly expiresAt: string;
    readonly options: PublicKeyCredentialCreationOptionsJSON;
  }> {
    this.assertFreshStepUp(authenticated.session);
    const now = this.#now();
    const credentials = await this.store.listCredentials(authenticated.account.accountId);
    const options = await additionalCredentialOptions(
      this.#relyingPartyOptions(),
      authenticated.account,
      credentials,
    );
    const ceremony = this.#ceremonies.create(
      'add-credential',
      options.challenge,
      now,
      authenticated.account.accountId,
    );
    await this.store.putCeremony(ceremony);
    return {
      ceremonyId: ceremony.ceremonyId,
      expiresAt: ceremony.expiresAt,
      options,
    };
  }

  async verifyAdditionalCredential(
    authenticated: AuthenticatedSession,
    input: {
      readonly ceremonyId: string;
      readonly response: RegistrationResponseJSON;
    },
  ): Promise<CredentialRecord> {
    this.assertFreshStepUp(authenticated.session);
    const now = this.#now();
    const ceremony = await this.store.consumeCeremony({
      ceremonyId: input.ceremonyId,
      purpose: 'add-credential',
      accountId: authenticated.account.accountId,
      now: now.toISOString(),
    });
    if (ceremony === undefined) throw ceremonyUnavailable();
    const verified = await this.#ceremonies.verifyRegistration(input.response, ceremony);
    const credential = credentialFromVerification(authenticated.account.accountId, verified, now);
    await this.store.addCredential(authenticated.account.accountId, credential);
    return credential;
  }

  async resolveSession(cookieValue: string | undefined): Promise<AuthenticatedSession | undefined> {
    return this.#sessions.resolve(cookieValue, this.#now());
  }

  requireSession(
    authenticated: AuthenticatedSession | undefined,
  ): asserts authenticated is AuthenticatedSession {
    if (authenticated === undefined) {
      throw new AuthServiceError('An authenticated session is required.', 'session-required');
    }
  }

  validateSessionCsrf(authenticated: AuthenticatedSession, token: string): void {
    if (!this.#sessions.validateCsrf(authenticated.session, token)) {
      throw new AuthServiceError('CSRF token is invalid.', 'csrf-invalid');
    }
  }

  assertFreshStepUp(session: SessionRecord): void {
    if (!this.#sessions.isFreshStepUp(session, this.#now())) {
      throw new AuthServiceError(
        'A fresh user-verifying passkey assertion is required.',
        'step-up-required',
      );
    }
  }

  listCredentials(accountId: string): Promise<readonly CredentialRecord[]> {
    return this.store.listCredentials(accountId);
  }

  async revokeCredential(
    authenticated: AuthenticatedSession,
    credentialId: string,
  ): Promise<CredentialRecord> {
    this.assertFreshStepUp(authenticated.session);
    return this.store.revokeCredential(
      authenticated.account.accountId,
      credentialId,
      this.#now().toISOString(),
    );
  }

  async logout(authenticated: AuthenticatedSession): Promise<void> {
    await this.#sessions.revoke(authenticated.session.sessionId, this.#now());
  }

  async putKeyBundle(
    authenticated: AuthenticatedSession,
    credentialId: string,
    input: unknown,
  ): Promise<StoredKeyBundle> {
    const credential = await this.store.getCredential(credentialId);
    if (
      credential === undefined ||
      credential.accountId !== authenticated.account.accountId ||
      credential.revokedAt !== undefined
    ) {
      throw new AuthServiceError('Credential is unavailable.', 'credential-unavailable');
    }
    const bundle = await validateKeyBundle(input, credentialId);
    const stored: StoredKeyBundle = {
      accountId: authenticated.account.accountId,
      credentialId,
      keyKind: bundle.keyKind,
      publicKey: bundle.publicKey,
      bundle,
      updatedAt: this.#now().toISOString(),
    };
    await this.store.putKeyBundle(stored);
    return stored;
  }

  listKeyBundles(accountId: string): Promise<readonly StoredKeyBundle[]> {
    return this.store.listKeyBundles(accountId);
  }

  #relyingPartyOptions(): {
    readonly rpName: string;
    readonly rpId: string;
    readonly timeout: number;
  } {
    return {
      rpName: this.rpName,
      rpId: this.rpId,
      timeout: this.#ceremonies.timeout,
    };
  }

  async #updateCredential(
    credential: CredentialRecord,
    verified: VerifiedAuthentication,
    now: Date,
  ): Promise<CredentialRecord> {
    assertAuthenticationResult(verified);
    return this.store.updateCredentialAfterAuthentication({
      credentialId: credential.credentialId,
      previousCounter: credential.counter,
      newCounter: verified.newCounter,
      deviceType: verified.deviceType,
      backedUp: verified.backedUp,
      usedAt: now.toISOString(),
    });
  }
}

function positiveDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 86_400_000) {
    throw new TypeError(`${label} must be between one second and one day.`);
  }
  return value;
}

function ceremonyUnavailable(): AuthServiceError {
  return new AuthServiceError(
    'Ceremony is expired, consumed, mismatched, or unavailable.',
    'ceremony-unavailable',
  );
}

function verificationFailed(cause?: unknown): AuthServiceError {
  return new AuthServiceError(
    'WebAuthn verification failed.',
    'verification-failed',
    cause === undefined ? undefined : { cause },
  );
}

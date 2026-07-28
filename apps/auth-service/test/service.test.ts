import { describe, expect, it } from 'vitest';

import {
  AuthService,
  MemoryAuthStore,
  parseSessionCookie,
  type CredentialAuthenticationUpdate,
  type CredentialRecord,
  type SessionRecord,
} from '../src/index.js';
import {
  authenticationResponse,
  credentialId,
  FakeCeremonyVerifier,
  registrationResponse,
  wrappedKeyBundle,
} from './fixtures.js';

describe('WebAuthn ceremony service', () => {
  it('issues strict discoverable registration and consumes its challenge once', async () => {
    const fixture = serviceFixture();
    const issued = await fixture.service.registrationOptions();

    expect(issued.accountId).toMatch(/^acct_[A-Za-z0-9_-]{22}$/u);
    expect(issued.ceremonyId).toMatch(/^cer_[A-Za-z0-9_-]{22}$/u);
    expect(issued.options).toMatchObject({
      rp: { id: 'localhost', name: 'WokeSocial Test' },
      user: {
        name: issued.accountId,
        displayName: 'WokeSocial account',
      },
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      excludeCredentials: [],
    });
    expect(issued.options.user.id).not.toContain(issued.accountId);

    const id = credentialId(11);
    const bundle = await wrappedKeyBundle(id);
    const registered = await fixture.service.verifyFirstRegistration({
      accountId: issued.accountId,
      ceremonyId: issued.ceremonyId,
      response: registrationResponse(id),
      bundle,
    });
    expect(registered.credential).toMatchObject({
      accountId: issued.accountId,
      credentialId: id,
      counter: 0,
      deviceType: 'multiDevice',
      backedUp: false,
    });
    expect(fixture.verifier.registrationCalls).toHaveLength(1);
    expect(fixture.verifier.registrationCalls[0]).toMatchObject({
      origin: 'http://localhost:4300',
      rpId: 'localhost',
    });
    expect(fixture.verifier.registrationCalls[0]?.challengeHash).toHaveLength(32);

    const parsedCookie = parseSessionCookie(registered.session.cookieValue);
    expect(parsedCookie).toBeDefined();
    const stored = await fixture.store.getSession(registered.session.session.sessionId);
    expect(stored?.secretHash).not.toEqual(new TextEncoder().encode(parsedCookie?.secret ?? ''));
    await expect(
      fixture.service.verifyFirstRegistration({
        accountId: issued.accountId,
        ceremonyId: issued.ceremonyId,
        response: registrationResponse(id),
        bundle,
      }),
    ).rejects.toMatchObject({ code: 'ceremony-unavailable' });
    expect(fixture.verifier.registrationCalls).toHaveLength(1);
  });

  it('authenticates discoverably, checks the user handle, and updates counter and backup state', async () => {
    const fixture = serviceFixture();
    const registered = await register(fixture, credentialId(12));
    const issued = await fixture.service.authenticationOptions();
    expect(issued.options).toMatchObject({
      rpId: 'localhost',
      allowCredentials: [],
      userVerification: 'required',
    });

    const result = await fixture.service.verifyAuthentication({
      ceremonyId: issued.ceremonyId,
      response: authenticationResponse(
        registered.credential.credentialId,
        registered.options.user.id,
      ),
    });
    expect(result.credential).toMatchObject({
      counter: 1,
      backedUp: true,
      deviceType: 'multiDevice',
      lastUsedAt: fixture.now().toISOString(),
    });
    expect(fixture.verifier.authenticationCalls[0]).toMatchObject({
      origin: 'http://localhost:4300',
      rpId: 'localhost',
      credential: { counter: 0 },
    });
    await expect(
      fixture.service.verifyAuthentication({
        ceremonyId: (await fixture.service.authenticationOptions()).ceremonyId,
        response: authenticationResponse(registered.credential.credentialId),
      }),
    ).rejects.toMatchObject({ code: 'verification-failed' });

    fixture.verifier.nextAuthentication = { newCounter: 0 };
    const rollbackCeremony = await fixture.service.authenticationOptions();
    await expect(
      fixture.service.verifyAuthentication({
        ceremonyId: rollbackCeremony.ceremonyId,
        response: authenticationResponse(
          registered.credential.credentialId,
          registered.options.user.id,
        ),
      }),
    ).rejects.toMatchObject({ code: 'verification-failed' });
    await expect(
      fixture.store.getCredential(registered.credential.credentialId),
    ).resolves.toMatchObject({ counter: 1, backedUp: true });
  });

  it('expires ceremonies and burns a challenge before a failing verifier can be retried', async () => {
    const fixture = serviceFixture();
    const registered = await register(fixture, credentialId(13));
    const expired = await fixture.service.authenticationOptions();
    fixture.advance(5 * 60_000 + 1);
    await expect(
      fixture.service.verifyAuthentication({
        ceremonyId: expired.ceremonyId,
        response: authenticationResponse(
          registered.credential.credentialId,
          registered.options.user.id,
        ),
      }),
    ).rejects.toMatchObject({ code: 'verification-failed' });
    expect(fixture.verifier.authenticationCalls).toHaveLength(0);

    const oneTime = await fixture.service.authenticationOptions();
    fixture.verifier.failNextAuthentication = true;
    const input = {
      ceremonyId: oneTime.ceremonyId,
      response: authenticationResponse(
        registered.credential.credentialId,
        registered.options.user.id,
      ),
    };
    await expect(fixture.service.verifyAuthentication(input)).rejects.toMatchObject({
      code: 'verification-failed',
    });
    await expect(fixture.service.verifyAuthentication(input)).rejects.toMatchObject({
      code: 'verification-failed',
    });
    expect(fixture.verifier.authenticationCalls).toHaveLength(1);
  });

  it('requires fresh step-up, supports multiple passkeys, and protects the last credential', async () => {
    const fixture = serviceFixture();
    const first = await register(fixture, credentialId(14));
    const authenticated = await fixture.service.resolveSession(first.session.cookieValue);
    expect(authenticated).toBeDefined();
    if (authenticated === undefined) throw new Error('Expected registration session.');

    const addOptions = await fixture.service.additionalCredentialOptions(authenticated);
    expect(addOptions.options.excludeCredentials).toMatchObject([
      { id: first.credential.credentialId },
    ]);
    const second = await fixture.service.verifyAdditionalCredential(authenticated, {
      ceremonyId: addOptions.ceremonyId,
      response: registrationResponse(credentialId(15)),
      bundle: await wrappedKeyBundle(credentialId(15)),
    });
    expect(await fixture.service.listCredentials(first.credential.accountId)).toHaveLength(2);
    await expect(
      fixture.service.listKeyBundles(authenticated.account.accountId),
    ).resolves.toHaveLength(2);

    await expect(
      fixture.service.revokeCredential(authenticated, first.credential.credentialId),
    ).resolves.toMatchObject({ revokedAt: fixture.now().toISOString() });
    await expect(
      fixture.service.resolveSession(first.session.cookieValue),
    ).resolves.toBeUndefined();
    await expect(
      fixture.service.listKeyBundles(authenticated.account.accountId),
    ).resolves.toMatchObject([{ credentialId: second.credentialId }]);
    await expect(
      fixture.service.revokeCredential(authenticated, second.credentialId),
    ).rejects.toMatchObject({ code: 'last-credential' });
  });

  it('requires a new step-up after normal authentication and rotates the session on step-up', async () => {
    const fixture = serviceFixture();
    const registered = await register(fixture, credentialId(16));
    const authentication = await fixture.service.authenticationOptions();
    const loggedIn = await fixture.service.verifyAuthentication({
      ceremonyId: authentication.ceremonyId,
      response: authenticationResponse(
        registered.credential.credentialId,
        registered.options.user.id,
      ),
    });
    const authenticated = await fixture.service.resolveSession(loggedIn.session.cookieValue);
    if (authenticated === undefined) throw new Error('Expected authenticated session.');
    await expect(fixture.service.additionalCredentialOptions(authenticated)).rejects.toMatchObject({
      code: 'step-up-required',
    });

    const stepUp = await fixture.service.stepUpOptions(authenticated);
    const stepped = await fixture.service.verifyStepUp(authenticated, {
      ceremonyId: stepUp.ceremonyId,
      response: authenticationResponse(registered.credential.credentialId),
    });
    expect(stepped.session.cookieValue).not.toBe(loggedIn.session.cookieValue);
    await expect(
      fixture.service.resolveSession(loggedIn.session.cookieValue),
    ).resolves.toBeUndefined();
    const fresh = await fixture.service.resolveSession(stepped.session.cookieValue);
    expect(fresh?.session.stepUpAt).toBe(fixture.now().toISOString());
  });

  it('rejects duplicate credential IDs globally and revokes or expires sessions', async () => {
    const fixture = serviceFixture();
    const first = await register(fixture, credentialId(17));
    const otherOptions = await fixture.service.registrationOptions();
    await expect(
      fixture.service.verifyFirstRegistration({
        accountId: otherOptions.accountId,
        ceremonyId: otherOptions.ceremonyId,
        response: registrationResponse(first.credential.credentialId),
        bundle: await wrappedKeyBundle(first.credential.credentialId),
      }),
    ).rejects.toMatchObject({ code: 'credential-duplicate' });

    const authenticated = await fixture.service.resolveSession(first.session.cookieValue);
    if (authenticated === undefined) throw new Error('Expected registration session.');
    await fixture.service.logout(authenticated);
    await expect(
      fixture.service.resolveSession(first.session.cookieValue),
    ).resolves.toBeUndefined();

    const third = await register(fixture, credentialId(18));
    fixture.advance(8 * 60 * 60_000 + 1);
    await expect(
      fixture.service.resolveSession(third.session.cookieValue),
    ).resolves.toBeUndefined();
  });

  it('does not activate accounts for malformed or credential-misbound root wrappers', async () => {
    const fixture = serviceFixture();
    const malformedCiphertextId = credentialId(20);
    const malformedCiphertext = await wrappedKeyBundle(malformedCiphertextId);
    const attempts: readonly { readonly id: string; readonly bundle: unknown }[] = [
      { id: credentialId(19), bundle: { version: 1 } },
      { id: credentialId(21), bundle: await wrappedKeyBundle(credentialId(22)) },
      {
        id: malformedCiphertextId,
        bundle: {
          ...malformedCiphertext,
          encryptedKey: {
            ...malformedCiphertext.encryptedKey,
            ciphertext: malformedCiphertext.encryptedKey.ciphertext.slice(1),
          },
        },
      },
    ];

    for (const attempt of attempts) {
      const issued = await fixture.service.registrationOptions();
      await expect(
        fixture.service.verifyFirstRegistration({
          accountId: issued.accountId,
          ceremonyId: issued.ceremonyId,
          response: registrationResponse(attempt.id),
          bundle: attempt.bundle,
        }),
      ).rejects.toMatchObject({ code: 'bundle-invalid' });
      await expect(fixture.store.getAccount(issued.accountId)).resolves.toMatchObject({
        status: 'pending',
      });
      await expect(fixture.store.getCredential(attempt.id)).resolves.toBeUndefined();
      await expect(fixture.store.listKeyBundles(issued.accountId)).resolves.toEqual([]);
    }
  });

  it('rejects a second passkey wrapper for a different account root atomically', async () => {
    const fixture = serviceFixture();
    const first = await register(fixture, credentialId(21));
    const authenticated = await fixture.service.resolveSession(first.session.cookieValue);
    if (authenticated === undefined) throw new Error('Expected registration session.');

    const secondId = credentialId(22);
    const addOptions = await fixture.service.additionalCredentialOptions(authenticated);
    await expect(
      fixture.service.verifyAdditionalCredential(authenticated, {
        ceremonyId: addOptions.ceremonyId,
        response: registrationResponse(secondId),
        bundle: await wrappedKeyBundle(secondId, { publicKey: bytes(120, 32) }),
      }),
    ).rejects.toMatchObject({ code: 'bundle-invalid' });

    await expect(fixture.store.getCredential(secondId)).resolves.toBeUndefined();
    await expect(
      fixture.store.listCredentials(authenticated.account.accountId),
    ).resolves.toHaveLength(1);
    await expect(
      fixture.store.listKeyBundles(authenticated.account.accountId),
    ).resolves.toHaveLength(1);
  });

  it('cannot issue a session after the authenticating credential is concurrently revoked', async () => {
    const store = new PausingMemoryAuthStore();
    const fixture = serviceFixture(store);
    const first = await register(fixture, credentialId(23));
    const authenticated = await fixture.service.resolveSession(first.session.cookieValue);
    if (authenticated === undefined) throw new Error('Expected registration session.');
    const secondId = credentialId(24);
    const addOptions = await fixture.service.additionalCredentialOptions(authenticated);
    await fixture.service.verifyAdditionalCredential(authenticated, {
      ceremonyId: addOptions.ceremonyId,
      response: registrationResponse(secondId),
      bundle: await wrappedKeyBundle(secondId),
    });

    const loginOptions = await fixture.service.authenticationOptions();
    store.pauseNextAuthentication();
    const login = fixture.service.verifyAuthentication({
      ceremonyId: loginOptions.ceremonyId,
      response: authenticationResponse(first.credential.credentialId, first.options.user.id),
    });
    await store.authenticationEntered;
    const rejected = expect(login).rejects.toMatchObject({ code: 'verification-failed' });
    await fixture.service.revokeCredential(authenticated, first.credential.credentialId);
    store.releaseAuthentication();
    await rejected;

    expect(store.candidateSessionId).toBeDefined();
    await expect(store.getSession(store.candidateSessionId ?? '')).resolves.toBeUndefined();
    await expect(store.getCredential(first.credential.credentialId)).resolves.toMatchObject({
      revokedAt: fixture.now().toISOString(),
    });
  });
});

interface ServiceFixture {
  readonly service: AuthService;
  readonly store: MemoryAuthStore;
  readonly verifier: FakeCeremonyVerifier;
  readonly now: () => Date;
  readonly advance: (milliseconds: number) => void;
}

function serviceFixture(store: MemoryAuthStore = new MemoryAuthStore()): ServiceFixture {
  const verifier = new FakeCeremonyVerifier();
  let current = Date.parse('2026-07-28T18:00:00.000Z');
  const now = () => new Date(current);
  return {
    store,
    verifier,
    now,
    advance: (milliseconds) => {
      current += milliseconds;
    },
    service: new AuthService({
      store,
      verifier,
      now,
      rpName: 'WokeSocial Test',
      rpId: 'localhost',
      origin: 'http://localhost:4300',
    }),
  };
}

async function register(fixture: ServiceFixture, id: string) {
  const options = await fixture.service.registrationOptions();
  const result = await fixture.service.verifyFirstRegistration({
    accountId: options.accountId,
    ceremonyId: options.ceremonyId,
    response: registrationResponse(id),
    bundle: await wrappedKeyBundle(id),
  });
  return { ...result, options: options.options };
}

function bytes(seed: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (seed + index) & 0xff);
}

class PausingMemoryAuthStore extends MemoryAuthStore {
  readonly #entered = deferredSignal();
  readonly #release = deferredSignal();
  #pause = false;
  candidateSessionId: string | undefined;

  get authenticationEntered(): Promise<void> {
    return this.#entered.promise;
  }

  pauseNextAuthentication(): void {
    this.#pause = true;
  }

  releaseAuthentication(): void {
    this.#release.resolve();
  }

  override async completeAuthentication(
    update: CredentialAuthenticationUpdate,
    session: SessionRecord,
  ): Promise<CredentialRecord> {
    if (this.#pause) {
      this.#pause = false;
      this.candidateSessionId = session.sessionId;
      this.#entered.resolve();
      await this.#release.promise;
    }
    return super.completeAuthentication(update, session);
  }
}

function deferredSignal(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = () => settle();
  });
  return { promise, resolve };
}

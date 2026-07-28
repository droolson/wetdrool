import { describe, expect, it } from 'vitest';

import { wrapPasskeyAccountKey } from '@socially-woke/crypto';

import { AuthService, MemoryAuthStore, parseSessionCookie } from '../src/index.js';
import {
  authenticationResponse,
  credentialId,
  FakeCeremonyVerifier,
  registrationResponse,
} from './fixtures.js';

describe('WebAuthn ceremony service', () => {
  it('issues strict discoverable registration and consumes its challenge once', async () => {
    const fixture = serviceFixture();
    const issued = await fixture.service.registrationOptions();

    expect(issued.accountId).toMatch(/^acct_[A-Za-z0-9_-]{22}$/u);
    expect(issued.ceremonyId).toMatch(/^cer_[A-Za-z0-9_-]{22}$/u);
    expect(issued.options).toMatchObject({
      rp: { id: 'localhost', name: 'Socially Woke Test' },
      user: {
        name: issued.accountId,
        displayName: 'Socially Woke account',
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
    const registered = await fixture.service.verifyFirstRegistration({
      accountId: issued.accountId,
      ceremonyId: issued.ceremonyId,
      response: registrationResponse(id),
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
    });
    expect(await fixture.service.listCredentials(first.credential.accountId)).toHaveLength(2);

    const credentialBytes = Uint8Array.from(
      Buffer.from(first.credential.credentialId, 'base64url'),
    );
    const bundle = await wrapPasskeyAccountKey({
      prfOutput: bytes(1, 32),
      credentialId: credentialBytes,
      accountKeySeed: bytes(40, 32),
      publicKey: bytes(80, 32),
      keyKind: 'solana-ed25519-root-seed',
    });
    await expect(
      fixture.service.putKeyBundle(authenticated, first.credential.credentialId, bundle),
    ).resolves.toMatchObject({ keyKind: 'solana-ed25519-root-seed' });
    await expect(
      fixture.service.listKeyBundles(authenticated.account.accountId),
    ).resolves.toHaveLength(1);

    await expect(
      fixture.service.revokeCredential(authenticated, first.credential.credentialId),
    ).resolves.toMatchObject({ revokedAt: fixture.now().toISOString() });
    await expect(
      fixture.service.resolveSession(first.session.cookieValue),
    ).resolves.toBeUndefined();
    await expect(fixture.service.listKeyBundles(authenticated.account.accountId)).resolves.toEqual(
      [],
    );
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

  it('rejects malformed or credential-misbound encrypted bundles', async () => {
    const fixture = serviceFixture();
    const registered = await register(fixture, credentialId(19));
    const authenticated = await fixture.service.resolveSession(registered.session.cookieValue);
    if (authenticated === undefined) throw new Error('Expected registration session.');

    await expect(
      fixture.service.putKeyBundle(authenticated, registered.credential.credentialId, {
        version: 1,
      }),
    ).rejects.toMatchObject({ code: 'bundle-invalid' });

    const bundle = await wrapPasskeyAccountKey({
      prfOutput: bytes(3, 32),
      credentialId: bytes(8, 32),
      accountKeySeed: bytes(40, 32),
      publicKey: bytes(80, 32),
      keyKind: 'solana-ed25519-root-seed',
    });
    await expect(
      fixture.service.putKeyBundle(authenticated, registered.credential.credentialId, bundle),
    ).rejects.toMatchObject({ code: 'bundle-invalid' });

    const validBundle = await wrapPasskeyAccountKey({
      prfOutput: bytes(3, 32),
      credentialId: Uint8Array.from(Buffer.from(registered.credential.credentialId, 'base64url')),
      accountKeySeed: bytes(40, 32),
      publicKey: bytes(80, 32),
      keyKind: 'solana-ed25519-root-seed',
    });
    await expect(
      fixture.service.putKeyBundle(authenticated, registered.credential.credentialId, {
        ...validBundle,
        encryptedKey: {
          ...validBundle.encryptedKey,
          ciphertext: validBundle.encryptedKey.ciphertext.slice(1),
        },
      }),
    ).rejects.toMatchObject({ code: 'bundle-invalid' });
  });
});

interface ServiceFixture {
  readonly service: AuthService;
  readonly store: MemoryAuthStore;
  readonly verifier: FakeCeremonyVerifier;
  readonly now: () => Date;
  readonly advance: (milliseconds: number) => void;
}

function serviceFixture(): ServiceFixture {
  const store = new MemoryAuthStore();
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
      rpName: 'Socially Woke Test',
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
  });
  return { ...result, options: options.options };
}

function bytes(seed: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (seed + index) & 0xff);
}

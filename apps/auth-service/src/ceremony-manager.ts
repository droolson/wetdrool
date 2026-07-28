import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

import { assertRegistrationResult } from './credential-state.js';
import { AuthServiceError } from './errors.js';
import type { CeremonyPurpose, CeremonyRecord, CredentialRecord } from './models.js';
import { hashChallenge, randomCeremonyId } from './security.js';
import type {
  CeremonyVerifier,
  VerifiedAuthentication,
  VerifiedRegistration,
} from './webauthn-verifier.js';

export class CeremonyManager {
  constructor(
    private readonly verifier: CeremonyVerifier,
    private readonly origin: string,
    private readonly rpId: string,
    readonly timeout: number,
  ) {}

  create(
    purpose: CeremonyPurpose,
    challenge: string,
    now: Date,
    accountId?: string,
  ): CeremonyRecord {
    return {
      ceremonyId: randomCeremonyId(),
      purpose,
      ...(accountId === undefined ? {} : { accountId }),
      challengeHash: hashChallenge(challenge),
      expiresAt: new Date(now.getTime() + this.timeout).toISOString(),
      attempts: 0,
      maxAttempts: 1,
      createdAt: now.toISOString(),
    };
  }

  async verifyRegistration(
    response: RegistrationResponseJSON,
    ceremony: CeremonyRecord,
  ): Promise<VerifiedRegistration> {
    try {
      const verified = await this.verifier.verifyRegistration({
        response,
        challengeHash: ceremony.challengeHash,
        origin: this.origin,
        rpId: this.rpId,
      });
      assertRegistrationResult(response.id, verified);
      return verified;
    } catch (error) {
      throw verificationFailed(error);
    }
  }

  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    ceremony: CeremonyRecord,
    credential: CredentialRecord,
  ): Promise<VerifiedAuthentication> {
    try {
      const verified = await this.verifier.verifyAuthentication({
        response,
        challengeHash: ceremony.challengeHash,
        origin: this.origin,
        rpId: this.rpId,
        credential: {
          id: credential.credentialId,
          publicKey: credential.publicKey.slice(),
          counter: credential.counter,
          transports: [...credential.transports],
        },
      });
      if (verified.credentialId !== response.id) throw new Error('Credential ID mismatch.');
      return verified;
    } catch (error) {
      throw verificationFailed(error);
    }
  }
}

function verificationFailed(cause?: unknown): AuthServiceError {
  return new AuthServiceError(
    'WebAuthn verification failed.',
    'verification-failed',
    cause === undefined ? undefined : { cause },
  );
}

import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type CredentialDeviceType,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';

import { equalHash, hashChallenge } from './security.js';

export interface VerifiedRegistration {
  readonly credentialId: string;
  readonly publicKey: Uint8Array;
  readonly counter: number;
  readonly transports: readonly AuthenticatorTransportFuture[];
  readonly deviceType: CredentialDeviceType;
  readonly backedUp: boolean;
}

export interface VerifiedAuthentication {
  readonly credentialId: string;
  readonly newCounter: number;
  readonly deviceType: CredentialDeviceType;
  readonly backedUp: boolean;
}

export interface RegistrationVerificationInput {
  readonly response: RegistrationResponseJSON;
  readonly challengeHash: Uint8Array;
  readonly origin: string;
  readonly rpId: string;
}

export interface AuthenticationVerificationInput {
  readonly response: AuthenticationResponseJSON;
  readonly challengeHash: Uint8Array;
  readonly origin: string;
  readonly rpId: string;
  readonly credential: WebAuthnCredential;
}

export interface CeremonyVerifier {
  verifyRegistration(input: RegistrationVerificationInput): Promise<VerifiedRegistration>;
  verifyAuthentication(input: AuthenticationVerificationInput): Promise<VerifiedAuthentication>;
}

export class SimpleWebAuthnCeremonyVerifier implements CeremonyVerifier {
  async verifyRegistration(input: RegistrationVerificationInput): Promise<VerifiedRegistration> {
    const result = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: async (challenge) =>
        equalHash(hashChallenge(challenge), input.challengeHash),
      expectedOrigin: input.origin,
      expectedRPID: input.rpId,
      expectedType: 'webauthn.create',
      requireUserPresence: true,
      requireUserVerification: true,
    });
    if (
      !result.verified ||
      !result.registrationInfo.userVerified ||
      result.registrationInfo.origin !== input.origin ||
      result.registrationInfo.rpID !== input.rpId
    ) {
      throw new Error('WebAuthn registration verification failed.');
    }
    return {
      credentialId: result.registrationInfo.credential.id,
      publicKey: result.registrationInfo.credential.publicKey.slice(),
      counter: result.registrationInfo.credential.counter,
      transports: [...(result.registrationInfo.credential.transports ?? [])],
      deviceType: result.registrationInfo.credentialDeviceType,
      backedUp: result.registrationInfo.credentialBackedUp,
    };
  }

  async verifyAuthentication(
    input: AuthenticationVerificationInput,
  ): Promise<VerifiedAuthentication> {
    const result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: async (challenge) =>
        equalHash(hashChallenge(challenge), input.challengeHash),
      expectedOrigin: input.origin,
      expectedRPID: input.rpId,
      expectedType: 'webauthn.get',
      credential: input.credential,
      requireUserVerification: true,
      advancedFIDOConfig: { userVerification: 'required' },
    });
    if (
      !result.verified ||
      !result.authenticationInfo.userVerified ||
      result.authenticationInfo.origin !== input.origin ||
      result.authenticationInfo.rpID !== input.rpId ||
      result.authenticationInfo.credentialID !== input.credential.id
    ) {
      throw new Error('WebAuthn authentication verification failed.');
    }
    return {
      credentialId: result.authenticationInfo.credentialID,
      newCounter: result.authenticationInfo.newCounter,
      deviceType: result.authenticationInfo.credentialDeviceType,
      backedUp: result.authenticationInfo.credentialBackedUp,
    };
  }
}

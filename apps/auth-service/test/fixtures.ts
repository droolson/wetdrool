import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import {
  wrapPasskeyAccountKey,
  type PasskeyAccountKeyKind,
  type PasskeyWrappedKeyBundle,
} from '@wetdrool/crypto';

import type {
  AuthenticationVerificationInput,
  CeremonyVerifier,
  RegistrationVerificationInput,
  VerifiedAuthentication,
  VerifiedRegistration,
} from '../src/webauthn-verifier.js';

export class FakeCeremonyVerifier implements CeremonyVerifier {
  readonly registrationCalls: RegistrationVerificationInput[] = [];
  readonly authenticationCalls: AuthenticationVerificationInput[] = [];
  failNextRegistration = false;
  failNextAuthentication = false;
  nextRegistration: Partial<VerifiedRegistration> | undefined;
  nextAuthentication: Partial<VerifiedAuthentication> | undefined;

  async verifyRegistration(input: RegistrationVerificationInput): Promise<VerifiedRegistration> {
    this.registrationCalls.push(input);
    if (this.failNextRegistration) {
      this.failNextRegistration = false;
      throw new Error('Injected registration failure.');
    }
    const override = this.nextRegistration;
    this.nextRegistration = undefined;
    return {
      credentialId: input.response.id,
      publicKey: Uint8Array.from({ length: 77 }, (_, index) => index + 1),
      counter: 0,
      transports: input.response.response.transports ?? ['internal'],
      deviceType: 'multiDevice',
      backedUp: false,
      ...override,
    };
  }

  async verifyAuthentication(
    input: AuthenticationVerificationInput,
  ): Promise<VerifiedAuthentication> {
    this.authenticationCalls.push(input);
    if (this.failNextAuthentication) {
      this.failNextAuthentication = false;
      throw new Error('Injected authentication failure.');
    }
    const override = this.nextAuthentication;
    this.nextAuthentication = undefined;
    return {
      credentialId: input.response.id,
      newCounter: input.credential.counter + 1,
      deviceType: 'multiDevice',
      backedUp: true,
      ...override,
    };
  }
}

export function credentialId(seed: number): string {
  return Buffer.from(Uint8Array.from({ length: 32 }, () => seed)).toString('base64url');
}

export function registrationResponse(id: string): RegistrationResponseJSON {
  return {
    id,
    rawId: id,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    clientExtensionResults: {},
    response: {
      clientDataJSON: 'AA',
      attestationObject: 'AA',
      transports: ['internal', 'hybrid'],
    },
  };
}

export function authenticationResponse(
  id: string,
  userHandle?: string,
): AuthenticationResponseJSON {
  return {
    id,
    rawId: id,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    clientExtensionResults: {},
    response: {
      clientDataJSON: 'AA',
      authenticatorData: 'AA',
      signature: 'AA',
      ...(userHandle === undefined ? {} : { userHandle }),
    },
  };
}

export async function wrappedKeyBundle(
  id: string,
  options: {
    readonly keyKind?: PasskeyAccountKeyKind;
    readonly publicKey?: Uint8Array;
    readonly seed?: Uint8Array;
  } = {},
): Promise<PasskeyWrappedKeyBundle> {
  return wrapPasskeyAccountKey({
    prfOutput: fixtureBytes(1, 32),
    credentialId: Uint8Array.from(Buffer.from(id, 'base64url')),
    accountKeySeed: options.seed ?? fixtureBytes(40, 32),
    publicKey: options.publicKey ?? fixtureBytes(80, 32),
    keyKind: options.keyKind ?? 'solana-ed25519-root-seed',
  });
}

function fixtureBytes(seed: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (seed + index) & 0xff);
}

import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

import type { CredentialRecord } from './models.js';
import { decodeBase64Url, equalHash } from './security.js';
import type { VerifiedAuthentication, VerifiedRegistration } from './webauthn-verifier.js';

const MAX_WEBAUTHN_COUNTER = 4_294_967_295;

export function credentialFromVerification(
  accountId: string,
  verified: VerifiedRegistration,
  now: Date,
): CredentialRecord {
  assertRegistrationResult(verified.credentialId, verified);
  return {
    credentialId: verified.credentialId,
    accountId,
    publicKey: verified.publicKey.slice(),
    counter: verified.counter,
    transports: [...verified.transports],
    deviceType: verified.deviceType,
    backedUp: verified.backedUp,
    createdAt: now.toISOString(),
  };
}

export function assertRegistrationResult(
  expectedCredentialId: string,
  verified: VerifiedRegistration,
): void {
  if (
    verified.credentialId !== expectedCredentialId ||
    decodeBase64Url(verified.credentialId, 1_023) === undefined ||
    verified.publicKey.byteLength < 1 ||
    verified.publicKey.byteLength > 2_048
  ) {
    throw new Error('Verified registration returned invalid credential material.');
  }
  assertCredentialState(verified.counter, verified.deviceType, verified.backedUp);
}

export function assertAuthenticationResult(verified: VerifiedAuthentication): void {
  assertCredentialState(verified.newCounter, verified.deviceType, verified.backedUp);
}

export function discoverableUserHandleMatches(
  response: AuthenticationResponseJSON,
  expected: Uint8Array,
): boolean {
  const encoded = response.response.userHandle;
  const actual = encoded === undefined ? undefined : decodeBase64Url(encoded, 64);
  return actual !== undefined && equalHash(actual, expected);
}

function assertCredentialState(
  counter: number,
  deviceType: 'singleDevice' | 'multiDevice',
  backedUp: boolean,
): void {
  if (
    !Number.isSafeInteger(counter) ||
    counter < 0 ||
    counter > MAX_WEBAUTHN_COUNTER ||
    (deviceType === 'singleDevice' && backedUp)
  ) {
    throw new Error('Verified WebAuthn credential state is invalid.');
  }
}

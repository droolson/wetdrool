import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { secureRandomBytes } from '@wetdrool/crypto';

import type { AccountRecord, CredentialRecord } from './models.js';

interface RelyingPartyOptions {
  readonly rpName: string;
  readonly rpId: string;
  readonly timeout: number;
}

export function newAccountRegistrationOptions(
  relyingParty: RelyingPartyOptions,
  accountId: string,
  userHandle: Uint8Array,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: relyingParty.rpName,
    rpID: relyingParty.rpId,
    userName: accountId,
    userDisplayName: 'WetDrool account',
    userID: Uint8Array.from(userHandle),
    challenge: randomChallenge(),
    attestationType: 'none',
    authenticatorSelection: passkeySelection(),
    excludeCredentials: [],
    timeout: relyingParty.timeout,
  });
}

export function discoverableAuthenticationOptions(
  relyingParty: RelyingPartyOptions,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: relyingParty.rpId,
    challenge: randomChallenge(),
    allowCredentials: [],
    userVerification: 'required',
    timeout: relyingParty.timeout,
  });
}

export function accountAuthenticationOptions(
  relyingParty: RelyingPartyOptions,
  credentials: readonly CredentialRecord[],
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: relyingParty.rpId,
    challenge: randomChallenge(),
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: [...credential.transports],
    })),
    userVerification: 'required',
    timeout: relyingParty.timeout,
  });
}

export function additionalCredentialOptions(
  relyingParty: RelyingPartyOptions,
  account: AccountRecord,
  credentials: readonly CredentialRecord[],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: relyingParty.rpName,
    rpID: relyingParty.rpId,
    userName: account.accountId,
    userDisplayName: 'WetDrool account',
    userID: Uint8Array.from(account.webauthnUserHandle),
    challenge: randomChallenge(),
    attestationType: 'none',
    authenticatorSelection: passkeySelection(),
    excludeCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: [...credential.transports],
    })),
    timeout: relyingParty.timeout,
  });
}

function randomChallenge(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(secureRandomBytes(32));
}

function passkeySelection() {
  return {
    residentKey: 'required' as const,
    requireResidentKey: true,
    userVerification: 'required' as const,
  };
}

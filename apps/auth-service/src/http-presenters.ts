import type { CredentialRecord, SessionRecord } from './models.js';
import type { AuthService } from './service.js';

export function publicCredential(credential: CredentialRecord) {
  return {
    credentialId: credential.credentialId,
    transports: credential.transports,
    deviceType: credential.deviceType,
    backedUp: credential.backedUp,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt ?? null,
    revokedAt: credential.revokedAt ?? null,
  };
}

export function publicSession(session: SessionRecord) {
  return {
    expiresAt: session.expiresAt,
    lastAuthenticatedAt: session.lastAuthenticatedAt,
    stepUpAt: session.stepUpAt ?? null,
  };
}

export function policyBody(service: AuthService) {
  return {
    replaceable: true,
    canonical: false,
    rpId: service.rpId,
    origin: service.origin,
    userVerification: 'required',
    attestation: 'none',
    discoverableAuthentication: true,
    protocolIdentity: false,
    solanaSigning: false,
    serverKeyCustody: false,
    prfAcceptedByServer: false,
    plaintextKeysAcceptedByServer: false,
    encryptedCredentialBoundBundleSync: true,
    credentialRevocationSessionPolicy: 'revoke-all-account-sessions',
    emailRecovery: false,
    recoveryPath: 'unsupported',
    lastCredentialRevocation: 'disabled-without-reviewed-recovery',
  };
}

export function authenticatedCapabilities() {
  return {
    protocolIdentityEstablished: false,
    solanaSigningAvailableFromServer: false,
    credentialManagement: 'requires-fresh-step-up',
    encryptedBundleSync: true,
    recovery: 'unsupported',
  };
}

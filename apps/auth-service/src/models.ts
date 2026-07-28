import type { AuthenticatorTransportFuture, CredentialDeviceType } from '@simplewebauthn/server';
import type { PasskeyWrappedKeyBundle } from '@wokesocial/crypto';

export type CeremonyPurpose = 'register-account' | 'authenticate' | 'step-up' | 'add-credential';

export interface AccountRecord {
  readonly accountId: string;
  readonly webauthnUserHandle: Uint8Array;
  readonly status: 'pending' | 'active';
  readonly createdAt: string;
  readonly activatedAt?: string;
}

export interface CeremonyRecord {
  readonly ceremonyId: string;
  readonly purpose: CeremonyPurpose;
  readonly accountId?: string;
  readonly challengeHash: Uint8Array;
  readonly expiresAt: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly consumedAt?: string;
}

export interface CredentialRecord {
  readonly credentialId: string;
  readonly accountId: string;
  readonly publicKey: Uint8Array;
  readonly counter: number;
  readonly transports: readonly AuthenticatorTransportFuture[];
  readonly deviceType: CredentialDeviceType;
  readonly backedUp: boolean;
  readonly createdAt: string;
  readonly lastUsedAt?: string;
  readonly revokedAt?: string;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly accountId: string;
  readonly secretHash: Uint8Array;
  readonly csrfHash: Uint8Array;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastAuthenticatedAt: string;
  readonly stepUpAt?: string;
  readonly revokedAt?: string;
}

export interface StoredKeyBundle {
  readonly accountId: string;
  readonly credentialId: string;
  readonly keyKind: PasskeyWrappedKeyBundle['keyKind'];
  readonly publicKey: string;
  readonly bundle: PasskeyWrappedKeyBundle;
  readonly updatedAt: string;
}

export interface CredentialAuthenticationUpdate {
  readonly credentialId: string;
  readonly previousCounter: number;
  readonly newCounter: number;
  readonly deviceType: CredentialDeviceType;
  readonly backedUp: boolean;
  readonly usedAt: string;
}

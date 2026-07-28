import { sha256 } from './hash.js';

export const PASSKEY_PRF_EVALUATION_INPUT_VERSION = 1 as const;

export interface PasskeyPrfEvaluationInput {
  readonly version: typeof PASSKEY_PRF_EVALUATION_INPUT_VERSION;
  readonly first: Uint8Array;
}

const PURPOSE = new TextEncoder().encode('account-key-wrap');

/**
 * Returns the stable, versioned WebAuthn PRF evaluation input used for
 * passkey-wrapped account keys. The authenticator still produces a distinct
 * credential-scoped result; this public input is not key material.
 */
export async function createPasskeyPrfEvaluationInput(): Promise<PasskeyPrfEvaluationInput> {
  return {
    version: PASSKEY_PRF_EVALUATION_INPUT_VERSION,
    first: await sha256({
      domain: 'socially-woke/auth/webauthn-prf-evaluation-input/v1',
      data: PURPOSE,
    }),
  };
}

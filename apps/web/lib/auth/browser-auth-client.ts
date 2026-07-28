import { ed25519 } from '@noble/curves/ed25519.js';
import {
  createPasskeyPrfEvaluationInput,
  secureRandomBytes,
  unwrapPasskeyAccountKey,
  wrapPasskeyAccountKey,
  type PasskeyWrappedKeyBundle,
  type UnwrapPasskeyAccountKeyInput,
  type WrapPasskeyAccountKeyInput,
} from '@socially-woke/crypto';

import { AuthApiClient, type AuthApiClientOptions, type AuthSessionView } from './auth-api';
import { BrowserAuthError, passkeyPromptError } from './errors';
import {
  authenticationResponseForServer,
  decodeBase64Url,
  encodeBase64Url,
  extractPrfOutput,
  registrationResponseForServer,
  withPrfEvaluation,
} from './passkey-codec';

export type EmbeddedKeyFallbackReason =
  'bundle-missing-or-invalid' | 'bundle-sync-failed' | 'prf-unsupported';

export type EmbeddedKeyState =
  | {
      readonly status: 'ready';
      readonly publicKey: string;
      readonly lifecycle: 'generated-wrapped-and-cleared' | 'unwrapped-verified-and-cleared';
    }
  | {
      readonly status: 'fallback-required';
      readonly reason: EmbeddedKeyFallbackReason;
      readonly safeFallbacks: readonly ['external-wallet', 'reviewed-encrypted-recovery-kit'];
    };

export interface BrowserAuthFlowResult {
  readonly accountId: string;
  readonly credentialId: string;
  readonly key: EmbeddedKeyState;
  readonly protocolIdentityEstablished: false;
}

export interface PasskeyPlatform {
  parseCreationOptions(
    options: PublicKeyCredentialCreationOptionsJSON,
  ): PublicKeyCredentialCreationOptions;
  parseRequestOptions(
    options: PublicKeyCredentialRequestOptionsJSON,
  ): PublicKeyCredentialRequestOptions;
  create(options: PublicKeyCredentialCreationOptions): Promise<Credential | null>;
  get(options: PublicKeyCredentialRequestOptions): Promise<Credential | null>;
}

export interface LocalKeyOperations {
  randomBytes(length: number): Uint8Array;
  publicKeyFromSeed(seed: Uint8Array): Uint8Array;
  wrap(input: WrapPasskeyAccountKeyInput): Promise<PasskeyWrappedKeyBundle>;
  unwrap(input: UnwrapPasskeyAccountKeyInput): Promise<Uint8Array>;
}

export interface BrowserAuthClientOptions extends AuthApiClientOptions {
  readonly platform?: PasskeyPlatform;
  readonly keyOperations?: LocalKeyOperations;
}

export class BrowserAuthClient {
  readonly api: AuthApiClient;
  readonly #platform: PasskeyPlatform;
  readonly #keyOperations: LocalKeyOperations;

  constructor(options: BrowserAuthClientOptions) {
    this.api = new AuthApiClient(options);
    this.#platform = options.platform ?? browserPasskeyPlatform();
    this.#keyOperations = options.keyOperations ?? defaultKeyOperations;
  }

  session(): Promise<AuthSessionView | undefined> {
    return this.api.session();
  }

  logout(): Promise<void> {
    return this.api.logout();
  }

  async register(): Promise<BrowserAuthFlowResult> {
    const issued = await this.api.registrationOptions();
    const evaluation = await createPasskeyPrfEvaluationInput();
    let credential: PublicKeyCredential;
    try {
      const options = withPrfEvaluation(
        this.#platform.parseCreationOptions(issued.options),
        evaluation.first,
      );
      credential = publicKeyCredential(await this.#prompt(() => this.#platform.create(options)));
    } finally {
      evaluation.first.fill(0);
    }

    const prfOutput = extractPrfOutput(credential);
    try {
      const verified = await this.api.verifyRegistration({
        accountId: issued.accountId,
        ceremonyId: issued.ceremonyId,
        response: registrationResponseForServer(credential),
      });
      assertVerifiedCredential(credential.id, issued.accountId, verified);
      if (prfOutput === undefined) {
        return authResult(verified, fallback('prf-unsupported'));
      }
      return authResult(verified, await this.#createAndSynchronizeKey(credential.id, prfOutput));
    } finally {
      prfOutput?.fill(0);
    }
  }

  async signIn(): Promise<BrowserAuthFlowResult> {
    const issued = await this.api.authenticationOptions();
    const evaluation = await createPasskeyPrfEvaluationInput();
    let credential: PublicKeyCredential;
    try {
      const options = withPrfEvaluation(
        this.#platform.parseRequestOptions(issued.options),
        evaluation.first,
      );
      credential = publicKeyCredential(await this.#prompt(() => this.#platform.get(options)));
    } finally {
      evaluation.first.fill(0);
    }

    const prfOutput = extractPrfOutput(credential);
    try {
      const verified = await this.api.verifyAuthentication({
        ceremonyId: issued.ceremonyId,
        response: authenticationResponseForServer(credential),
      });
      assertVerifiedCredential(credential.id, undefined, verified);
      if (prfOutput === undefined) {
        return authResult(verified, fallback('prf-unsupported'));
      }
      return authResult(verified, await this.#unlockSynchronizedKey(credential.id, prfOutput));
    } finally {
      prfOutput?.fill(0);
    }
  }

  async #createAndSynchronizeKey(
    credentialId: string,
    prfOutput: Uint8Array,
  ): Promise<EmbeddedKeyState> {
    const seed = this.#keyOperations.randomBytes(32);
    let publicKey: Uint8Array | undefined;
    try {
      if (seed.byteLength !== 32) return fallback('bundle-sync-failed');
      publicKey = Uint8Array.from(this.#keyOperations.publicKeyFromSeed(seed));
      if (publicKey.byteLength !== 32) return fallback('bundle-sync-failed');
      const bundle = await this.#keyOperations.wrap({
        prfOutput,
        credentialId: decodeBase64Url(credentialId, 1_023),
        accountKeySeed: seed,
        publicKey,
        keyKind: 'solana-ed25519-root-seed',
      });
      try {
        await this.api.synchronizeBundle(credentialId, bundle);
      } catch {
        return fallback('bundle-sync-failed');
      }
      return {
        status: 'ready',
        publicKey: bundle.publicKey,
        lifecycle: 'generated-wrapped-and-cleared',
      };
    } catch {
      return fallback('bundle-sync-failed');
    } finally {
      seed.fill(0);
      publicKey?.fill(0);
    }
  }

  async #unlockSynchronizedKey(
    credentialId: string,
    prfOutput: Uint8Array,
  ): Promise<EmbeddedKeyState> {
    let bundles;
    try {
      bundles = await this.api.bundles();
    } catch {
      return fallback('bundle-missing-or-invalid');
    }
    const matches = bundles.filter(
      (stored) =>
        stored.credentialId === credentialId &&
        bundleString(stored.bundle, 'keyKind') === 'solana-ed25519-root-seed',
    );
    if (matches.length !== 1) return fallback('bundle-missing-or-invalid');
    const bundle = matches[0]?.bundle;
    const expectedPublicKey = bundleString(bundle, 'publicKey');
    if (expectedPublicKey === undefined) return fallback('bundle-missing-or-invalid');

    let seed: Uint8Array | undefined;
    let actualPublicKey: Uint8Array | undefined;
    let expectedPublicKeyBytes: Uint8Array | undefined;
    try {
      seed = await this.#keyOperations.unwrap({
        prfOutput,
        credentialId: decodeBase64Url(credentialId, 1_023),
        bundle,
      });
      if (seed.byteLength !== 32) return fallback('bundle-missing-or-invalid');
      actualPublicKey = Uint8Array.from(this.#keyOperations.publicKeyFromSeed(seed));
      expectedPublicKeyBytes = decodeBase64Url(expectedPublicKey, 32);
      if (
        actualPublicKey.byteLength !== 32 ||
        !constantTimeEqual(actualPublicKey, expectedPublicKeyBytes)
      ) {
        return fallback('bundle-missing-or-invalid');
      }
      return {
        status: 'ready',
        publicKey: encodeBase64Url(actualPublicKey),
        lifecycle: 'unwrapped-verified-and-cleared',
      };
    } catch {
      return fallback('bundle-missing-or-invalid');
    } finally {
      seed?.fill(0);
      actualPublicKey?.fill(0);
      expectedPublicKeyBytes?.fill(0);
    }
  }

  async #prompt(operation: () => Promise<Credential | null>): Promise<Credential | null> {
    try {
      return await operation();
    } catch (error) {
      throw passkeyPromptError(error);
    }
  }
}

const defaultKeyOperations: LocalKeyOperations = {
  randomBytes: secureRandomBytes,
  publicKeyFromSeed: (seed) => Uint8Array.from(ed25519.getPublicKey(seed)),
  wrap: wrapPasskeyAccountKey,
  unwrap: unwrapPasskeyAccountKey,
};

function browserPasskeyPlatform(): PasskeyPlatform {
  if (
    typeof globalThis.PublicKeyCredential === 'undefined' ||
    typeof globalThis.PublicKeyCredential.parseCreationOptionsFromJSON !== 'function' ||
    typeof globalThis.PublicKeyCredential.parseRequestOptionsFromJSON !== 'function' ||
    typeof globalThis.navigator === 'undefined' ||
    globalThis.navigator.credentials === undefined
  ) {
    throw new BrowserAuthError('browser-unsupported');
  }
  return {
    parseCreationOptions: (options) =>
      globalThis.PublicKeyCredential.parseCreationOptionsFromJSON(options),
    parseRequestOptions: (options) =>
      globalThis.PublicKeyCredential.parseRequestOptionsFromJSON(options),
    create: (options) => globalThis.navigator.credentials.create({ publicKey: options }),
    get: (options) => globalThis.navigator.credentials.get({ publicKey: options }),
  };
}

function publicKeyCredential(value: Credential | null): PublicKeyCredential {
  if (
    value === null ||
    value.type !== 'public-key' ||
    !('rawId' in value) ||
    !(value.rawId instanceof ArrayBuffer) ||
    !('response' in value) ||
    !('getClientExtensionResults' in value) ||
    typeof value.getClientExtensionResults !== 'function'
  ) {
    throw new BrowserAuthError('credential-invalid');
  }
  return value as PublicKeyCredential;
}

function assertVerifiedCredential(
  credentialId: string,
  expectedAccountId: string | undefined,
  verified: { readonly accountId: string; readonly credentialId: string },
): void {
  if (
    verified.credentialId !== credentialId ||
    (expectedAccountId !== undefined && verified.accountId !== expectedAccountId)
  ) {
    throw new BrowserAuthError('server-invalid');
  }
}

function authResult(
  verified: { readonly accountId: string; readonly credentialId: string },
  key: EmbeddedKeyState,
): BrowserAuthFlowResult {
  return {
    accountId: verified.accountId,
    credentialId: verified.credentialId,
    key,
    protocolIdentityEstablished: false,
  };
}

function fallback(reason: EmbeddedKeyFallbackReason): EmbeddedKeyState {
  return {
    status: 'fallback-required',
    reason,
    safeFallbacks: ['external-wallet', 'reviewed-encrypted-recovery-kit'],
  };
}

function bundleString(bundle: unknown, field: string): string | undefined {
  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) return undefined;
  const value = (bundle as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

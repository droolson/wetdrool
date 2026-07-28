import { ed25519 } from '@noble/curves/ed25519.js';
import {
  createPasskeyPrfEvaluationInput,
  secureRandomBytes,
  unwrapPasskeyAccountKey,
  wrapPasskeyAccountKey,
  type PasskeyWrappedKeyBundle,
  type UnwrapPasskeyAccountKeyInput,
  type WrapPasskeyAccountKeyInput,
} from '@wokesocial/crypto';

import {
  AuthApiClient,
  type AuthApiClientOptions,
  type AuthSessionView,
  type PasskeyCredentialView,
} from './auth-api';
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

  listPasskeys(): Promise<readonly PasskeyCredentialView[]> {
    return this.api.credentials();
  }

  async register(): Promise<BrowserAuthFlowResult> {
    const issued = await this.api.registrationOptions();
    const credential = await this.#createCredentialWithPrf(issued.options);
    const prfOutput = extractPrfOutput(credential);
    if (prfOutput === undefined) {
      throw new BrowserAuthError('prf-required');
    }
    try {
      const prepared = await this.#prepareNewRootBundle(credential.id, prfOutput);
      const verified = await this.api.verifyRegistration({
        accountId: issued.accountId,
        ceremonyId: issued.ceremonyId,
        response: registrationResponseForServer(credential),
        bundle: prepared.bundle,
      });
      assertVerifiedCredential(credential.id, issued.accountId, verified);
      return authResult(verified, prepared.key);
    } finally {
      prfOutput.fill(0);
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

  async addPasskeyForExistingRoot(): Promise<PasskeyCredentialView> {
    const stepped = await this.#freshStepUp(true);
    try {
      const issued = await this.api.additionalRegistrationOptions();
      const credential = await this.#createCredentialWithPrf(issued.options);
      const newPrfOutput = extractPrfOutput(credential);
      if (newPrfOutput === undefined) {
        throw new BrowserAuthError('prf-required');
      }

      let root:
        | {
            readonly publicKey: Uint8Array;
            readonly seed: Uint8Array;
          }
        | undefined;
      try {
        root = await this.#unwrapSynchronizedRoot(stepped.credentialId, stepped.prfOutput);
        let bundle: PasskeyWrappedKeyBundle;
        try {
          bundle = await this.#keyOperations.wrap({
            prfOutput: newPrfOutput,
            credentialId: decodeBase64Url(credential.id, 1_023),
            accountKeySeed: root.seed,
            publicKey: root.publicKey,
            keyKind: 'solana-ed25519-root-seed',
          });
        } catch {
          throw new BrowserAuthError('key-wrapper-failed');
        }
        const added = await this.api.verifyAdditionalRegistration({
          ceremonyId: issued.ceremonyId,
          response: registrationResponseForServer(credential),
          bundle,
        });
        if (added.credentialId !== credential.id || added.revokedAt !== undefined) {
          throw new BrowserAuthError('server-invalid');
        }
        return added;
      } finally {
        root?.seed.fill(0);
        root?.publicKey.fill(0);
        newPrfOutput.fill(0);
      }
    } finally {
      stepped.prfOutput.fill(0);
    }
  }

  async revokePasskey(credentialId: string): Promise<PasskeyCredentialView> {
    await this.#freshStepUp(false);
    return this.api.revokeCredential(credentialId);
  }

  async #prepareNewRootBundle(
    credentialId: string,
    prfOutput: Uint8Array,
  ): Promise<{ readonly bundle: PasskeyWrappedKeyBundle; readonly key: EmbeddedKeyState }> {
    const seed = this.#keyOperations.randomBytes(32);
    let publicKey: Uint8Array | undefined;
    try {
      if (seed.byteLength !== 32) throw new BrowserAuthError('key-wrapper-failed');
      publicKey = Uint8Array.from(this.#keyOperations.publicKeyFromSeed(seed));
      if (publicKey.byteLength !== 32) throw new BrowserAuthError('key-wrapper-failed');
      const bundle = await this.#keyOperations.wrap({
        prfOutput,
        credentialId: decodeBase64Url(credentialId, 1_023),
        accountKeySeed: seed,
        publicKey,
        keyKind: 'solana-ed25519-root-seed',
      });
      return {
        bundle,
        key: {
          status: 'ready',
          publicKey: bundle.publicKey,
          lifecycle: 'generated-wrapped-and-cleared',
        },
      };
    } catch (error) {
      if (error instanceof BrowserAuthError) throw error;
      throw new BrowserAuthError('key-wrapper-failed');
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

  async #unwrapSynchronizedRoot(
    credentialId: string,
    prfOutput: Uint8Array,
  ): Promise<{ readonly publicKey: Uint8Array; readonly seed: Uint8Array }> {
    let seed: Uint8Array | undefined;
    let publicKey: Uint8Array | undefined;
    let expectedPublicKey: Uint8Array | undefined;
    try {
      const bundles = await this.api.bundles();
      const matches = bundles.filter(
        (stored) =>
          stored.credentialId === credentialId &&
          bundleString(stored.bundle, 'keyKind') === 'solana-ed25519-root-seed',
      );
      if (matches.length !== 1) throw new BrowserAuthError('key-wrapper-invalid');
      const bundle = matches[0]?.bundle;
      const expectedPublicKeyString = bundleString(bundle, 'publicKey');
      if (expectedPublicKeyString === undefined) {
        throw new BrowserAuthError('key-wrapper-invalid');
      }
      seed = await this.#keyOperations.unwrap({
        prfOutput,
        credentialId: decodeBase64Url(credentialId, 1_023),
        bundle,
      });
      if (seed.byteLength !== 32) throw new BrowserAuthError('key-wrapper-invalid');
      publicKey = Uint8Array.from(this.#keyOperations.publicKeyFromSeed(seed));
      expectedPublicKey = decodeBase64Url(expectedPublicKeyString, 32);
      if (publicKey.byteLength !== 32 || !constantTimeEqual(publicKey, expectedPublicKey)) {
        throw new BrowserAuthError('key-wrapper-invalid');
      }
      expectedPublicKey.fill(0);
      expectedPublicKey = undefined;
      return { seed, publicKey };
    } catch (error) {
      seed?.fill(0);
      publicKey?.fill(0);
      expectedPublicKey?.fill(0);
      if (error instanceof BrowserAuthError) throw error;
      throw new BrowserAuthError('key-wrapper-invalid');
    }
  }

  async #createCredentialWithPrf(
    options: PublicKeyCredentialCreationOptionsJSON,
  ): Promise<PublicKeyCredential> {
    const evaluation = await createPasskeyPrfEvaluationInput();
    try {
      const parsed = withPrfEvaluation(
        this.#platform.parseCreationOptions(options),
        evaluation.first,
      );
      return publicKeyCredential(await this.#prompt(() => this.#platform.create(parsed)));
    } finally {
      evaluation.first.fill(0);
    }
  }

  async #freshStepUp(
    requirePrf: true,
  ): Promise<{ readonly credentialId: string; readonly prfOutput: Uint8Array }>;
  async #freshStepUp(requirePrf: false): Promise<{ readonly credentialId: string }>;
  async #freshStepUp(
    requirePrf: boolean,
  ): Promise<{ readonly credentialId: string; readonly prfOutput?: Uint8Array }> {
    const issued = await this.api.stepUpOptions();
    let evaluation: Awaited<ReturnType<typeof createPasskeyPrfEvaluationInput>> | undefined;
    let credential: PublicKeyCredential;
    try {
      const parsed = this.#platform.parseRequestOptions(issued.options);
      if (requirePrf) {
        evaluation = await createPasskeyPrfEvaluationInput();
      }
      const options =
        evaluation === undefined ? parsed : withPrfEvaluation(parsed, evaluation.first);
      credential = publicKeyCredential(await this.#prompt(() => this.#platform.get(options)));
    } finally {
      evaluation?.first.fill(0);
    }
    const prfOutput = requirePrf ? extractPrfOutput(credential) : undefined;
    if (requirePrf && prfOutput === undefined) {
      throw new BrowserAuthError('prf-required');
    }
    try {
      const verified = await this.api.verifyStepUp({
        ceremonyId: issued.ceremonyId,
        response: authenticationResponseForServer(credential),
      });
      if (verified.credentialId !== credential.id || verified.revokedAt !== undefined) {
        throw new BrowserAuthError('server-invalid');
      }
      return {
        credentialId: credential.id,
        ...(prfOutput === undefined ? {} : { prfOutput }),
      };
    } catch (error) {
      prfOutput?.fill(0);
      throw error;
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

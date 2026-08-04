import type { PasskeyWrappedKeyBundle } from '@wetdrool/crypto';

import {
  decodeBase64Url,
  type AuthenticationResponseForServer,
  type RegistrationResponseForServer,
} from './passkey-codec';
import { BrowserAuthError } from './errors';

const CSRF_STORAGE_VERSION = 'v1';
const ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9_-]{22}$/u;
const CEREMONY_ID_PATTERN = /^cer_[A-Za-z0-9_-]{22}$/u;
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{2,1364}$/u;
const LEGACY_REDIRECT_HOSTS = new Set(['droolhouse.com', 'www.droolhouse.com']);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,86}$/u;
const AUTHENTICATOR_TRANSPORTS = new Set([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]);

function normalizeDnsHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, '');
}

export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RegistrationOptionsResult {
  readonly accountId: string;
  readonly ceremonyId: string;
  readonly options: PublicKeyCredentialCreationOptionsJSON;
}

export interface AuthenticationOptionsResult {
  readonly ceremonyId: string;
  readonly options: PublicKeyCredentialRequestOptionsJSON;
}

export interface AdditionalRegistrationOptionsResult {
  readonly ceremonyId: string;
  readonly options: PublicKeyCredentialCreationOptionsJSON;
}

export interface VerifiedSessionResult {
  readonly accountId: string;
  readonly credentialId: string;
}

export interface PasskeyCredentialView {
  readonly credentialId: string;
  readonly transports: readonly string[];
  readonly deviceType: 'multiDevice' | 'singleDevice';
  readonly backedUp: boolean;
  readonly createdAt: string;
  readonly lastUsedAt?: string;
  readonly revokedAt?: string;
}

export interface AuthSessionView {
  readonly accountId: string;
  readonly expiresAt: string;
  readonly lastAuthenticatedAt: string;
  readonly stepUpAt?: string;
}

export interface SynchronizedBundle {
  readonly credentialId: string;
  readonly bundle: unknown;
  readonly updatedAt: string;
}

export interface AuthApiClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly tokenStorage?: TokenStorage;
}

export class AuthApiClient {
  readonly baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #storage: TokenStorage;
  readonly #storageKey: string;
  #accountId: string | undefined;
  #csrfToken: string | undefined;

  constructor(options: AuthApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#storage = options.tokenStorage ?? browserSessionStorage();
    this.#storageKey = `wetdrool.auth.csrf.${CSRF_STORAGE_VERSION}:${encodeURIComponent(this.baseUrl)}`;
    let stored: string | null = null;
    try {
      stored = this.#storage.getItem(this.#storageKey);
    } catch {
      // Web Storage can be denied even when passkeys and cookies remain usable.
    }
    this.#csrfToken = stored !== null && TOKEN_PATTERN.test(stored) ? stored : undefined;
  }

  async registrationOptions(): Promise<RegistrationOptionsResult> {
    const csrfToken = await this.#bootstrapCsrf();
    const value = await this.#json('/v1/registration/options', {
      method: 'POST',
      headers: mutationHeaders(csrfToken),
      body: '{}',
    });
    const record = objectValue(value);
    return {
      accountId: stringValue(record['accountId'], ACCOUNT_ID_PATTERN),
      ceremonyId: stringValue(record['ceremonyId'], CEREMONY_ID_PATTERN),
      options: creationOptionsValue(record['options']),
    };
  }

  async verifyRegistration(input: {
    readonly accountId: string;
    readonly ceremonyId: string;
    readonly response: RegistrationResponseForServer;
    readonly bundle: PasskeyWrappedKeyBundle;
  }): Promise<VerifiedSessionResult> {
    const value = await this.#mutationJson('/v1/registration/verify', {
      accountId: input.accountId,
      ceremonyId: input.ceremonyId,
      response: input.response,
      bundle: ciphertextBundle(input.bundle),
    });
    return this.#verifiedSession(value);
  }

  async authenticationOptions(): Promise<AuthenticationOptionsResult> {
    const csrfToken = await this.#bootstrapCsrf();
    const value = await this.#json('/v1/authentication/options', {
      method: 'POST',
      headers: mutationHeaders(csrfToken),
      body: '{}',
    });
    const record = objectValue(value);
    return {
      ceremonyId: stringValue(record['ceremonyId'], CEREMONY_ID_PATTERN),
      options: requestOptionsValue(record['options']),
    };
  }

  async verifyAuthentication(input: {
    readonly ceremonyId: string;
    readonly response: AuthenticationResponseForServer;
  }): Promise<VerifiedSessionResult> {
    const value = await this.#mutationJson('/v1/authentication/verify', {
      ceremonyId: input.ceremonyId,
      response: input.response,
    });
    return this.#verifiedSession(value);
  }

  async stepUpOptions(): Promise<AuthenticationOptionsResult> {
    const value = await this.#mutationJson('/v1/step-up/options', {});
    const record = objectValue(value);
    return {
      ceremonyId: stringValue(record['ceremonyId'], CEREMONY_ID_PATTERN),
      options: requestOptionsValue(record['options']),
    };
  }

  async verifyStepUp(input: {
    readonly ceremonyId: string;
    readonly response: AuthenticationResponseForServer;
  }): Promise<PasskeyCredentialView> {
    const value = await this.#mutationJson('/v1/step-up/verify', {
      ceremonyId: input.ceremonyId,
      response: input.response,
    });
    const record = objectValue(value);
    if (record['stepUp'] !== 'verified') {
      throw new BrowserAuthError('server-invalid');
    }
    const credential = credentialValue(record['credential']);
    this.#setCsrf(stringValue(record['csrfToken'], TOKEN_PATTERN));
    return credential;
  }

  async credentials(): Promise<readonly PasskeyCredentialView[]> {
    const value = await this.#json('/v1/credentials', { method: 'GET' });
    const record = objectValue(value);
    this.#rememberAccount(stringValue(record['accountId'], ACCOUNT_ID_PATTERN));
    if (!Array.isArray(record['credentials'])) {
      throw new BrowserAuthError('server-invalid');
    }
    return record['credentials'].map(credentialValue);
  }

  async additionalRegistrationOptions(): Promise<AdditionalRegistrationOptionsResult> {
    const value = await this.#mutationJson('/v1/credentials/registration/options', {});
    const record = objectValue(value);
    return {
      ceremonyId: stringValue(record['ceremonyId'], CEREMONY_ID_PATTERN),
      options: creationOptionsValue(record['options']),
    };
  }

  async verifyAdditionalRegistration(input: {
    readonly ceremonyId: string;
    readonly response: RegistrationResponseForServer;
    readonly bundle: PasskeyWrappedKeyBundle;
  }): Promise<PasskeyCredentialView> {
    const value = await this.#mutationJson('/v1/credentials/registration/verify', {
      ceremonyId: input.ceremonyId,
      response: input.response,
      bundle: ciphertextBundle(input.bundle),
    });
    return credentialValue(objectValue(value)['credential']);
  }

  async revokeCredential(credentialId: string): Promise<PasskeyCredentialView> {
    if (!CREDENTIAL_ID_PATTERN.test(credentialId)) {
      throw new BrowserAuthError('credential-invalid');
    }
    const value = await this.#mutationJson(
      `/v1/credentials/${encodeURIComponent(credentialId)}`,
      undefined,
      'DELETE',
    );
    const record = objectValue(value);
    if (
      record['synchronizedWrappersDeleted'] !== true ||
      record['sessionsRevoked'] !== true ||
      record['onchainDelegationRevocationRequiredSeparately'] !== true
    ) {
      throw new BrowserAuthError('server-invalid');
    }
    const credential = credentialValue(record['credential']);
    if (credential.credentialId !== credentialId || credential.revokedAt === undefined) {
      throw new BrowserAuthError('server-invalid');
    }
    this.#clearCsrf();
    return credential;
  }

  async session(): Promise<AuthSessionView | undefined> {
    const response = await this.#request('/v1/session', { method: 'GET' });
    if (response.status === 401) {
      this.#accountId = undefined;
      return undefined;
    }
    const value = await responseJson(response);
    if (!response.ok) throw serviceError();
    const record = objectValue(value);
    const session = objectValue(record['session']);
    const stepUpAt = optionalDateString(session['stepUpAt']);
    const accountId = stringValue(record['accountId'], ACCOUNT_ID_PATTERN);
    this.#rememberAccount(accountId);
    return {
      accountId,
      expiresAt: dateString(session['expiresAt']),
      lastAuthenticatedAt: dateString(session['lastAuthenticatedAt']),
      ...(stepUpAt === undefined ? {} : { stepUpAt }),
    };
  }

  async logout(): Promise<void> {
    const csrfToken = await this.#csrfForMutation();
    const response = await this.#request('/v1/logout', {
      method: 'POST',
      headers: mutationHeaders(csrfToken),
      body: '{}',
    });
    if (response.status !== 204) {
      await discardBody(response);
      throw serviceError();
    }
    this.#clearCsrf();
  }

  async bundles(): Promise<readonly SynchronizedBundle[]> {
    const value = await this.#json('/v1/key-bundles', { method: 'GET' });
    const record = objectValue(value);
    this.#rememberAccount(stringValue(record['accountId'], ACCOUNT_ID_PATTERN));
    if (record['ciphertextOnly'] !== true || !Array.isArray(record['bundles'])) {
      throw new BrowserAuthError('server-invalid');
    }
    return record['bundles'].map((item) => {
      const bundle = objectValue(item);
      return {
        credentialId: stringValue(bundle['credentialId'], CREDENTIAL_ID_PATTERN),
        bundle: bundle['bundle'],
        updatedAt: dateString(bundle['updatedAt']),
      };
    });
  }

  #verifiedSession(value: unknown): VerifiedSessionResult {
    const record = objectValue(value);
    const credential = credentialValue(record['credential']);
    if (credential.revokedAt !== undefined) {
      throw new BrowserAuthError('server-invalid');
    }
    const csrfToken = stringValue(record['csrfToken'], TOKEN_PATTERN);
    this.#setCsrf(csrfToken);
    const accountId = stringValue(record['accountId'], ACCOUNT_ID_PATTERN);
    this.#rememberAccount(accountId);
    return {
      accountId,
      credentialId: credential.credentialId,
    };
  }

  async #bootstrapCsrf(): Promise<string> {
    const value = await this.#json('/v1/csrf', { method: 'GET' });
    const csrfToken = stringValue(objectValue(value)['csrfToken'], TOKEN_PATTERN);
    this.#setCsrf(csrfToken);
    return csrfToken;
  }

  async #mutationJson(
    path: string,
    body: unknown,
    method: 'DELETE' | 'POST' = 'POST',
  ): Promise<unknown> {
    return this.#json(path, {
      method,
      headers: mutationHeaders(await this.#csrfForMutation(), body !== undefined),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async #json(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.#request(path, init);
    const value = await responseJson(response);
    if (!response.ok) throw serviceError();
    return value;
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    try {
      const headers = new Headers(init.headers);
      headers.set('accept', 'application/json');
      return await this.#fetch(new URL(path, this.baseUrl), {
        ...init,
        cache: 'no-store',
        credentials: 'include',
        headers,
      });
    } catch {
      throw new BrowserAuthError('network-unavailable');
    }
  }

  async #csrfForMutation(): Promise<string> {
    return this.#csrfToken ?? this.#bootstrapCsrf();
  }

  #setCsrf(token: string): void {
    this.#csrfToken = token;
    try {
      this.#storage.setItem(this.#storageKey, token);
    } catch {
      // In-memory CSRF state remains authoritative for this page lifetime.
    }
  }

  #clearCsrf(): void {
    this.#csrfToken = undefined;
    this.#accountId = undefined;
    try {
      this.#storage.removeItem(this.#storageKey);
    } catch {
      // Revocation/logout already completed; storage denial must not mask it.
    }
  }

  #rememberAccount(accountId: string): void {
    if (this.#accountId !== undefined && this.#accountId !== accountId) {
      throw new BrowserAuthError('server-invalid');
    }
    this.#accountId = accountId;
  }
}

export function ciphertextBundle(bundle: PasskeyWrappedKeyBundle): PasskeyWrappedKeyBundle {
  return {
    version: bundle.version,
    kdf: bundle.kdf,
    algorithm: bundle.algorithm,
    credentialBinding: bundle.credentialBinding,
    keyKind: bundle.keyKind,
    publicKey: bundle.publicKey,
    salt: bundle.salt,
    encryptedKey: {
      version: bundle.encryptedKey.version,
      algorithm: bundle.encryptedKey.algorithm,
      domain: bundle.encryptedKey.domain,
      nonce: bundle.encryptedKey.nonce,
      ciphertext: bundle.encryptedKey.ciphertext,
    },
  };
}

function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BrowserAuthError('origin-invalid');
  }
  const hostname = normalizeDnsHostname(url.hostname);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    LEGACY_REDIRECT_HOSTS.has(hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new BrowserAuthError('origin-invalid');
  }
  return `${url.origin}/`;
}

function browserSessionStorage(): TokenStorage {
  if (typeof globalThis.sessionStorage !== 'undefined') return globalThis.sessionStorage;
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

function mutationHeaders(csrfToken: string, hasJsonBody = true): HeadersInit {
  return hasJsonBody
    ? {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
      }
    : {
        'x-csrf-token': csrfToken,
      };
}

function creationOptionsValue(value: unknown): PublicKeyCredentialCreationOptionsJSON {
  const record = objectValue(value);
  const user = objectValue(record['user']);
  const relyingParty = objectValue(record['rp']);
  const selection = objectValue(record['authenticatorSelection']);
  const parameters = record['pubKeyCredParams'];
  if (
    !canonicalBase64Url(record['challenge'], 1_024) ||
    !canonicalBase64Url(user['id'], 64) ||
    !nonEmptyString(user['name'], 256) ||
    !nonEmptyString(user['displayName'], 256) ||
    !nonEmptyString(relyingParty['name'], 256) ||
    !nonEmptyString(relyingParty['id'], 253) ||
    record['attestation'] !== 'none' ||
    selection['residentKey'] !== 'required' ||
    selection['requireResidentKey'] !== true ||
    selection['userVerification'] !== 'required' ||
    !Array.isArray(parameters) ||
    parameters.length === 0 ||
    !parameters.every(validPublicKeyParameter) ||
    !validCredentialDescriptors(record['excludeCredentials']) ||
    !validTimeout(record['timeout'])
  ) {
    throw new BrowserAuthError('server-invalid');
  }
  return record as unknown as PublicKeyCredentialCreationOptionsJSON;
}

function requestOptionsValue(value: unknown): PublicKeyCredentialRequestOptionsJSON {
  const record = objectValue(value);
  if (
    !canonicalBase64Url(record['challenge'], 1_024) ||
    !nonEmptyString(record['rpId'], 253) ||
    record['userVerification'] !== 'required' ||
    !validCredentialDescriptors(record['allowCredentials']) ||
    !validTimeout(record['timeout'])
  ) {
    throw new BrowserAuthError('server-invalid');
  }
  return record as unknown as PublicKeyCredentialRequestOptionsJSON;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BrowserAuthError('server-invalid');
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new BrowserAuthError('server-invalid');
  }
  return value;
}

function dateString(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new BrowserAuthError('server-invalid');
  }
  return value;
}

function optionalDateString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : dateString(value);
}

function credentialValue(value: unknown): PasskeyCredentialView {
  const credential = objectValue(value);
  const transports = credential['transports'];
  const deviceType = credential['deviceType'];
  if (
    !Array.isArray(transports) ||
    !transports.every(
      (transport) => typeof transport === 'string' && AUTHENTICATOR_TRANSPORTS.has(transport),
    ) ||
    new Set(transports).size !== transports.length ||
    (deviceType !== 'multiDevice' && deviceType !== 'singleDevice') ||
    typeof credential['backedUp'] !== 'boolean'
  ) {
    throw new BrowserAuthError('server-invalid');
  }
  const lastUsedAt = optionalDateString(credential['lastUsedAt']);
  const revokedAt = optionalDateString(credential['revokedAt']);
  return {
    credentialId: stringValue(credential['credentialId'], CREDENTIAL_ID_PATTERN),
    transports,
    deviceType,
    backedUp: credential['backedUp'],
    createdAt: dateString(credential['createdAt']),
    ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
    ...(revokedAt === undefined ? {} : { revokedAt }),
  };
}

function canonicalBase64Url(value: unknown, maximumBytes: number): boolean {
  if (typeof value !== 'string') return false;
  try {
    decodeBase64Url(value, maximumBytes);
    return true;
  } catch {
    return false;
  }
}

function nonEmptyString(value: unknown, maximumLength: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function validTimeout(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 300_000;
}

function validPublicKeyParameter(value: unknown): boolean {
  const parameter = objectValue(value);
  return (
    parameter['type'] === 'public-key' &&
    typeof parameter['alg'] === 'number' &&
    Number.isInteger(parameter['alg'])
  );
}

function validCredentialDescriptors(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 256) return false;
  const identifiers = new Set<string>();
  for (const item of value) {
    const descriptor = objectValue(item);
    const id = descriptor['id'];
    const transports = descriptor['transports'];
    if (
      descriptor['type'] !== 'public-key' ||
      typeof id !== 'string' ||
      !canonicalBase64Url(id, 1_023) ||
      identifiers.has(id) ||
      (transports !== undefined &&
        (!Array.isArray(transports) ||
          transports.some(
            (transport) =>
              typeof transport !== 'string' || !AUTHENTICATOR_TRANSPORTS.has(transport),
          ) ||
          new Set(transports).size !== transports.length))
    ) {
      return false;
    }
    identifiers.add(id);
  }
  return true;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new BrowserAuthError('server-invalid');
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.text();
  } catch {
    // The response is already rejected by status; its body is intentionally ignored.
  }
}

function serviceError(): BrowserAuthError {
  return new BrowserAuthError('service-rejected');
}

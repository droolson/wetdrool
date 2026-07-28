import type { PasskeyWrappedKeyBundle } from '@socially-woke/crypto';

import type {
  AuthenticationResponseForServer,
  RegistrationResponseForServer,
} from './passkey-codec';
import { BrowserAuthError } from './errors';

const CSRF_STORAGE_VERSION = 'v1';
const ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9_-]{22}$/u;
const CEREMONY_ID_PATTERN = /^cer_[A-Za-z0-9_-]{22}$/u;
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{2,1364}$/u;
const LEGACY_REDIRECT_HOSTS = new Set(['sociallywoke.com', 'www.sociallywoke.com']);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,86}$/u;

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

export interface VerifiedSessionResult {
  readonly accountId: string;
  readonly credentialId: string;
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
  #csrfToken: string | undefined;

  constructor(options: AuthApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#storage = options.tokenStorage ?? browserSessionStorage();
    this.#storageKey = `socially-woke.auth.csrf.${CSRF_STORAGE_VERSION}:${encodeURIComponent(this.baseUrl)}`;
    const stored = this.#storage.getItem(this.#storageKey);
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
  }): Promise<VerifiedSessionResult> {
    const value = await this.#mutationJson('/v1/registration/verify', {
      accountId: input.accountId,
      ceremonyId: input.ceremonyId,
      response: input.response,
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

  async session(): Promise<AuthSessionView | undefined> {
    const response = await this.#request('/v1/session', { method: 'GET' });
    if (response.status === 401) return undefined;
    const value = await responseJson(response);
    if (!response.ok) throw serviceError();
    const record = objectValue(value);
    const session = objectValue(record['session']);
    const stepUpAt = optionalDateString(session['stepUpAt']);
    return {
      accountId: stringValue(record['accountId'], ACCOUNT_ID_PATTERN),
      expiresAt: dateString(session['expiresAt']),
      lastAuthenticatedAt: dateString(session['lastAuthenticatedAt']),
      ...(stepUpAt === undefined ? {} : { stepUpAt }),
    };
  }

  async logout(): Promise<void> {
    const csrfToken = this.#requiredCsrf();
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

  async synchronizeBundle(credentialId: string, bundle: PasskeyWrappedKeyBundle): Promise<void> {
    if (!CREDENTIAL_ID_PATTERN.test(credentialId)) {
      throw new BrowserAuthError('credential-invalid');
    }
    const value = await this.#mutationJson(
      `/v1/key-bundles/${encodeURIComponent(credentialId)}`,
      { bundle: ciphertextBundle(bundle) },
      'PUT',
    );
    const record = objectValue(value);
    if (
      record['credentialId'] !== credentialId ||
      record['ciphertextOnly'] !== true ||
      record['keyKind'] !== bundle.keyKind ||
      record['publicKey'] !== bundle.publicKey
    ) {
      throw new BrowserAuthError('server-invalid');
    }
  }

  async bundles(): Promise<readonly SynchronizedBundle[]> {
    const value = await this.#json('/v1/key-bundles', { method: 'GET' });
    const record = objectValue(value);
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
    const credential = objectValue(record['credential']);
    const csrfToken = stringValue(record['csrfToken'], TOKEN_PATTERN);
    this.#setCsrf(csrfToken);
    return {
      accountId: stringValue(record['accountId'], ACCOUNT_ID_PATTERN),
      credentialId: stringValue(credential['credentialId'], CREDENTIAL_ID_PATTERN),
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
    method: 'POST' | 'PUT' = 'POST',
  ): Promise<unknown> {
    return this.#json(path, {
      method,
      headers: mutationHeaders(this.#requiredCsrf()),
      body: JSON.stringify(body),
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

  #requiredCsrf(): string {
    if (this.#csrfToken === undefined) {
      throw new BrowserAuthError('csrf-unavailable');
    }
    return this.#csrfToken;
  }

  #setCsrf(token: string): void {
    this.#csrfToken = token;
    this.#storage.setItem(this.#storageKey, token);
  }

  #clearCsrf(): void {
    this.#csrfToken = undefined;
    this.#storage.removeItem(this.#storageKey);
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
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    LEGACY_REDIRECT_HOSTS.has(url.hostname.toLowerCase()) ||
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

function mutationHeaders(csrfToken: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-csrf-token': csrfToken,
  };
}

function creationOptionsValue(value: unknown): PublicKeyCredentialCreationOptionsJSON {
  const record = objectValue(value);
  const user = objectValue(record['user']);
  const relyingParty = objectValue(record['rp']);
  if (
    typeof record['challenge'] !== 'string' ||
    typeof user['id'] !== 'string' ||
    typeof user['name'] !== 'string' ||
    typeof user['displayName'] !== 'string' ||
    typeof relyingParty['name'] !== 'string' ||
    !Array.isArray(record['pubKeyCredParams'])
  ) {
    throw new BrowserAuthError('server-invalid');
  }
  return record as unknown as PublicKeyCredentialCreationOptionsJSON;
}

function requestOptionsValue(value: unknown): PublicKeyCredentialRequestOptionsJSON {
  const record = objectValue(value);
  if (
    typeof record['challenge'] !== 'string' ||
    (record['allowCredentials'] !== undefined && !Array.isArray(record['allowCredentials']))
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
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new BrowserAuthError('server-invalid');
  }
  return value;
}

function optionalDateString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : dateString(value);
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

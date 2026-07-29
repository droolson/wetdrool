const maximumResponseBytes = 4_096;
const minimumTimeoutMilliseconds = 100;
const maximumTimeoutMilliseconds = 10_000;
const minimumBearerTokenCharacters = 32;
const maximumBearerTokenCharacters = 512;

export interface HttpAuthorizerClientOptions {
  readonly bearerToken?: string;
  readonly timeoutMilliseconds: number;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Shared, bounded transport for the relay's independently deployable
 * authorization dependencies. Callers remain responsible for strict response
 * schemas and decision semantics.
 */
export class HttpAuthorizerClient {
  readonly #bearerToken: string | undefined;
  readonly #timeoutMilliseconds: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: HttpAuthorizerClientOptions) {
    if (
      !Number.isInteger(options.timeoutMilliseconds) ||
      options.timeoutMilliseconds < minimumTimeoutMilliseconds ||
      options.timeoutMilliseconds > maximumTimeoutMilliseconds
    ) {
      throw new TypeError(
        `Relay authorizer timeout must be an integer from ${String(
          minimumTimeoutMilliseconds,
        )} to ${String(maximumTimeoutMilliseconds)} milliseconds.`,
      );
    }
    if (
      options.bearerToken !== undefined &&
      (options.bearerToken.length < minimumBearerTokenCharacters ||
        options.bearerToken.length > maximumBearerTokenCharacters)
    ) {
      throw new TypeError(
        `Relay authorizer bearer tokens must contain ${String(
          minimumBearerTokenCharacters,
        )} to ${String(maximumBearerTokenCharacters)} characters.`,
      );
    }
    this.#bearerToken = options.bearerToken;
    this.#timeoutMilliseconds = options.timeoutMilliseconds;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async requestJson(endpoint: URL, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const request = this.#performRequest(endpoint, init, controller.signal);
    let rejectTimeout: ((reason: Error) => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timer = setTimeout(() => {
      const error = new Error('Relay authorizer request timed out.');
      controller.abort(error);
      rejectTimeout?.(error);
    }, this.#timeoutMilliseconds);
    timer.unref();
    try {
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #performRequest(endpoint: URL, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const headers = new Headers(init.headers);
    if (this.#bearerToken !== undefined) {
      headers.set('authorization', `Bearer ${this.#bearerToken}`);
    }
    const response = await this.#fetch(endpoint, {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      headers,
      redirect: 'error',
      signal,
    });
    if (response.redirected || !response.ok || !isJsonResponse(response)) {
      await discardBounded(response);
      throw new Error('Relay authorizer returned an invalid HTTP response.');
    }
    return boundedJson(response);
  }
}

export function parseHttpAuthorizerEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.hash !== ''
  ) {
    throw new TypeError(
      'Relay authorizer endpoints must be credential-free HTTP(S) URLs without fragments.',
    );
  }
  return endpoint;
}

export type RelayReadinessCheck = () => void | Promise<void>;

export function combineRelayReadinessChecks(
  checks: readonly (RelayReadinessCheck | undefined)[],
): (() => Promise<void>) | undefined {
  const configured = checks.filter((check): check is RelayReadinessCheck => check !== undefined);
  if (configured.length === 0) {
    return undefined;
  }
  return async () => {
    await Promise.all(configured.map(async (check) => check()));
  };
}

function isJsonResponse(response: Response): boolean {
  return (
    response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ===
    'application/json'
  );
}

async function discardBounded(response: Response): Promise<void> {
  try {
    await boundedBytes(response);
  } catch {
    await response.body?.cancel().catch(() => undefined);
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const bytes = await boundedBytes(response);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

async function boundedBytes(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (/^\d+$/u.test(declaredLength) === false ||
      BigInt(declaredLength) > BigInt(maximumResponseBytes))
  ) {
    await response.body?.cancel();
    throw new Error('Relay authorizer response exceeds the byte limit.');
  }
  if (response.body === null) {
    throw new Error('Relay authorizer response has no body.');
  }

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumResponseBytes) {
        throw new Error('Relay authorizer response exceeds the byte limit.');
      }
      chunks.push(value);
    }
  } finally {
    if (total > maximumResponseBytes) {
      await reader.cancel();
    }
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

import { getContentCid, verifyContentCid } from '@wokesocial/protocol';

import {
  type ContentAddressedStorage,
  type StorageHealth,
  type StoragePolicy,
  type StorageReceipt,
  StorageError,
} from './types.js';

export interface IpfsHttpOptions {
  readonly apiUrl: string;
  readonly gateways: readonly string[];
  readonly authorization?: string;
  readonly maximumObjectBytes?: number;
  readonly requestTimeoutMilliseconds?: number;
  readonly clock?: () => Date;
  readonly fetch?: typeof globalThis.fetch;
}

export class IpfsHttpStorage implements ContentAddressedStorage {
  readonly name = 'ipfs-http';
  readonly version = '1';

  readonly #apiUrl: URL;
  readonly #gateways: readonly URL[];
  readonly #authorization: string | undefined;
  readonly #maximumObjectBytes: number;
  readonly #timeout: number;
  readonly #clock: () => Date;
  readonly #request: typeof globalThis.fetch;

  constructor(options: IpfsHttpOptions) {
    this.#apiUrl = requireHttpUrl(options.apiUrl);
    this.#gateways = options.gateways.map(requireHttpUrl);
    if (this.#gateways.length === 0) {
      throw new TypeError('At least one IPFS gateway is required.');
    }
    this.#authorization = options.authorization;
    this.#maximumObjectBytes = options.maximumObjectBytes ?? 25_000_000;
    this.#timeout = options.requestTimeoutMilliseconds ?? 15_000;
    this.#clock = options.clock ?? (() => new Date());
    this.#request = options.fetch ?? globalThis.fetch;
  }

  async put(bytes: Uint8Array, policy: StoragePolicy): Promise<StorageReceipt> {
    this.#assertSize(bytes.byteLength);
    const expectedCid = await getContentCid(bytes);
    const form = new FormData();
    const body = Uint8Array.from(bytes).buffer;
    form.append('file', new Blob([body], { type: 'application/octet-stream' }), expectedCid);
    const endpoint = new URL('api/v0/add', this.#apiUrl);
    endpoint.searchParams.set('cid-version', '1');
    endpoint.searchParams.set('raw-leaves', 'true');
    endpoint.searchParams.set('pin', 'true');
    endpoint.searchParams.set('wrap-with-directory', 'false');

    let response: Response;
    try {
      response = await this.#fetch(endpoint, { method: 'POST', body: form });
    } catch (error) {
      throw new StorageError('IPFS publication failed.', 'provider-failure', {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new StorageError(
        `IPFS publication failed with HTTP ${response.status}.`,
        'provider-failure',
      );
    }

    const text = await response.text();
    const lastLine = text.trim().split('\n').at(-1);
    let returnedCid: string | undefined;
    try {
      const body = JSON.parse(lastLine ?? '') as { Hash?: unknown };
      returnedCid = typeof body.Hash === 'string' ? body.Hash : undefined;
    } catch {
      // Handled by the integrity error below.
    }
    if (returnedCid !== expectedCid) {
      throw new StorageError(
        'IPFS returned a CID that does not match the published bytes.',
        'integrity-failure',
      );
    }

    const downloaded = await this.get(expectedCid);
    if (!(await verifyContentCid(downloaded, expectedCid))) {
      throw new StorageError(
        'IPFS gateway verification failed after publication.',
        'integrity-failure',
      );
    }

    return {
      cid: expectedCid,
      provider: this.name,
      providerVersion: this.version,
      locator: `ipfs://${expectedCid}`,
      byteLength: bytes.byteLength,
      publishedAt: this.#clock().toISOString(),
      policy,
      verified: true,
    };
  }

  async get(cid: string): Promise<Uint8Array> {
    const failures: string[] = [];
    for (const gateway of this.#gateways) {
      const endpoint = new URL(`ipfs/${encodeURIComponent(cid)}`, gateway);
      try {
        const response = await this.#fetch(endpoint);
        if (!response.ok) {
          failures.push(`${gateway.origin}: HTTP ${response.status}`);
          continue;
        }
        const bytes = await readBoundedResponse(response, this.#maximumObjectBytes);
        this.#assertSize(bytes.byteLength);
        if (await verifyContentCid(bytes, cid)) {
          return bytes;
        }
        failures.push(`${gateway.origin}: CID mismatch`);
      } catch (error) {
        failures.push(
          `${gateway.origin}: ${error instanceof Error ? error.message : 'unknown failure'}`,
        );
      }
    }
    throw new StorageError(
      `All IPFS gateways failed verification (${failures.join('; ')}).`,
      'not-found',
    );
  }

  async has(cid: string): Promise<boolean> {
    try {
      await this.get(cid);
      return true;
    } catch {
      return false;
    }
  }

  async delete(cid: string): Promise<boolean> {
    const endpoint = new URL('api/v0/pin/rm', this.#apiUrl);
    endpoint.searchParams.set('arg', cid);
    try {
      const response = await this.#fetch(endpoint, { method: 'POST' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async health(): Promise<StorageHealth> {
    const endpoint = new URL('api/v0/version', this.#apiUrl);
    try {
      const response = await this.#fetch(endpoint, { method: 'POST' });
      const health: StorageHealth = {
        provider: this.name,
        ok: response.ok,
        checkedAt: this.#clock().toISOString(),
      };
      if (!response.ok) {
        return { ...health, detail: `HTTP ${response.status}` };
      }
      return health;
    } catch (error) {
      return {
        provider: this.name,
        ok: false,
        checkedAt: this.#clock().toISOString(),
        detail: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  #assertSize(byteLength: number): void {
    if (byteLength < 0 || byteLength > this.#maximumObjectBytes) {
      throw new StorageError(
        `Object exceeds the ${this.#maximumObjectBytes}-byte IPFS limit.`,
        'size-limit',
      );
    }
  }

  #fetch(input: URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.#authorization !== undefined) {
      headers.set('authorization', this.#authorization);
    }
    return this.#request(input, {
      ...init,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(this.#timeout),
    });
  }
}

function requireHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('IPFS endpoints must use HTTP or HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('IPFS endpoint URLs must not contain credentials, queries, or fragments.');
  }
  url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return url;
}

async function readBoundedResponse(
  response: Response,
  maximumObjectBytes: number,
): Promise<Uint8Array> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > maximumObjectBytes
    ) {
      throw new StorageError(
        `IPFS response exceeds the ${maximumObjectBytes}-byte read limit.`,
        'size-limit',
      );
    }
  }

  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > maximumObjectBytes) {
        await reader.cancel('response exceeded IPFS read limit');
        throw new StorageError(
          `IPFS response exceeds the ${maximumObjectBytes}-byte read limit.`,
          'size-limit',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

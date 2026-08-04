import {
  digestSha256Multibase,
  encodeMultibaseBase64Url,
  getContentCid,
  verifyContentCid,
} from '@wetdrool/protocol';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';

import {
  type ContentAddressedStorage,
  type StorageHealth,
  type StoragePolicy,
  type StorageReceipt,
  StorageError,
} from './types.js';

export interface PermanentUploadTag {
  readonly name: string;
  readonly value: string;
}

/**
 * Normalized input for an Arweave, Irys, or compatible upload client.
 *
 * Signing, funding, and provider-specific transport stay behind this boundary.
 * Implementations must honor the abort signal and return only provider-confirmed
 * receipts.
 */
export interface PermanentUploadRequest {
  readonly bytes: Uint8Array;
  readonly contentCid: string;
  readonly contentSha256: string;
  readonly byteLength: number;
  readonly consentId: string;
  readonly tags: readonly PermanentUploadTag[];
  readonly signal: AbortSignal;
}

/**
 * A normalized provider receipt. `status: "confirmed"` means the injected
 * uploader applied its configured finality policy, not merely that it accepted
 * an HTTP request.
 */
export interface PermanentUploadReceipt {
  readonly transactionId: string;
  readonly contentCid: string;
  readonly contentSha256: string;
  readonly byteLength: number;
  readonly consentId: string;
  readonly status: 'confirmed' | 'pending' | 'rejected';
  readonly confirmedAt: string;
}

export interface PermanentUploaderHealth {
  readonly ok: boolean;
  readonly detail?: string;
}

/**
 * Provider-neutral seam for an Arweave/Irys SDK, signed HTTP client, or test
 * double. The implementation owns credentials and payment; this package does
 * not.
 */
export interface PermanentDataUploader {
  readonly name: string;
  readonly version: string;
  upload(request: PermanentUploadRequest): Promise<PermanentUploadReceipt>;
  health(signal: AbortSignal): Promise<PermanentUploaderHealth>;
}

export interface PermanentLocatorResolver {
  resolveTransactionId(cid: string, signal: AbortSignal): Promise<string | undefined>;
}

export interface ArweavePermanentStorageOptions {
  readonly uploader: PermanentDataUploader;
  readonly gateways: readonly string[];
  readonly locatorResolver?: PermanentLocatorResolver;
  readonly maximumObjectBytes?: number;
  readonly requestTimeoutMilliseconds?: number;
  readonly clock?: () => Date;
  readonly fetch?: typeof globalThis.fetch;
}

export interface ArweaveStorageReceipt extends StorageReceipt {
  readonly transactionId: string;
  readonly contentSha256: string;
  readonly uploader: string;
  readonly uploaderVersion: string;
  readonly confirmation: 'confirmed';
}

interface DownloadFailure {
  readonly code: 'integrity-failure' | 'not-found' | 'provider-failure' | 'size-limit';
  readonly message: string;
}

const DEFAULT_MAXIMUM_OBJECT_BYTES = 25_000_000;
const DEFAULT_TIMEOUT_MILLISECONDS = 15_000;
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export class ArweavePermanentStorage implements ContentAddressedStorage {
  readonly name = 'arweave-permanent';
  readonly version = '1';

  readonly #uploader: PermanentDataUploader;
  readonly #gateways: readonly URL[];
  readonly #locatorResolver: PermanentLocatorResolver | undefined;
  readonly #maximumObjectBytes: number;
  readonly #timeout: number;
  readonly #clock: () => Date;
  readonly #fetch: typeof globalThis.fetch;
  readonly #transactionIds = new Map<string, string>();

  constructor(options: ArweavePermanentStorageOptions) {
    if (options.gateways.length === 0) {
      throw new TypeError('At least one Arweave gateway is required.');
    }

    this.#uploader = options.uploader;
    this.#gateways = options.gateways.map(requireHttpUrl);
    this.#locatorResolver = options.locatorResolver;
    this.#maximumObjectBytes = options.maximumObjectBytes ?? DEFAULT_MAXIMUM_OBJECT_BYTES;
    this.#timeout = options.requestTimeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    this.#clock = options.clock ?? (() => new Date());
    this.#fetch = options.fetch ?? globalThis.fetch;

    requirePositiveSafeInteger(this.#maximumObjectBytes, 'maximumObjectBytes');
    requirePositiveSafeInteger(this.#timeout, 'requestTimeoutMilliseconds');
  }

  async put(bytes: Uint8Array, policy: StoragePolicy): Promise<ArweaveStorageReceipt> {
    const consentId = requirePermanentConsent(policy);
    this.#assertSize(bytes.byteLength);

    const contentCid = await getContentCid(bytes);
    const contentSha256 = digestSha256Multibase(bytes);
    let providerReceipt: PermanentUploadReceipt;
    try {
      providerReceipt = await runWithTimeout(
        this.#timeout,
        (signal) =>
          this.#uploader.upload({
            bytes: bytes.slice(),
            contentCid,
            contentSha256,
            byteLength: bytes.byteLength,
            consentId,
            tags: [
              { name: 'App-Name', value: 'WetDrool' },
              { name: 'App-Version', value: '1' },
              { name: 'Content-Type', value: 'application/octet-stream' },
              { name: 'WetDrool-CID', value: contentCid },
              { name: 'WetDrool-SHA256', value: contentSha256 },
            ],
            signal,
          }),
        'Permanent upload timed out.',
      );
    } catch (error) {
      throw asProviderFailure('Permanent upload failed.', error);
    }

    validateUploadReceipt(providerReceipt, {
      contentCid,
      contentSha256,
      byteLength: bytes.byteLength,
      consentId,
    });

    const downloaded = await this.#downloadTransaction(
      providerReceipt.transactionId,
      contentCid,
      contentSha256,
      bytes.byteLength,
    );
    if (!(await verifyContentCid(downloaded, contentCid))) {
      throw new StorageError(
        'Permanent gateway read-back failed CID verification.',
        'integrity-failure',
      );
    }

    this.#transactionIds.set(contentCid, providerReceipt.transactionId);

    return {
      cid: contentCid,
      provider: this.name,
      providerVersion: this.version,
      locator: `ar://${providerReceipt.transactionId}/${contentCid}`,
      byteLength: bytes.byteLength,
      publishedAt: providerReceipt.confirmedAt,
      policy: { permanence: 'permanent', consentId },
      verified: true,
      transactionId: providerReceipt.transactionId,
      contentSha256,
      uploader: this.#uploader.name,
      uploaderVersion: this.#uploader.version,
      confirmation: 'confirmed',
    };
  }

  async get(cid: string): Promise<Uint8Array> {
    requireCanonicalRawCid(cid);
    const contentSha256 = contentSha256FromCid(cid);
    let transactionId = this.#transactionIds.get(cid);

    const locatorResolver = this.#locatorResolver;
    if (transactionId === undefined && locatorResolver !== undefined) {
      try {
        transactionId = await runWithTimeout(
          this.#timeout,
          (signal) => locatorResolver.resolveTransactionId(cid, signal),
          'Permanent locator lookup timed out.',
        );
      } catch (error) {
        throw asProviderFailure('Permanent locator lookup failed.', error);
      }
    }

    if (transactionId === undefined) {
      throw new StorageError(`No permanent transaction locator is known for ${cid}.`, 'not-found');
    }
    requireTransactionId(transactionId);

    const bytes = await this.#downloadTransaction(transactionId, cid, contentSha256);
    this.#transactionIds.set(cid, transactionId);
    return bytes;
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
    // Arweave publication is permanent. Returning false is the only truthful
    // implementation of the legacy deletion-compatible storage interface.
    requireCanonicalRawCid(cid);
    return false;
  }

  async health(): Promise<StorageHealth> {
    const checkedAt = this.#clock().toISOString();
    const [uploader, gateways] = await Promise.all([
      this.#uploaderHealth(),
      Promise.all(this.#gateways.map((gateway) => this.#gatewayHealth(gateway))),
    ]);
    const reachableGateway = gateways.some((gateway) => gateway.ok);
    const ok = uploader.ok && reachableGateway;

    if (ok) {
      return {
        provider: this.name,
        ok: true,
        checkedAt,
      };
    }

    const details = [
      ...(uploader.ok
        ? []
        : [`uploader ${this.#uploader.name}: ${uploader.detail ?? 'unhealthy'}`]),
      ...gateways
        .filter((gateway) => !gateway.ok)
        .map((gateway) => `${gateway.gateway}: ${gateway.detail ?? 'unhealthy'}`),
    ];
    return {
      provider: this.name,
      ok: false,
      checkedAt,
      detail: details.join('; '),
    };
  }

  async #downloadTransaction(
    transactionId: string,
    expectedCid: string,
    expectedSha256: string,
    expectedByteLength?: number,
  ): Promise<Uint8Array> {
    requireTransactionId(transactionId);
    const failures: DownloadFailure[] = [];

    for (const gateway of this.#gateways) {
      const endpoint = new URL(encodeURIComponent(transactionId), gateway);
      try {
        const bytes = await runWithTimeout(
          this.#timeout,
          async (signal) => {
            const response = await this.#fetch(endpoint, {
              headers: { accept: 'application/octet-stream' },
              redirect: 'error',
              signal,
            });
            if (response.status === 404) {
              throw new StorageError(
                `${gateway.origin} did not find the transaction.`,
                'not-found',
              );
            }
            if (!response.ok) {
              throw new StorageError(
                `${gateway.origin} returned HTTP ${response.status}.`,
                'provider-failure',
              );
            }
            return readBoundedResponse(response, this.#maximumObjectBytes);
          },
          `Gateway ${gateway.origin} timed out.`,
        );
        this.#assertSize(bytes.byteLength);

        if (
          (expectedByteLength !== undefined && bytes.byteLength !== expectedByteLength) ||
          !(await verifyContentCid(bytes, expectedCid)) ||
          digestSha256Multibase(bytes) !== expectedSha256
        ) {
          failures.push({
            code: 'integrity-failure',
            message: `${gateway.origin} returned bytes that do not match the expected CID and hash`,
          });
          continue;
        }
        return bytes;
      } catch (error) {
        if (error instanceof StorageError) {
          failures.push({
            code: normalizeDownloadFailureCode(error.code),
            message: error.message,
          });
        } else {
          failures.push({
            code: 'provider-failure',
            message: `${gateway.origin}: ${
              error instanceof Error ? error.message : 'unknown failure'
            }`,
          });
        }
      }
    }

    const code = selectFailureCode(failures);
    throw new StorageError(
      `No Arweave gateway returned verified bytes (${failures
        .map((failure) => failure.message)
        .join('; ')}).`,
      code,
    );
  }

  async #uploaderHealth(): Promise<PermanentUploaderHealth> {
    try {
      return await runWithTimeout(
        this.#timeout,
        (signal) => this.#uploader.health(signal),
        'Uploader health check timed out.',
      );
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : 'unknown failure',
      };
    }
  }

  async #gatewayHealth(
    gateway: URL,
  ): Promise<{ readonly gateway: string; readonly ok: boolean; readonly detail?: string }> {
    const endpoint = new URL('info', gateway);
    try {
      const response = await runWithTimeout(
        this.#timeout,
        (signal) =>
          this.#fetch(endpoint, {
            headers: { accept: 'application/json' },
            redirect: 'error',
            signal,
          }),
        `Gateway ${gateway.origin} health check timed out.`,
      );
      if (!response.ok) {
        return {
          gateway: gateway.origin,
          ok: false,
          detail: `HTTP ${response.status}`,
        };
      }
      return { gateway: gateway.origin, ok: true };
    } catch (error) {
      return {
        gateway: gateway.origin,
        ok: false,
        detail: error instanceof Error ? error.message : 'unknown failure',
      };
    }
  }

  #assertSize(byteLength: number): void {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new StorageError('Object byte length is invalid.', 'size-limit');
    }
    if (byteLength > this.#maximumObjectBytes) {
      throw new StorageError(
        `Object exceeds the ${this.#maximumObjectBytes}-byte permanent storage limit.`,
        'size-limit',
      );
    }
  }
}

function validateUploadReceipt(
  receipt: PermanentUploadReceipt,
  expected: {
    readonly contentCid: string;
    readonly contentSha256: string;
    readonly byteLength: number;
    readonly consentId: string;
  },
): void {
  requireTransactionId(receipt.transactionId);
  if (
    receipt.status !== 'confirmed' ||
    receipt.contentCid !== expected.contentCid ||
    receipt.contentSha256 !== expected.contentSha256 ||
    receipt.byteLength !== expected.byteLength ||
    receipt.consentId !== expected.consentId ||
    !isCanonicalTimestamp(receipt.confirmedAt)
  ) {
    throw new StorageError(
      'Permanent uploader returned an unconfirmed or mismatched receipt.',
      'integrity-failure',
    );
  }
}

function requirePermanentConsent(policy: StoragePolicy): string {
  if (
    policy.permanence !== 'permanent' ||
    policy.consentId === undefined ||
    policy.consentId.trim().length === 0
  ) {
    throw new StorageError(
      'Permanent publication requires explicit permanence policy and a recorded consent identifier.',
      'permanence-consent-required',
    );
  }
  return policy.consentId;
}

function requireCanonicalRawCid(value: string): void {
  contentSha256FromCid(value);
}

function contentSha256FromCid(value: string): string {
  let parsed: CID;
  try {
    parsed = CID.parse(value);
  } catch (error) {
    throw new StorageError('Invalid content identifier.', 'invalid-cid', {
      cause: error,
    });
  }

  if (
    parsed.version !== 1 ||
    parsed.code !== raw.code ||
    parsed.multihash.code !== 0x12 ||
    parsed.multihash.digest.byteLength !== 32 ||
    parsed.toV1().toString() !== value
  ) {
    throw new StorageError(
      'Only canonical base32 CIDv1 raw SHA-256 identifiers are accepted.',
      'invalid-cid',
    );
  }
  return encodeMultibaseBase64Url(parsed.multihash.digest);
}

function requireTransactionId(value: string): void {
  if (
    !TRANSACTION_ID_PATTERN.test(value) ||
    Buffer.from(value, 'base64url').byteLength !== 32 ||
    Buffer.from(value, 'base64url').toString('base64url') !== value
  ) {
    throw new StorageError(
      'Permanent uploader returned an invalid Arweave transaction identifier.',
      'integrity-failure',
    );
  }
}

function requireHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Arweave gateways must use HTTP or HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError(
      'Arweave gateway URLs must not contain credentials, queries, or fragments.',
    );
  }
  url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return url;
}

function requirePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
}

function isCanonicalTimestamp(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function asProviderFailure(message: string, error: unknown): StorageError {
  if (error instanceof StorageError) {
    return error;
  }
  return new StorageError(message, 'provider-failure', { cause: error });
}

function selectFailureCode(failures: readonly DownloadFailure[]): DownloadFailure['code'] {
  if (failures.some((failure) => failure.code === 'integrity-failure')) {
    return 'integrity-failure';
  }
  if (failures.some((failure) => failure.code === 'size-limit')) {
    return 'size-limit';
  }
  if (failures.every((failure) => failure.code === 'not-found')) {
    return 'not-found';
  }
  return 'provider-failure';
}

function normalizeDownloadFailureCode(code: StorageError['code']): DownloadFailure['code'] {
  switch (code) {
    case 'integrity-failure':
    case 'not-found':
    case 'provider-failure':
    case 'size-limit':
      return code;
    default:
      return 'provider-failure';
  }
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
        `Gateway response exceeds the ${maximumObjectBytes}-byte read limit.`,
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
        await reader.cancel('response exceeded storage read limit');
        throw new StorageError(
          `Gateway response exceeds the ${maximumObjectBytes}-byte read limit.`,
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

async function runWithTimeout<T>(
  timeoutMilliseconds: number,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(timeoutMessage);
      controller.abort(error);
      reject(error);
    }, timeoutMilliseconds);
    timer.unref?.();
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

import { getContentCid, isCanonicalRawSha256Cid } from '@wokesocial/protocol';

import {
  LOCAL_CAS_CONTENT_TYPE,
  LOCAL_CAS_EXPECTED_CID_HEADER,
  LOCAL_CAS_RECEIPT_SCHEMA,
  LOCAL_CAS_ROUTE,
  type LocalCasReceipt,
  type LocalCasWriteResult,
} from './local-cas-contract';

const MAXIMUM_RESPONSE_BYTES = 16_384;

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface LocalCasBrowserClientOptions {
  readonly endpoint?: string;
  readonly fetch?: Fetch;
  readonly maximumResponseBytes?: number;
}

export class LocalCasBrowserClientError extends Error {
  override readonly name = 'LocalCasBrowserClientError';

  constructor(
    message: string,
    readonly code:
      | 'gateway-rejected'
      | 'invalid-input'
      | 'invalid-response'
      | 'network-failure'
      | 'response-too-large',
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class LocalCasBrowserClient {
  readonly #endpoint: string;
  readonly #fetch: Fetch;
  readonly #maximumResponseBytes: number;

  constructor(options: LocalCasBrowserClientOptions = {}) {
    this.#endpoint = options.endpoint ?? LOCAL_CAS_ROUTE;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maximumResponseBytes = options.maximumResponseBytes ?? MAXIMUM_RESPONSE_BYTES;

    if (
      !this.#endpoint.startsWith('/') ||
      this.#endpoint.startsWith('//') ||
      new URL(this.#endpoint, 'http://local.invalid').origin !== 'http://local.invalid'
    ) {
      throw new LocalCasBrowserClientError(
        'The local CAS endpoint must be a relative same-origin path.',
        'invalid-input',
      );
    }
    if (
      !Number.isSafeInteger(this.#maximumResponseBytes) ||
      this.#maximumResponseBytes < 1 ||
      this.#maximumResponseBytes > 65_536
    ) {
      throw new LocalCasBrowserClientError(
        'The local CAS response limit is invalid.',
        'invalid-input',
      );
    }
  }

  async put(
    bytes: Uint8Array,
    expectedCid: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<LocalCasWriteResult> {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength === 0 ||
      !isCanonicalRawSha256Cid(expectedCid) ||
      (await getContentCid(bytes)) !== expectedCid
    ) {
      throw new LocalCasBrowserClientError(
        'The local CAS request bytes and expected CID do not match.',
        'invalid-input',
      );
    }

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        body: bytes.slice(),
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          'content-type': LOCAL_CAS_CONTENT_TYPE,
          [LOCAL_CAS_EXPECTED_CID_HEADER]: expectedCid,
        },
        method: 'POST',
        redirect: 'error',
        referrerPolicy: 'same-origin',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error) {
      throw new LocalCasBrowserClientError(
        'The local content write request did not complete.',
        'network-failure',
        undefined,
        { cause: error },
      );
    }

    const responseValue = await readBoundedJson(response, this.#maximumResponseBytes);
    if (response.status !== 200 && response.status !== 201) {
      throw new LocalCasBrowserClientError(
        gatewayErrorMessage(responseValue),
        'gateway-rejected',
        response.status,
      );
    }

    const result = parseExactWriteResult(responseValue);
    const expectedOutcome = response.status === 201 ? 'stored' : 'already-present';
    if (
      result.outcome !== expectedOutcome ||
      result.receipt.cid !== expectedCid ||
      result.receipt.byteLength !== bytes.byteLength ||
      response.headers.get('etag') !== `"${expectedCid}"`
    ) {
      throw new LocalCasBrowserClientError(
        'The local content gateway returned an inconsistent receipt.',
        'invalid-response',
        response.status,
      );
    }
    return result;
  }
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (contentType !== 'application/json' || response.body === null) {
    throw new LocalCasBrowserClientError(
      'The local content gateway returned an unsupported response.',
      'invalid-response',
      response.status,
    );
  }

  const declaredLength = response.headers.get('content-length');
  let expectedByteLength: number | undefined;
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new LocalCasBrowserClientError(
      'The local content gateway response exceeded the client limit.',
      'response-too-large',
      response.status,
    );
  }
  if (declaredLength !== null) {
    expectedByteLength = Number(declaredLength);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel('local CAS response limit exceeded');
        throw new LocalCasBrowserClientError(
          'The local content gateway response exceeded the client limit.',
          'response-too-large',
          response.status,
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (expectedByteLength !== undefined && expectedByteLength !== byteLength) {
    throw new LocalCasBrowserClientError(
      'The local content gateway response length was inconsistent.',
      'invalid-response',
      response.status,
    );
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new LocalCasBrowserClientError(
      'The local content gateway returned invalid JSON.',
      'invalid-response',
      response.status,
      { cause: error },
    );
  }
}

function parseExactWriteResult(value: unknown): LocalCasWriteResult {
  if (!isRecord(value) || !hasExactKeys(value, ['outcome', 'receipt'])) {
    throw invalidReceipt();
  }
  const { outcome, receipt } = value;
  if (
    (outcome !== 'stored' && outcome !== 'already-present') ||
    !isRecord(receipt) ||
    !hasExactKeys(receipt, [
      'byteLength',
      'cid',
      'locator',
      'policy',
      'provider',
      'providerVersion',
      'schema',
      'verified',
    ]) ||
    typeof receipt.byteLength !== 'number' ||
    !Number.isSafeInteger(receipt.byteLength) ||
    receipt.byteLength < 1 ||
    typeof receipt.cid !== 'string' ||
    !isCanonicalRawSha256Cid(receipt.cid) ||
    receipt.locator !== `local://${receipt.cid}` ||
    receipt.provider !== 'local-filesystem' ||
    receipt.providerVersion !== '1' ||
    receipt.schema !== LOCAL_CAS_RECEIPT_SCHEMA ||
    receipt.verified !== true ||
    !isRecord(receipt.policy) ||
    !hasExactKeys(receipt.policy, ['permanence']) ||
    receipt.policy.permanence !== 'deletion-compatible'
  ) {
    throw invalidReceipt();
  }

  return {
    outcome,
    receipt: receipt as unknown as LocalCasReceipt,
  };
}

function gatewayErrorMessage(value: unknown): string {
  if (
    isRecord(value) &&
    hasExactKeys(value, ['error']) &&
    isRecord(value.error) &&
    hasExactKeys(value.error, ['code', 'message']) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string' &&
    value.error.code.length <= 64 &&
    value.error.message.length <= 256
  ) {
    return value.error.message;
  }
  return 'The local content gateway rejected the request.';
}

function invalidReceipt(): LocalCasBrowserClientError {
  return new LocalCasBrowserClientError(
    'The local content gateway returned an invalid receipt.',
    'invalid-response',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

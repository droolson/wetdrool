import { solanaPublicKeySchema } from '@wetdrool/protocol';
import type {
  WokeProgramAccountReader,
  WokeProgramAccountReadRequest,
  WokeProgramAccountSnapshot,
} from '@wetdrool/sdk';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const MAXIMUM_RPC_RESPONSE_BYTES = 256 * 1024;
const MAXIMUM_ACCOUNT_BYTES = 16 * 1024;

export interface LocalnetProgramAccountReaderOptions {
  readonly abortSignal?: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
}

export class LocalnetProgramAccountReaderError extends Error {
  override readonly name = 'LocalnetProgramAccountReaderError';

  constructor(
    message: string,
    readonly code:
      'aborted' | 'invalid-request' | 'invalid-response' | 'network-mismatch' | 'rpc-failure',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Exact local-validator implementation of the SDK account-reader boundary.
 * Every read first verifies genesis and returns the slot, owner, commitment,
 * and raw bytes that the SDK account decoder subsequently binds to its PDA.
 */
export class LocalnetProgramAccountReader implements WokeProgramAccountReader {
  readonly #fetch: typeof globalThis.fetch;
  readonly #abortSignal: AbortSignal | undefined;

  constructor(options: LocalnetProgramAccountReaderOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#abortSignal = options.abortSignal;
  }

  async readAccount(
    requestInput: WokeProgramAccountReadRequest,
  ): Promise<WokeProgramAccountSnapshot | null> {
    const request = parseRequest(requestInput);
    assertActive(this.#abortSignal);
    await assertGenesis(this.#fetch, request.endpoint, request.genesisHash, this.#abortSignal);

    const result = await rpc<{
      readonly context?: { readonly slot?: unknown };
      readonly value?: null | {
        readonly data?: unknown;
        readonly executable?: unknown;
        readonly lamports?: unknown;
        readonly owner?: unknown;
        readonly space?: unknown;
      };
    }>(
      this.#fetch,
      request.endpoint,
      'getAccountInfo',
      [
        request.address,
        {
          commitment: request.commitment,
          encoding: 'base64',
        },
      ],
      this.#abortSignal,
    );
    await assertGenesis(this.#fetch, request.endpoint, request.genesisHash, this.#abortSignal);
    const slot = parseSlot(result.context?.slot);
    if (result.value === null) return null;
    const account = result.value;
    if (
      account === undefined ||
      account.executable !== false ||
      typeof account.owner !== 'string' ||
      !solanaPublicKeySchema.safeParse(account.owner).success ||
      typeof account.lamports !== 'number' ||
      !Number.isSafeInteger(account.lamports) ||
      account.lamports < 0 ||
      typeof account.space !== 'number' ||
      !Number.isSafeInteger(account.space) ||
      account.space < 0 ||
      account.space > MAXIMUM_ACCOUNT_BYTES
    ) {
      throw invalidResponse('The local validator returned an invalid account envelope.');
    }
    const data = decodeAccountData(account.data);
    if (account.space !== data.byteLength) {
      data.fill(0);
      throw invalidResponse('The local validator account space does not match its bytes.');
    }
    return Object.freeze({
      address: request.address,
      commitment: request.commitment,
      data,
      owner: account.owner,
      slot,
    });
  }
}

async function assertGenesis(
  fetch: typeof globalThis.fetch,
  endpoint: URL,
  expectedGenesisHash: string,
  signal?: AbortSignal,
): Promise<void> {
  const genesisHash = await rpc<string>(fetch, endpoint, 'getGenesisHash', [], signal);
  if (genesisHash !== expectedGenesisHash) {
    throw new LocalnetProgramAccountReaderError(
      'The local validator genesis hash changed or does not match DroolNet.',
      'network-mismatch',
    );
  }
}

function parseRequest(input: WokeProgramAccountReadRequest) {
  if (input === null || typeof input !== 'object') {
    throw invalidRequest('A DroolNet account read request is required.');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(input.endpoint);
  } catch (error) {
    throw invalidRequest('The account reader endpoint is invalid.', error);
  }
  if (
    endpoint.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(endpoint.hostname.toLowerCase()) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw invalidRequest('The account reader is restricted to an exact loopback HTTP endpoint.');
  }
  const address = canonicalAddress(input.address, 'account address');
  const genesisHash = canonicalAddress(input.genesisHash, 'genesis hash');
  const programAddress = canonicalAddress(input.programAddress, 'program address');
  if (
    input.commitment !== 'processed' &&
    input.commitment !== 'confirmed' &&
    input.commitment !== 'finalized'
  ) {
    throw invalidRequest('The account commitment is invalid.');
  }
  return {
    address,
    commitment: input.commitment,
    endpoint,
    genesisHash,
    programAddress,
  };
}

function canonicalAddress(value: unknown, label: string): string {
  const parsed = solanaPublicKeySchema.safeParse(value);
  if (!parsed.success) throw invalidRequest(`The ${label} is not a canonical Solana public key.`);
  return parsed.data;
}

function parseSlot(value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidResponse('The local validator returned an invalid account context slot.');
  }
  return BigInt(value);
}

function decodeAccountData(value: unknown): Uint8Array {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    value[1] !== 'base64'
  ) {
    throw invalidResponse('The local validator did not return exact base64 account bytes.');
  }
  const encoded = value[0];
  if (
    encoded.length === 0 ||
    encoded.length > Math.ceil((MAXIMUM_ACCOUNT_BYTES * 4) / 3) + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
  ) {
    throw invalidResponse('The local validator returned malformed base64 account bytes.');
  }
  let binary: string;
  try {
    binary = globalThis.atob(encoded);
  } catch (error) {
    throw invalidResponse('The local validator returned malformed base64 account bytes.', error);
  }
  if (binary.length > MAXIMUM_ACCOUNT_BYTES) {
    throw invalidResponse('The local validator account exceeded the byte limit.');
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (globalThis.btoa(binary) !== encoded) {
    bytes.fill(0);
    throw invalidResponse('The local validator account bytes were not canonical base64.');
  }
  return bytes;
}

async function rpc<T>(
  fetch: typeof globalThis.fetch,
  endpoint: URL,
  method: string,
  params: readonly unknown[],
  signal?: AbortSignal,
): Promise<T> {
  const requestId = `wetdrool-account-reader-${method}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      body: JSON.stringify({
        id: requestId,
        jsonrpc: '2.0',
        method,
        params,
      }),
      cache: 'no-store',
      credentials: 'omit',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) throw aborted(error);
    throw new LocalnetProgramAccountReaderError(
      'The local validator account RPC request failed.',
      'rpc-failure',
      { cause: error },
    );
  }
  if (!response.ok) {
    await cancelBody(response.body);
    throw new LocalnetProgramAccountReaderError(
      `The local validator returned HTTP ${String(response.status)}.`,
      'rpc-failure',
    );
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    await cancelBody(response.body);
    throw invalidResponse('The local validator account RPC response is not JSON.');
  }
  const body = await readBoundedJson(response);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalidResponse('The local validator returned an invalid RPC envelope.');
  }
  const envelope = body as {
    readonly error?: unknown;
    readonly id?: unknown;
    readonly jsonrpc?: unknown;
    readonly result?: unknown;
  };
  if (
    envelope.jsonrpc !== '2.0' ||
    envelope.id !== requestId ||
    envelope.error !== undefined ||
    !('result' in envelope)
  ) {
    throw invalidResponse('The local validator returned a mismatched account RPC envelope.');
  }
  return envelope.result as T;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAXIMUM_RPC_RESPONSE_BYTES) {
      await cancelBody(response.body);
      throw invalidResponse('The local validator RPC response exceeded its byte limit.');
    }
  }
  if (response.body === null) {
    throw invalidResponse('The local validator returned an empty RPC response.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAXIMUM_RPC_RESPONSE_BYTES) {
        await reader.cancel();
        throw invalidResponse('The local validator RPC response exceeded its byte limit.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw invalidResponse('The local validator returned invalid bounded JSON.', error);
  }
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw aborted(signal.reason);
}

function aborted(cause?: unknown): LocalnetProgramAccountReaderError {
  return new LocalnetProgramAccountReaderError(
    'The local validator account read was cancelled.',
    'aborted',
    { cause },
  );
}

function invalidRequest(message: string, cause?: unknown): LocalnetProgramAccountReaderError {
  return new LocalnetProgramAccountReaderError(
    message,
    'invalid-request',
    cause === undefined ? undefined : { cause },
  );
}

function invalidResponse(message: string, cause?: unknown): LocalnetProgramAccountReaderError {
  return new LocalnetProgramAccountReaderError(
    message,
    'invalid-response',
    cause === undefined ? undefined : { cause },
  );
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Best effort after rejecting an invalid response.
  }
}

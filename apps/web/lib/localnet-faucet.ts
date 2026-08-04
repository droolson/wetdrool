import { solanaPublicKeySchema, transactionSignatureSchema } from '@wetdrool/protocol';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const MAXIMUM_TARGET_LAMPORTS = 1_000_000_000;
const MAXIMUM_RPC_RESPONSE_BYTES = 64 * 1024;

export interface LocalnetFaucetOptions {
  readonly endpoint: string;
  readonly expectedGenesisHash: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly maximumAirdropAttempts?: number;
  readonly maximumPollAttempts?: number;
  readonly pollDelayMilliseconds?: number;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface LocalnetFundingResult {
  readonly airdropSignature: string | null;
  readonly balanceLamports: number;
  readonly fundedLamports: number;
  readonly genesisHash: string;
}

export class LocalnetFaucetError extends Error {
  override readonly name = 'LocalnetFaucetError';

  constructor(
    message: string,
    readonly code:
      | 'aborted'
      | 'balance-mismatch'
      | 'invalid-config'
      | 'invalid-response'
      | 'network-mismatch'
      | 'rpc-failure'
      | 'timeout',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Brings one local-validator signer up to a small disclosed SOL balance.
 *
 * This adapter cannot target devnet, mainnet, a proxy, or any non-loopback
 * service. It verifies the exact genesis before and after requesting funds and
 * requires finalized status plus the expected resulting balance.
 */
export async function ensureLocalnetSignerBalance(
  options: LocalnetFaucetOptions,
  signerAddressInput: string,
  targetBalanceLamports: number,
  abortSignal?: AbortSignal,
): Promise<LocalnetFundingResult> {
  const endpoint = parseEndpoint(options.endpoint);
  const signerAddress = parseAddress(signerAddressInput);
  const expectedGenesisHash = parseAddress(options.expectedGenesisHash, 'genesis hash');
  if (
    !Number.isSafeInteger(targetBalanceLamports) ||
    targetBalanceLamports < 1 ||
    targetBalanceLamports > MAXIMUM_TARGET_LAMPORTS
  ) {
    throw new LocalnetFaucetError(
      'The localnet target balance must be a positive bounded lamport amount.',
      'invalid-config',
    );
  }
  const maximumPollAttempts = options.maximumPollAttempts ?? 120;
  const maximumAirdropAttempts = options.maximumAirdropAttempts ?? 5;
  const pollDelayMilliseconds = options.pollDelayMilliseconds ?? 250;
  if (
    !Number.isSafeInteger(maximumAirdropAttempts) ||
    maximumAirdropAttempts < 1 ||
    maximumAirdropAttempts > 10 ||
    !Number.isSafeInteger(maximumPollAttempts) ||
    maximumPollAttempts < 1 ||
    maximumPollAttempts > 240 ||
    !Number.isSafeInteger(pollDelayMilliseconds) ||
    pollDelayMilliseconds < 0 ||
    pollDelayMilliseconds > 5_000
  ) {
    throw new LocalnetFaucetError(
      'The localnet faucet polling bounds are invalid.',
      'invalid-config',
    );
  }
  const request = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? abortableDelay;
  assertActive(abortSignal);

  await assertGenesis(request, endpoint, expectedGenesisHash, abortSignal);
  const before = await readBalance(request, endpoint, signerAddress, abortSignal);
  if (before >= targetBalanceLamports) {
    await assertGenesis(request, endpoint, expectedGenesisHash, abortSignal);
    return {
      airdropSignature: null,
      balanceLamports: before,
      fundedLamports: 0,
      genesisHash: expectedGenesisHash,
    };
  }

  const fundedLamports = targetBalanceLamports - before;
  let signature: string | undefined;
  let lastAirdropError: unknown;
  for (let attempt = 0; attempt < maximumAirdropAttempts; attempt += 1) {
    try {
      const current =
        attempt === 0 ? before : await readBalance(request, endpoint, signerAddress, abortSignal);
      if (current >= targetBalanceLamports) {
        await assertGenesis(request, endpoint, expectedGenesisHash, abortSignal);
        return {
          airdropSignature: null,
          balanceLamports: current,
          fundedLamports: current - before,
          genesisHash: expectedGenesisHash,
        };
      }
      signature = await rpc<string>(
        request,
        endpoint,
        'requestAirdrop',
        [signerAddress, targetBalanceLamports - current, { commitment: 'finalized' }],
        abortSignal,
      );
      break;
    } catch (error) {
      if (!(error instanceof LocalnetFaucetError) || error.code !== 'rpc-failure') {
        throw error;
      }
      lastAirdropError = error;
      if (attempt + 1 >= maximumAirdropAttempts) break;
      // A local faucet may answer before its fee calculator stabilizes, or a
      // response may be lost after submission. Recheck genesis and balance
      // before any bounded retry so an ambiguous success is not blindly
      // duplicated.
      await sleep(pollDelayMilliseconds, abortSignal);
      await assertGenesis(request, endpoint, expectedGenesisHash, abortSignal);
    }
  }
  if (signature === undefined) {
    throw new LocalnetFaucetError(
      'The local-validator faucet did not accept a bounded funding request.',
      'rpc-failure',
      lastAirdropError === undefined ? undefined : { cause: lastAirdropError },
    );
  }
  const parsedSignature = transactionSignatureSchema.safeParse(signature);
  if (!parsedSignature.success) {
    throw new LocalnetFaucetError(
      'The local validator returned an invalid airdrop signature.',
      'invalid-response',
    );
  }

  let finalized = false;
  for (let attempt = 0; attempt < maximumPollAttempts; attempt += 1) {
    assertActive(abortSignal);
    const statuses = await rpc<{
      readonly value?: readonly (null | {
        readonly confirmationStatus?: unknown;
        readonly err?: unknown;
      })[];
    }>(
      request,
      endpoint,
      'getSignatureStatuses',
      [[parsedSignature.data], { searchTransactionHistory: true }],
      abortSignal,
    );
    const status = statuses.value?.[0];
    if (status?.err !== null && status?.err !== undefined) {
      throw new LocalnetFaucetError(
        'The local-validator airdrop transaction failed.',
        'rpc-failure',
      );
    }
    if (status?.confirmationStatus === 'finalized') {
      finalized = true;
      break;
    }
    await sleep(pollDelayMilliseconds, abortSignal);
  }
  if (!finalized) {
    throw new LocalnetFaucetError(
      'The local-validator airdrop did not finalize within the bounded wait.',
      'timeout',
    );
  }

  await assertGenesis(request, endpoint, expectedGenesisHash, abortSignal);
  const balanceLamports = await readBalance(request, endpoint, signerAddress, abortSignal);
  if (balanceLamports < targetBalanceLamports || balanceLamports < before + fundedLamports) {
    throw new LocalnetFaucetError(
      'The finalized local-validator balance does not match the requested funding.',
      'balance-mismatch',
    );
  }
  return {
    airdropSignature: parsedSignature.data,
    balanceLamports,
    fundedLamports,
    genesisHash: expectedGenesisHash,
  };
}

function parseEndpoint(value: string): URL {
  try {
    const endpoint = new URL(value);
    if (
      endpoint.protocol !== 'http:' ||
      !LOOPBACK_HOSTS.has(endpoint.hostname.toLowerCase()) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      throw new TypeError('not an exact loopback HTTP endpoint');
    }
    return endpoint;
  } catch (error) {
    throw new LocalnetFaucetError(
      'The localnet faucet requires an exact loopback HTTP RPC endpoint.',
      'invalid-config',
      { cause: error },
    );
  }
}

function parseAddress(value: string, label = 'signer address'): string {
  const parsed = solanaPublicKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new LocalnetFaucetError(
      `The localnet ${label} is not a canonical Solana public key.`,
      'invalid-config',
    );
  }
  return parsed.data;
}

async function assertGenesis(
  request: typeof globalThis.fetch,
  endpoint: URL,
  expected: string,
  signal?: AbortSignal,
): Promise<void> {
  const observed = await rpc<string>(request, endpoint, 'getGenesisHash', [], signal);
  if (observed !== expected) {
    throw new LocalnetFaucetError(
      'The local validator genesis hash does not match the selected DroolNet deployment.',
      'network-mismatch',
    );
  }
}

async function readBalance(
  request: typeof globalThis.fetch,
  endpoint: URL,
  address: string,
  signal?: AbortSignal,
): Promise<number> {
  const response = await rpc<{ readonly value?: unknown }>(
    request,
    endpoint,
    'getBalance',
    [address, { commitment: 'finalized' }],
    signal,
  );
  if (
    typeof response.value !== 'number' ||
    !Number.isSafeInteger(response.value) ||
    response.value < 0
  ) {
    throw new LocalnetFaucetError(
      'The local validator returned an invalid balance.',
      'invalid-response',
    );
  }
  return response.value;
}

async function rpc<T>(
  request: typeof globalThis.fetch,
  endpoint: URL,
  method: string,
  params: readonly unknown[],
  signal?: AbortSignal,
): Promise<T> {
  assertActive(signal);
  const requestId = `wetdrool-localnet-${method}`;
  let response: Response;
  try {
    response = await request(endpoint, {
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
    throw new LocalnetFaucetError('The local validator RPC request failed.', 'rpc-failure', {
      cause: error,
    });
  }
  if (!response.ok) {
    await cancelBody(response.body);
    throw new LocalnetFaucetError(
      `The local validator returned HTTP ${String(response.status)}.`,
      'rpc-failure',
    );
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    await cancelBody(response.body);
    throw new LocalnetFaucetError(
      'The local validator returned a non-JSON response.',
      'invalid-response',
    );
  }
  const text = await readBoundedText(response);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new LocalnetFaucetError(
      'The local validator returned invalid JSON.',
      'invalid-response',
      { cause: error },
    );
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new LocalnetFaucetError(
      'The local validator returned an invalid RPC envelope.',
      'invalid-response',
    );
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
    (!('result' in envelope) && envelope.error === undefined)
  ) {
    throw new LocalnetFaucetError(
      'The local validator returned a mismatched faucet RPC envelope.',
      'invalid-response',
    );
  }
  if (envelope.error !== undefined) {
    throw new LocalnetFaucetError(
      'The local-validator faucet RPC is temporarily unavailable.',
      'rpc-failure',
    );
  }
  return envelope.result as T;
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAXIMUM_RPC_RESPONSE_BYTES) {
      await cancelBody(response.body);
      throw new LocalnetFaucetError(
        'The local validator response exceeded its byte limit.',
        'invalid-response',
      );
    }
  }
  if (response.body === null) {
    throw new LocalnetFaucetError(
      'The local validator returned an empty response.',
      'invalid-response',
    );
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
        throw new LocalnetFaucetError(
          'The local validator response exceeded its byte limit.',
          'invalid-response',
        );
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
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new LocalnetFaucetError(
      'The local validator returned invalid UTF-8.',
      'invalid-response',
      { cause: error },
    );
  }
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Best effort after rejecting the response.
  }
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw aborted(signal.reason);
}

function aborted(cause?: unknown): LocalnetFaucetError {
  return new LocalnetFaucetError('The localnet funding request was cancelled.', 'aborted', {
    cause,
  });
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds === 0) {
    assertActive(signal);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = setTimeout(complete, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(aborted(signal?.reason));
    };
    if (signal !== undefined) {
      signal.addEventListener('abort', abort, { once: true });
    }
    if (signal?.aborted === true) abort();
  });
}

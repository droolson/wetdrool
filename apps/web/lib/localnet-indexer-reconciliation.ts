import {
  IndexerPayloadError,
  parsePostResponse,
  readIndexerJson,
  type PostResponse,
} from '@wetdrool/indexer-client';
import { identityIdSchema, solanaPublicKeySchema, unsigned64Schema } from '@wetdrool/protocol';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export interface LocalnetIndexerWaitOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly maximumAttempts?: number;
  readonly pollDelayMilliseconds?: number;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface ExpectedIndexedIdentity {
  readonly identityId: string;
  readonly minimumSequence: bigint;
  readonly minimumSlot: bigint;
  readonly rootAuthority: string;
}

export interface IndexedIdentityProof {
  readonly active: true;
  readonly identityId: string;
  readonly identitySequence: bigint;
  readonly rootAuthority: string;
  readonly rootRotationCount: bigint;
  readonly updatedSlot: bigint;
}

export interface ExpectedIndexedPost {
  readonly authorIdentityId: string;
  readonly body: string;
  readonly cid: string;
  readonly finalizedSlot: bigint;
  readonly language: 'und';
  readonly objectId: string;
  readonly payloadHash: string;
  readonly transactionSignature: string;
}

export class LocalnetIndexerReconciliationError extends Error {
  override readonly name = 'LocalnetIndexerReconciliationError';

  constructor(
    message: string,
    readonly code: 'aborted' | 'invalid-config' | 'invalid-response' | 'timeout',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export async function waitForIndexedIdentity(
  options: LocalnetIndexerWaitOptions,
  expectedInput: ExpectedIndexedIdentity,
  abortSignal?: AbortSignal,
): Promise<IndexedIdentityProof> {
  const client = parseOptions(options);
  const expected = parseExpectedIdentity(expectedInput);
  const endpoint = new URL(
    `v1/identities/${encodeURIComponent(expected.identityId)}/security`,
    client.baseUrl,
  );

  for (let attempt = 0; attempt < client.maximumAttempts; attempt += 1) {
    assertActive(abortSignal);
    const response = await request(client.fetch, endpoint, abortSignal);
    if (response.status === 404 || response.status === 503) {
      await client.sleep(client.pollDelayMilliseconds, abortSignal);
      continue;
    }
    if (!response.ok) {
      await cancelBody(response.body);
      throw new LocalnetIndexerReconciliationError(
        `The local indexer returned HTTP ${String(response.status)} while selecting the identity.`,
        'invalid-response',
      );
    }
    let proof: IndexedIdentityProof;
    try {
      proof = parseIdentitySecurityResponse(await readIndexerJson(response), expected);
    } catch (error) {
      throw new LocalnetIndexerReconciliationError(
        'The local indexer returned an identity that did not match the finalized passkey root.',
        'invalid-response',
        { cause: error },
      );
    }
    if (
      proof.updatedSlot >= expected.minimumSlot &&
      proof.identitySequence >= expected.minimumSequence
    ) {
      return proof;
    }
    await client.sleep(client.pollDelayMilliseconds, abortSignal);
  }

  throw new LocalnetIndexerReconciliationError(
    'The local indexer did not cover the finalized identity before the bounded deadline.',
    'timeout',
  );
}

export async function waitForIndexedPost(
  options: LocalnetIndexerWaitOptions,
  expectedInput: ExpectedIndexedPost,
  abortSignal?: AbortSignal,
): Promise<PostResponse> {
  const client = parseOptions(options);
  const expected = parseExpectedPost(expectedInput);
  const endpoint = new URL(`v1/posts/${encodeURIComponent(expected.objectId)}`, client.baseUrl);

  for (let attempt = 0; attempt < client.maximumAttempts; attempt += 1) {
    assertActive(abortSignal);
    const response = await request(client.fetch, endpoint, abortSignal);
    if (response.status === 404 || response.status === 503) {
      await client.sleep(client.pollDelayMilliseconds, abortSignal);
      continue;
    }
    if (!response.ok) {
      await cancelBody(response.body);
      throw new LocalnetIndexerReconciliationError(
        `The local indexer returned HTTP ${String(response.status)} while reconciling the post.`,
        'invalid-response',
      );
    }

    let indexed: PostResponse;
    try {
      indexed = parsePostResponse(await readIndexerJson(response));
      assertPostMatches(indexed, expected);
    } catch (error) {
      throw new LocalnetIndexerReconciliationError(
        'The local indexer returned a post that did not match the finalized publication.',
        'invalid-response',
        { cause: error },
      );
    }
    if (
      indexed.meta.checkpointSlot !== null &&
      BigInt(indexed.meta.checkpointSlot) >= expected.finalizedSlot
    ) {
      return indexed;
    }
    await client.sleep(client.pollDelayMilliseconds, abortSignal);
  }

  throw new LocalnetIndexerReconciliationError(
    'The post finalized on Solana, but the local indexer did not cover its slot before the bounded deadline.',
    'timeout',
  );
}

function parseIdentitySecurityResponse(
  input: unknown,
  expected: ReturnType<typeof parseExpectedIdentity>,
): IndexedIdentityProof {
  const response = record(input, 'identity security response');
  exactKeys(response, 'identity security response', ['canonical', 'delegations', 'identity']);
  if (response.canonical !== false || !Array.isArray(response.delegations)) {
    throw new IndexerPayloadError(
      'The identity security response must be a noncanonical projection with delegations.',
    );
  }
  const identity = record(response.identity, 'identity security response.identity');
  exactKeys(identity, 'identity security response.identity', [
    'active',
    'deactivatedAt',
    'deactivatedSlot',
    'identityId',
    'identitySequence',
    'rootAuthority',
    'rootRotationCount',
    'updatedSlot',
  ]);
  const identityId = canonicalIdentityId(identity.identityId);
  const rootAuthority = canonicalPublicKey(identity.rootAuthority, 'root authority');
  const rootRotationCount = canonicalU64(identity.rootRotationCount, 'root rotation count');
  const identitySequence = canonicalU64(identity.identitySequence, 'identity sequence');
  const updatedSlot = canonicalU64(identity.updatedSlot, 'identity updated slot');
  if (
    identity.active !== true ||
    identity.deactivatedAt !== undefined ||
    identity.deactivatedSlot !== undefined ||
    identityId !== expected.identityId ||
    rootAuthority !== expected.rootAuthority
  ) {
    throw new IndexerPayloadError(
      'The indexed identity is inactive, substituted, or controlled by another root.',
    );
  }
  return {
    active: true,
    identityId,
    identitySequence,
    rootAuthority,
    rootRotationCount,
    updatedSlot,
  };
}

function assertPostMatches(
  indexed: PostResponse,
  expected: ReturnType<typeof parseExpectedPost>,
): void {
  const { post } = indexed;
  const anchor = post.verification.anchor;
  // Consumer `createdAt` is finalized event block time so authors cannot
  // backdate or future-date feed chronology. The signed manifest timestamp is
  // already bound by the exact CID, payload hash, and verified signature and
  // therefore must not be compared to this separate chronology field.
  if (
    post.id !== expected.objectId ||
    post.author.identityId !== expected.authorIdentityId ||
    post.body !== expected.body ||
    post.language !== expected.language ||
    post.bodyReference !== null ||
    post.media.length !== 0 ||
    post.verification.state !== 'verified' ||
    !post.verification.signatureValid ||
    !post.verification.contentHashValid ||
    post.verification.contentHash !== expected.payloadHash ||
    post.verification.manifestUri !== `ipfs://${expected.cid}` ||
    anchor === null ||
    anchor.finality !== 'finalized' ||
    BigInt(anchor.slot) !== expected.finalizedSlot ||
    anchor.transaction !== expected.transactionSignature
  ) {
    throw new IndexerPayloadError(
      'The indexed post does not exactly match the signed manifest and finalized anchor.',
    );
  }
}

function parseExpectedIdentity(input: ExpectedIndexedIdentity) {
  const identityId = canonicalIdentityId(input.identityId);
  const rootAuthority = canonicalPublicKey(input.rootAuthority, 'expected root authority');
  return {
    identityId,
    minimumSequence: boundedBigInt(input.minimumSequence, 'minimum identity sequence'),
    minimumSlot: boundedBigInt(input.minimumSlot, 'minimum identity slot'),
    rootAuthority,
  };
}

function parseExpectedPost(input: ExpectedIndexedPost) {
  if (
    typeof input.objectId !== 'string' ||
    !input.objectId.startsWith('wetdroolobj:v1:post:') ||
    typeof input.cid !== 'string' ||
    !input.cid.startsWith('bafk') ||
    typeof input.payloadHash !== 'string' ||
    !input.payloadHash.startsWith('u') ||
    typeof input.transactionSignature !== 'string' ||
    input.transactionSignature.length > 160 ||
    typeof input.body !== 'string' ||
    input.body.length === 0 ||
    input.language !== 'und'
  ) {
    throw new LocalnetIndexerReconciliationError(
      'The expected post reconciliation coordinates are invalid.',
      'invalid-config',
    );
  }
  return {
    ...input,
    authorIdentityId: canonicalIdentityId(input.authorIdentityId),
    finalizedSlot: boundedBigInt(input.finalizedSlot, 'finalized post slot'),
  };
}

function parseOptions(options: LocalnetIndexerWaitOptions) {
  const baseUrl = loopbackUrl(options.baseUrl);
  const maximumAttempts = options.maximumAttempts ?? 60;
  const pollDelayMilliseconds = options.pollDelayMilliseconds ?? 250;
  if (
    !Number.isSafeInteger(maximumAttempts) ||
    maximumAttempts < 1 ||
    maximumAttempts > 600 ||
    !Number.isSafeInteger(pollDelayMilliseconds) ||
    pollDelayMilliseconds < 0 ||
    pollDelayMilliseconds > 5_000
  ) {
    throw new LocalnetIndexerReconciliationError(
      'The local indexer reconciliation bounds are invalid.',
      'invalid-config',
    );
  }
  return {
    baseUrl,
    fetch: options.fetch ?? globalThis.fetch,
    maximumAttempts,
    pollDelayMilliseconds,
    sleep: options.sleep ?? abortableDelay,
  };
}

function loopbackUrl(value: string): URL {
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
    endpoint.pathname = endpoint.pathname.endsWith('/')
      ? endpoint.pathname
      : `${endpoint.pathname}/`;
    return endpoint;
  } catch (error) {
    throw new LocalnetIndexerReconciliationError(
      'The local indexer must use an exact loopback HTTP endpoint.',
      'invalid-config',
      { cause: error },
    );
  }
}

function canonicalIdentityId(value: unknown): string {
  const parsed = identityIdSchema.safeParse(value);
  if (!parsed.success) throw new IndexerPayloadError('Identity ID is not canonical.');
  return parsed.data;
}

function canonicalPublicKey(value: unknown, label: string): string {
  const parsed = solanaPublicKeySchema.safeParse(value);
  if (!parsed.success) throw new IndexerPayloadError(`${label} is not a Solana public key.`);
  return parsed.data;
}

function canonicalU64(value: unknown, label: string): bigint {
  const parsed = unsigned64Schema.safeParse(value);
  if (!parsed.success) throw new IndexerPayloadError(`${label} is not a canonical u64.`);
  return BigInt(parsed.data);
}

function boundedBigInt(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > 18_446_744_073_709_551_615n) {
    throw new LocalnetIndexerReconciliationError(
      `The ${label} is outside the unsigned 64-bit range.`,
      'invalid-config',
    );
  }
  return value;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IndexerPayloadError(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, label: string, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new IndexerPayloadError(`${label} contains unsupported fields.`);
  }
}

async function request(
  fetch: typeof globalThis.fetch,
  endpoint: URL,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(endpoint, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) throw aborted(error);
    throw error;
  }
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw aborted(signal.reason);
}

function aborted(cause?: unknown): LocalnetIndexerReconciliationError {
  return new LocalnetIndexerReconciliationError(
    'The indexer reconciliation was cancelled.',
    'aborted',
    { cause },
  );
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
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted === true) abort();
  });
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Best effort after rejecting an unexpected response.
  }
}

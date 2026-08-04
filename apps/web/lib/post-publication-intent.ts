import {
  buildPostPayload,
  canonicalizePayload,
  cidSchema,
  decodeMultibaseBase64Url,
  digestSchema,
  encodeMultibaseBase64Url,
  equalBytes,
  identityIdSchema,
  networkIdSchema,
  objectIdSchema,
  postContentSchema,
  signingKeyIdSchema,
  solanaPublicKeySchema,
  timestampSchema,
  transactionSignatureSchema,
  unsigned64Schema,
  verifyEnvelope,
  type PostContent,
} from '@wetdrool/protocol';

import {
  normalizePreviewText,
  parseComposerDraft,
  validateComposerDraft,
  type ComposerDraft,
} from './composer-draft';

export const POST_PUBLICATION_INTENT_STORAGE_KEY = 'wetdrool:post-publication-intent:v1';
export const POST_PUBLICATION_INTENT_VERSION = 1 as const;
export const MAX_POST_PUBLICATION_INTENT_BYTES = 128 * 1_024;
export const MAX_SIGNED_POST_ENVELOPE_BYTES = 32 * 1_024;

const NONCE_BYTES = 16;
const U64_MAX = 18_446_744_073_709_551_615n;
const MAX_RECEIPT_STRING_BYTES = 2_048;
const MAX_PROVIDER_STRING_BYTES = 128;
const UTF8 = new TextEncoder();

export type PublishableDraftStoragePolicy = 'provider-default' | 'ipfs';
export type PostPublicationIntentStage = 'prepared' | 'signed' | 'stored' | 'finalized';

export interface PostPublicationIntentStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface PostPublicationContext {
  readonly network: string;
  readonly identity: string;
  readonly rootSigningKey: string;
  readonly expectedAuthorSequence: string;
  readonly createdAt: string;
  readonly postNonce: string;
  readonly payloadNonce: string;
  readonly postPda: string;
  readonly storagePolicy: PublishableDraftStoragePolicy;
  readonly content: PostContent;
}

export interface SignedPostPublicationArtifact {
  /** Multibase base64url encoding of the exact canonical signed-envelope bytes. */
  readonly envelopeBytes: string;
  readonly objectId: string;
  readonly cid: string;
  readonly payloadHash: string;
}

export interface PostPublicationStorageReceipt {
  readonly cid: string;
  readonly provider: string;
  readonly providerVersion: string;
  readonly locator: string;
  readonly byteLength: number;
  /** Browser-observed receipt time; not a provider-attested timestamp. */
  readonly publishedAt: string;
  readonly policy: {
    readonly permanence: 'deletion-compatible' | 'provider-dependent';
    readonly consentId?: string;
  };
  readonly verified: true;
}

export interface FinalizedPostTransactionEvidence {
  readonly commitment: 'finalized';
  readonly transactionSignature: string;
  readonly finalizedSlot: string;
  readonly observedAuthorSequence: string;
  readonly postPda: string;
  readonly objectId: string;
  readonly cid: string;
  readonly payloadHash: string;
}

interface BasePostPublicationIntent {
  readonly version: typeof POST_PUBLICATION_INTENT_VERSION;
  readonly stage: PostPublicationIntentStage;
  readonly context: PostPublicationContext;
}

export interface PreparedPostPublicationIntent extends BasePostPublicationIntent {
  readonly stage: 'prepared';
}

export interface SignedPostPublicationIntent extends BasePostPublicationIntent {
  readonly stage: 'signed';
  readonly signed: SignedPostPublicationArtifact;
}

export interface StoredPostPublicationIntent extends BasePostPublicationIntent {
  readonly stage: 'stored';
  readonly signed: SignedPostPublicationArtifact;
  readonly storageReceipt: PostPublicationStorageReceipt;
}

export interface FinalizedPostPublicationIntent extends BasePostPublicationIntent {
  readonly stage: 'finalized';
  readonly signed: SignedPostPublicationArtifact;
  readonly storageReceipt: PostPublicationStorageReceipt;
  readonly finalizedTransaction: FinalizedPostTransactionEvidence;
}

export type PostPublicationIntent =
  | PreparedPostPublicationIntent
  | SignedPostPublicationIntent
  | StoredPostPublicationIntent
  | FinalizedPostPublicationIntent;

export type PostPublicationIntentErrorCode =
  | 'unsupported-draft'
  | 'invalid-input'
  | 'corrupt-state'
  | 'state-conflict'
  | 'storage-unavailable'
  | 'invalid-transition'
  | 'invalid-evidence';

export class PostPublicationIntentError extends Error {
  override readonly name = 'PostPublicationIntentError';

  constructor(
    readonly code: PostPublicationIntentErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface PreparePostPublicationIntentInput {
  readonly draft: ComposerDraft;
  readonly network: string;
  readonly identity: string;
  readonly rootSigningKey: string;
  readonly expectedAuthorSequence: bigint;
}

export interface PostPublicationIntentEnvironment {
  readonly derivePostPda: (input: {
    readonly network: string;
    readonly identity: string;
    readonly postNonce: Uint8Array;
  }) => string | Promise<string>;
  readonly now?: () => Date;
  readonly randomBytes?: (length: number) => Uint8Array;
}

export interface FinalizedPostTransactionInput {
  readonly commitment: 'finalized';
  readonly transactionSignature: string;
  readonly finalizedSlot: bigint;
  readonly observedAuthorSequence: bigint;
  readonly postPda: string;
  readonly objectId: string;
  readonly cid: string;
  readonly payloadHash: string;
}

/**
 * Maps the currently supported composer surface without guessing a language,
 * audience, encryption mode, or permission. `und` is the BCP-47 marker for an
 * undetermined language; unsupported "ask first" semantics fail closed.
 */
export function publicTextPostContentFromDraft(draftInput: ComposerDraft): PostContent {
  const draft = parseStrictComposerDraft(draftInput);
  const validation = validateComposerDraft(draft);
  if (!validation.valid) {
    throw publicationError(
      'unsupported-draft',
      'The composer draft is incomplete and cannot be prepared for publication.',
    );
  }
  if (
    draft.audience !== 'public' ||
    draft.communityId !== '' ||
    draft.media.sourceUrl !== '' ||
    draft.media.mediaType !== '' ||
    draft.media.altText !== ''
  ) {
    throw publicationError(
      'unsupported-draft',
      'Only a public plain-text draft without community or media metadata can be published.',
    );
  }
  if (draft.storagePolicy === 'arweave') {
    throw publicationError(
      'unsupported-draft',
      'Permanent storage is not available for this publication path.',
    );
  }
  if (draft.remixPermission === 'ask-first') {
    throw publicationError(
      'unsupported-draft',
      'The protocol cannot represent an ask-first quote policy without changing its meaning.',
    );
  }

  const replyPolicy = {
    everyone: 'anyone',
    following: 'followers',
    mentioned: 'mentioned',
    nobody: 'none',
  }[draft.replyPermission] as PostContent['replyPolicy'];
  const quotePolicy = draft.remixPermission === 'disabled' ? 'none' : 'allowed';
  const contentWarnings = draft.contentWarning.trim().length === 0 ? [] : [draft.contentWarning];

  const parsed = postContentSchema.safeParse({
    format: 'plain',
    body: draft.text,
    media: [],
    language: 'und',
    contentWarnings,
    accessibility: {
      altTextReminderAcknowledged: false,
      captionReferences: [],
    },
    visibility: { kind: 'public' },
    authorLabels: [],
    replyPolicy,
    quotePolicy,
  });
  if (!parsed.success) {
    throw publicationError(
      'unsupported-draft',
      'The draft cannot be represented exactly inside the bounded protocol post schema.',
      parsed.error,
    );
  }
  return normalizeSupportedPostContent(parsed.data);
}

/**
 * Creates and persists all nondeterministic publication coordinates before a
 * signer is invoked. A retry with the same input reuses the stored coordinates;
 * any changed input fails closed.
 */
export async function preparePostPublicationIntent(
  storage: PostPublicationIntentStorage,
  input: PreparePostPublicationIntentInput,
  environment: PostPublicationIntentEnvironment,
): Promise<PostPublicationIntent> {
  if (typeof environment.derivePostPda !== 'function') {
    throw publicationError('invalid-input', 'A deterministic post-PDA derivation is required.');
  }
  const requested = normalizePreparationInput(input);
  const existing = await loadPostPublicationIntent(storage);
  if (existing !== null) {
    assertSamePreparation(existing.context, requested);
    const derived = await deriveAndValidatePostPda(
      environment.derivePostPda,
      existing.context.network,
      existing.context.identity,
      decodeNonce(existing.context.postNonce),
    );
    if (derived !== existing.context.postPda) {
      throw publicationError(
        'state-conflict',
        'The stored post nonce no longer derives the stored post PDA.',
      );
    }
    return existing;
  }

  const now = environment.now?.() ?? new Date();
  const createdAt = timestampFromDate(now);
  const randomBytes = environment.randomBytes ?? secureRandomBytes;
  const postNonceBytes = generateNonce(randomBytes, 'post');
  const payloadNonceBytes = generateNonce(randomBytes, 'payload');
  const postPda = await deriveAndValidatePostPda(
    environment.derivePostPda,
    requested.network,
    requested.identity,
    postNonceBytes,
  );
  const state: PreparedPostPublicationIntent = {
    version: POST_PUBLICATION_INTENT_VERSION,
    stage: 'prepared',
    context: {
      network: requested.network,
      identity: requested.identity,
      rootSigningKey: requested.rootSigningKey,
      expectedAuthorSequence: requested.expectedAuthorSequence,
      createdAt,
      postNonce: encodeMultibaseBase64Url(postNonceBytes),
      payloadNonce: encodeMultibaseBase64Url(payloadNonceBytes),
      postPda,
      storagePolicy: requested.storagePolicy,
      content: requested.content,
    },
  };
  return persistTransition(storage, null, state);
}

/**
 * Reconstructs the only payload a signer may sign for this intent. No current
 * SDK publication API is involved; every nondeterministic field comes from the
 * already-persisted context.
 */
export function buildPostPayloadForIntent(intent: PostPublicationIntent) {
  return buildPostPayload(
    {
      network: networkIdSchema.parse(intent.context.network),
      author: intent.context.identity,
      signingKey: intent.context.rootSigningKey,
    },
    intent.context.content,
    {
      createdAt: new Date(intent.context.createdAt),
      nonce: decodeNonce(intent.context.payloadNonce),
    },
  );
}

export async function recordSignedPostEnvelope(
  storage: PostPublicationIntentStorage,
  envelopeBytesInput: Uint8Array,
): Promise<PostPublicationIntent> {
  const current = await requirePostPublicationIntent(storage);
  const encodedInput = encodeEnvelopeInput(envelopeBytesInput);
  if (current.stage !== 'prepared') {
    if (current.signed.envelopeBytes === encodedInput) {
      return current;
    }
    throw publicationError(
      'state-conflict',
      'A different signed envelope is already bound to this publication intent.',
    );
  }

  const signed = await inspectSignedEnvelope(
    envelopeBytesInput,
    current.context,
    'invalid-evidence',
  );
  const next: SignedPostPublicationIntent = {
    version: POST_PUBLICATION_INTENT_VERSION,
    stage: 'signed',
    context: current.context,
    signed,
  };
  return persistTransition(storage, current, next);
}

export async function recordPostStorageReceipt(
  storage: PostPublicationIntentStorage,
  receiptInput: PostPublicationStorageReceipt,
): Promise<PostPublicationIntent> {
  const current = await requirePostPublicationIntent(storage);
  if (current.stage === 'prepared') {
    throw publicationError(
      'invalid-transition',
      'A storage receipt cannot be recorded before the exact envelope is signed.',
    );
  }
  const receipt = normalizeStorageReceipt(receiptInput, current.context, current.signed);
  if (current.stage === 'stored' || current.stage === 'finalized') {
    if (canonicalJson(current.storageReceipt) === canonicalJson(receipt)) {
      return current;
    }
    throw publicationError(
      'state-conflict',
      'A different storage receipt is already bound to this publication intent.',
    );
  }

  const next: StoredPostPublicationIntent = {
    version: POST_PUBLICATION_INTENT_VERSION,
    stage: 'stored',
    context: current.context,
    signed: current.signed,
    storageReceipt: receipt,
  };
  return persistTransition(storage, current, next);
}

export async function recordFinalizedPostTransaction(
  storage: PostPublicationIntentStorage,
  evidenceInput: FinalizedPostTransactionInput,
): Promise<PostPublicationIntent> {
  const current = await requirePostPublicationIntent(storage);
  if (current.stage === 'prepared' || current.stage === 'signed') {
    throw publicationError(
      'invalid-transition',
      'Finalized transaction evidence cannot be recorded before verified storage.',
    );
  }
  const evidence = normalizeFinalizedEvidence(evidenceInput, current.context, current.signed);
  if (current.stage === 'finalized') {
    if (canonicalJson(current.finalizedTransaction) === canonicalJson(evidence)) {
      return current;
    }
    throw publicationError(
      'state-conflict',
      'Finalized publication evidence is immutable and cannot be replaced.',
    );
  }

  const next: FinalizedPostPublicationIntent = {
    version: POST_PUBLICATION_INTENT_VERSION,
    stage: 'finalized',
    context: current.context,
    signed: current.signed,
    storageReceipt: current.storageReceipt,
    finalizedTransaction: evidence,
  };
  return persistTransition(storage, current, next);
}

export function serializePostPublicationIntent(intent: PostPublicationIntent): string {
  return JSON.stringify(intent);
}

export async function parsePostPublicationIntent(
  serialized: string,
): Promise<PostPublicationIntent> {
  if (
    typeof serialized !== 'string' ||
    UTF8.encode(serialized).byteLength > MAX_POST_PUBLICATION_INTENT_BYTES
  ) {
    throw publicationError(
      'corrupt-state',
      'The saved publication intent exceeds its local schema size limit.',
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw publicationError(
      'corrupt-state',
      'The saved publication intent is not valid JSON.',
      error,
    );
  }
  if (
    !isRecord(value) ||
    value.version !== POST_PUBLICATION_INTENT_VERSION ||
    !isStage(value.stage)
  ) {
    throw publicationError(
      'corrupt-state',
      'The saved publication intent has an unsupported version or stage.',
    );
  }

  try {
    const context = parseContext(value.context);
    let state: PostPublicationIntent;
    switch (value.stage) {
      case 'prepared': {
        assertExactKeys(value, ['version', 'stage', 'context']);
        state = {
          version: POST_PUBLICATION_INTENT_VERSION,
          stage: 'prepared',
          context,
        };
        break;
      }
      case 'signed': {
        assertExactKeys(value, ['version', 'stage', 'context', 'signed']);
        state = {
          version: POST_PUBLICATION_INTENT_VERSION,
          stage: 'signed',
          context,
          signed: await parseSignedArtifact(value.signed, context),
        };
        break;
      }
      case 'stored': {
        assertExactKeys(value, ['version', 'stage', 'context', 'signed', 'storageReceipt']);
        const signed = await parseSignedArtifact(value.signed, context);
        state = {
          version: POST_PUBLICATION_INTENT_VERSION,
          stage: 'stored',
          context,
          signed,
          storageReceipt: parseStorageReceipt(value.storageReceipt, context, signed),
        };
        break;
      }
      case 'finalized': {
        assertExactKeys(value, [
          'version',
          'stage',
          'context',
          'signed',
          'storageReceipt',
          'finalizedTransaction',
        ]);
        const signed = await parseSignedArtifact(value.signed, context);
        state = {
          version: POST_PUBLICATION_INTENT_VERSION,
          stage: 'finalized',
          context,
          signed,
          storageReceipt: parseStorageReceipt(value.storageReceipt, context, signed),
          finalizedTransaction: parseFinalizedEvidence(value.finalizedTransaction, context, signed),
        };
        break;
      }
    }
    if (serializePostPublicationIntent(state) !== serialized) {
      throw publicationError(
        'corrupt-state',
        'The saved publication intent is not in its canonical JSON representation.',
      );
    }
    return state;
  } catch (error) {
    if (error instanceof PostPublicationIntentError) {
      throw error;
    }
    throw publicationError(
      'corrupt-state',
      'The saved publication intent violates its canonical schema.',
      error,
    );
  }
}

export async function loadPostPublicationIntent(
  storage: PostPublicationIntentStorage,
): Promise<PostPublicationIntent | null> {
  let serialized: string | null;
  try {
    serialized = storage.getItem(POST_PUBLICATION_INTENT_STORAGE_KEY);
  } catch (error) {
    throw publicationError(
      'storage-unavailable',
      'Browser storage is unavailable; publication cannot safely continue.',
      error,
    );
  }
  return serialized === null ? null : parsePostPublicationIntent(serialized);
}

/**
 * Retires one exact finalized intent only after its caller has independently
 * observed the indexed checkpoint. Passing the expected state makes retries
 * idempotent and prevents a stale completion handler from clearing a different
 * publication.
 */
export async function acknowledgeFinalizedPostPublicationIntent(
  storage: PostPublicationIntentStorage,
  expected: FinalizedPostPublicationIntent,
): Promise<void> {
  const expectedSerialized = serializePostPublicationIntent(expected);
  const parsedExpected = await parsePostPublicationIntent(expectedSerialized);
  if (parsedExpected.stage !== 'finalized') {
    throw publicationError(
      'invalid-transition',
      'Only an exact finalized publication intent can be acknowledged.',
    );
  }

  let observed: string | null;
  try {
    observed = storage.getItem(POST_PUBLICATION_INTENT_STORAGE_KEY);
  } catch (error) {
    throw publicationError(
      'storage-unavailable',
      'Browser storage could not be read before publication acknowledgement.',
      error,
    );
  }
  if (observed === null) return;
  if (observed !== expectedSerialized) {
    throw publicationError(
      'state-conflict',
      'A different publication intent is active; refusing to acknowledge it.',
    );
  }

  try {
    storage.removeItem(POST_PUBLICATION_INTENT_STORAGE_KEY);
    observed = storage.getItem(POST_PUBLICATION_INTENT_STORAGE_KEY);
  } catch (error) {
    throw publicationError(
      'storage-unavailable',
      'Browser storage could not retire the completed publication intent.',
      error,
    );
  }
  if (observed !== null) {
    throw publicationError(
      observed === expectedSerialized ? 'storage-unavailable' : 'state-conflict',
      observed === expectedSerialized
        ? 'Browser storage did not retire the completed publication intent.'
        : 'A conflicting browser context replaced the completed publication intent.',
    );
  }
}

interface NormalizedPreparation {
  readonly network: string;
  readonly identity: string;
  readonly rootSigningKey: string;
  readonly expectedAuthorSequence: string;
  readonly storagePolicy: PublishableDraftStoragePolicy;
  readonly content: PostContent;
}

function normalizePreparationInput(
  input: PreparePostPublicationIntentInput,
): NormalizedPreparation {
  const networkResult = networkIdSchema.safeParse(input.network);
  const identityResult = identityIdSchema.safeParse(input.identity);
  const rootResult = signingKeyIdSchema.safeParse(input.rootSigningKey);
  if (!networkResult.success || !identityResult.success || !rootResult.success) {
    throw publicationError(
      'invalid-input',
      'The DroolNet network, identity, or root signing-key identifier is invalid.',
    );
  }
  const network = networkResult.data;
  const identity = identityResult.data;
  const rootSigningKey = rootResult.data;
  if (
    !identity.startsWith(`wetdroolid:v1:${network}:`) ||
    !rootSigningKey.startsWith(`${identity}#root/`)
  ) {
    throw publicationError(
      'invalid-input',
      'The identity and root signing key must belong to the selected DroolNet network.',
    );
  }
  if (
    typeof input.expectedAuthorSequence !== 'bigint' ||
    input.expectedAuthorSequence < 0n ||
    input.expectedAuthorSequence >= U64_MAX
  ) {
    throw publicationError(
      'invalid-input',
      'The expected author sequence must be an incrementable unsigned 64-bit integer.',
    );
  }
  const content = publicTextPostContentFromDraft(input.draft);
  const storagePolicy = input.draft.storagePolicy;
  if (storagePolicy === 'arweave') {
    throw publicationError(
      'unsupported-draft',
      'Permanent storage is not available for this publication path.',
    );
  }
  return {
    network,
    identity,
    rootSigningKey,
    expectedAuthorSequence: input.expectedAuthorSequence.toString(),
    storagePolicy,
    content,
  };
}

function parseStrictComposerDraft(input: ComposerDraft): ComposerDraft {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'audience',
      'communityId',
      'contentWarning',
      'media',
      'remixPermission',
      'replyPermission',
      'storagePolicy',
      'text',
      'version',
    ]) ||
    !isRecord(input.media) ||
    !hasExactKeys(input.media, ['altText', 'mediaType', 'sourceUrl'])
  ) {
    throw publicationError(
      'unsupported-draft',
      'The composer draft does not match the exact supported local schema.',
    );
  }

  let parsed: ComposerDraft | null;
  try {
    parsed = parseComposerDraft(JSON.stringify(input));
  } catch {
    parsed = null;
  }
  if (
    parsed === null ||
    parsed.text !== input.text ||
    parsed.contentWarning !== input.contentWarning ||
    parsed.communityId !== input.communityId ||
    parsed.media.altText !== input.media.altText ||
    parsed.media.mediaType !== input.media.mediaType ||
    parsed.media.sourceUrl !== input.media.sourceUrl
  ) {
    throw publicationError(
      'unsupported-draft',
      'The draft contains noncanonical or unsupported values.',
    );
  }
  return parsed;
}

function assertSamePreparation(
  context: PostPublicationContext,
  requested: NormalizedPreparation,
): void {
  if (
    context.network !== requested.network ||
    context.identity !== requested.identity ||
    context.rootSigningKey !== requested.rootSigningKey ||
    context.expectedAuthorSequence !== requested.expectedAuthorSequence ||
    context.storagePolicy !== requested.storagePolicy ||
    canonicalJson(context.content) !== canonicalJson(requested.content)
  ) {
    throw publicationError(
      'state-conflict',
      'A different draft or identity is already bound to the active publication intent.',
    );
  }
}

function timestampFromDate(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw publicationError('invalid-input', 'Publication creation time must be a valid Date.');
  }
  const timestamp = value.toISOString();
  if (!timestampSchema.safeParse(timestamp).success) {
    throw publicationError(
      'invalid-input',
      'Publication creation time must use exact UTC milliseconds.',
    );
  }
  return timestamp;
}

function secureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function generateNonce(
  generator: (length: number) => Uint8Array,
  label: 'post' | 'payload',
): Uint8Array {
  let generated: Uint8Array;
  try {
    generated = generator(NONCE_BYTES);
  } catch (error) {
    throw publicationError('invalid-input', `Secure ${label}-nonce generation failed.`, error);
  }
  if (!(generated instanceof Uint8Array) || generated.byteLength !== NONCE_BYTES) {
    throw publicationError(
      'invalid-input',
      `The ${label}-nonce generator must return exactly ${NONCE_BYTES} bytes.`,
    );
  }
  return Uint8Array.from(generated);
}

async function deriveAndValidatePostPda(
  derive: PostPublicationIntentEnvironment['derivePostPda'],
  network: string,
  identity: string,
  postNonce: Uint8Array,
): Promise<string> {
  let derived: string;
  try {
    derived = await derive({
      network,
      identity,
      postNonce: Uint8Array.from(postNonce),
    });
  } catch (error) {
    throw publicationError('invalid-input', 'Post-PDA derivation failed.', error);
  }
  const parsed = solanaPublicKeySchema.safeParse(derived);
  if (!parsed.success) {
    throw publicationError('invalid-input', 'Post-PDA derivation returned an invalid address.');
  }
  return parsed.data;
}

function encodeEnvelopeInput(bytesInput: Uint8Array): string {
  if (
    !(bytesInput instanceof Uint8Array) ||
    bytesInput.byteLength === 0 ||
    bytesInput.byteLength > MAX_SIGNED_POST_ENVELOPE_BYTES
  ) {
    throw publicationError(
      'invalid-evidence',
      'Signed-envelope bytes are empty or exceed the publication size limit.',
    );
  }
  return encodeMultibaseBase64Url(bytesInput);
}

async function inspectSignedEnvelope(
  bytesInput: Uint8Array,
  context: PostPublicationContext,
  errorCode: 'corrupt-state' | 'invalid-evidence',
): Promise<SignedPostPublicationArtifact> {
  const envelopeBytes = encodeEnvelopeInput(bytesInput);
  const bytes = Uint8Array.from(bytesInput);
  try {
    const verified = await verifyEnvelope(bytes);
    if (!equalBytes(verified.canonicalBytes, bytes)) {
      throw new TypeError('The signed envelope is not byte-for-byte canonical.');
    }
    const expectedPayload = buildPostPayload(
      {
        network: networkIdSchema.parse(context.network),
        author: context.identity,
        signingKey: context.rootSigningKey,
      },
      context.content,
      {
        createdAt: new Date(context.createdAt),
        nonce: decodeNonce(context.payloadNonce),
      },
    );
    if (
      verified.envelope.payload.type !== 'post' ||
      !equalBytes(
        canonicalizePayload(verified.envelope.payload),
        canonicalizePayload(expectedPayload),
      )
    ) {
      throw new TypeError('The signed envelope does not contain the prepared post payload.');
    }
    return {
      envelopeBytes,
      objectId: verified.objectId,
      cid: verified.cid,
      payloadHash: verified.envelope.proof.payloadHash,
    };
  } catch (error) {
    throw publicationError(
      errorCode,
      'The signed envelope is invalid or conflicts with the prepared publication intent.',
      error,
    );
  }
}

function normalizeStorageReceipt(
  input: PostPublicationStorageReceipt,
  context: PostPublicationContext,
  signed: SignedPostPublicationArtifact,
): PostPublicationStorageReceipt {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'cid',
      'provider',
      'providerVersion',
      'locator',
      'byteLength',
      'publishedAt',
      'policy',
      'verified',
    ]) ||
    !isRecord(input.policy) ||
    !hasOnlyKeys(input.policy, ['permanence', 'consentId'])
  ) {
    throw publicationError('invalid-evidence', 'The storage receipt has an invalid shape.');
  }
  const decodedEnvelope = decodeStoredEnvelope(signed.envelopeBytes, 'invalid-evidence');
  const validStrings =
    isBoundedNonemptyString(input.provider, MAX_PROVIDER_STRING_BYTES) &&
    isBoundedNonemptyString(input.providerVersion, MAX_PROVIDER_STRING_BYTES) &&
    isBoundedNonemptyString(input.locator, MAX_RECEIPT_STRING_BYTES);
  const validPolicy =
    input.policy.permanence === 'deletion-compatible' ||
    input.policy.permanence === 'provider-dependent';
  const consentId =
    input.policy.consentId === undefined
      ? undefined
      : isBoundedNonemptyString(input.policy.consentId, MAX_PROVIDER_STRING_BYTES)
        ? input.policy.consentId
        : null;
  if (
    input.cid !== signed.cid ||
    !cidSchema.safeParse(input.cid).success ||
    !validStrings ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength !== decodedEnvelope.byteLength ||
    !timestampSchema.safeParse(input.publishedAt).success ||
    Date.parse(input.publishedAt) < Date.parse(context.createdAt) ||
    !validPolicy ||
    consentId === null ||
    input.verified !== true
  ) {
    throw publicationError(
      'invalid-evidence',
      'The storage receipt does not verify the exact non-permanent signed envelope.',
    );
  }
  return {
    cid: input.cid,
    provider: input.provider,
    providerVersion: input.providerVersion,
    locator: input.locator,
    byteLength: input.byteLength,
    publishedAt: input.publishedAt,
    policy: {
      permanence: input.policy.permanence,
      ...(consentId === undefined ? {} : { consentId }),
    },
    verified: true,
  };
}

function normalizeFinalizedEvidence(
  input: FinalizedPostTransactionInput,
  context: PostPublicationContext,
  signed: SignedPostPublicationArtifact,
): FinalizedPostTransactionEvidence {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'commitment',
      'transactionSignature',
      'finalizedSlot',
      'observedAuthorSequence',
      'postPda',
      'objectId',
      'cid',
      'payloadHash',
    ]) ||
    input.commitment !== 'finalized' ||
    typeof input.finalizedSlot !== 'bigint' ||
    input.finalizedSlot <= 0n ||
    typeof input.observedAuthorSequence !== 'bigint'
  ) {
    throw publicationError(
      'invalid-evidence',
      'Transaction evidence must report a positive finalized slot and exact sequence.',
    );
  }
  const evidence: FinalizedPostTransactionEvidence = {
    commitment: 'finalized',
    transactionSignature: String(input.transactionSignature),
    finalizedSlot: input.finalizedSlot.toString(),
    observedAuthorSequence: input.observedAuthorSequence.toString(),
    postPda: String(input.postPda),
    objectId: String(input.objectId),
    cid: String(input.cid),
    payloadHash: String(input.payloadHash),
  };
  assertFinalizedEvidence(evidence, context, signed, 'invalid-evidence');
  return evidence;
}

function assertFinalizedEvidence(
  evidence: FinalizedPostTransactionEvidence,
  context: PostPublicationContext,
  signed: SignedPostPublicationArtifact,
  code: 'corrupt-state' | 'invalid-evidence',
): void {
  const expectedSequence = BigInt(context.expectedAuthorSequence) + 1n;
  if (
    evidence.commitment !== 'finalized' ||
    !transactionSignatureSchema.safeParse(evidence.transactionSignature).success ||
    !unsigned64Schema.safeParse(evidence.finalizedSlot).success ||
    BigInt(evidence.finalizedSlot) === 0n ||
    !unsigned64Schema.safeParse(evidence.observedAuthorSequence).success ||
    BigInt(evidence.observedAuthorSequence) !== expectedSequence ||
    evidence.postPda !== context.postPda ||
    evidence.objectId !== signed.objectId ||
    evidence.cid !== signed.cid ||
    evidence.payloadHash !== signed.payloadHash
  ) {
    throw publicationError(
      code,
      'Finalized transaction evidence does not match the prepared and signed publication.',
    );
  }
}

function parseContext(value: unknown): PostPublicationContext {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'network',
      'identity',
      'rootSigningKey',
      'expectedAuthorSequence',
      'createdAt',
      'postNonce',
      'payloadNonce',
      'postPda',
      'storagePolicy',
      'content',
    ]) ||
    !networkIdSchema.safeParse(value.network).success ||
    !identityIdSchema.safeParse(value.identity).success ||
    !signingKeyIdSchema.safeParse(value.rootSigningKey).success ||
    !unsigned64Schema.safeParse(value.expectedAuthorSequence).success ||
    BigInt(value.expectedAuthorSequence as string) >= U64_MAX ||
    !timestampSchema.safeParse(value.createdAt).success ||
    !solanaPublicKeySchema.safeParse(value.postPda).success ||
    (value.storagePolicy !== 'provider-default' && value.storagePolicy !== 'ipfs')
  ) {
    throw publicationError('corrupt-state', 'The saved publication context is invalid.');
  }
  const network = value.network as string;
  const identity = value.identity as string;
  const rootSigningKey = value.rootSigningKey as string;
  if (
    !identity.startsWith(`wetdroolid:v1:${network}:`) ||
    !rootSigningKey.startsWith(`${identity}#root/`)
  ) {
    throw publicationError(
      'corrupt-state',
      'The saved identity and root key do not belong to the saved network.',
    );
  }
  decodeNonce(value.postNonce);
  decodeNonce(value.payloadNonce);
  return {
    network,
    identity,
    rootSigningKey,
    expectedAuthorSequence: value.expectedAuthorSequence as string,
    createdAt: value.createdAt as string,
    postNonce: value.postNonce as string,
    payloadNonce: value.payloadNonce as string,
    postPda: value.postPda as string,
    storagePolicy: value.storagePolicy,
    content: parseSupportedPostContent(value.content),
  };
}

function parseSupportedPostContent(value: unknown): PostContent {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'format',
      'body',
      'media',
      'language',
      'contentWarnings',
      'accessibility',
      'visibility',
      'authorLabels',
      'replyPolicy',
      'quotePolicy',
    ]) ||
    value.format !== 'plain' ||
    typeof value.body !== 'string' ||
    value.body.trim().length === 0 ||
    normalizePreviewText(value.body) !== value.body ||
    !Array.isArray(value.media) ||
    value.media.length !== 0 ||
    value.language !== 'und' ||
    !Array.isArray(value.contentWarnings) ||
    value.contentWarnings.length > 1 ||
    !isRecord(value.accessibility) ||
    !hasExactKeys(value.accessibility, ['altTextReminderAcknowledged', 'captionReferences']) ||
    value.accessibility.altTextReminderAcknowledged !== false ||
    !Array.isArray(value.accessibility.captionReferences) ||
    value.accessibility.captionReferences.length !== 0 ||
    !isRecord(value.visibility) ||
    !hasExactKeys(value.visibility, ['kind']) ||
    value.visibility.kind !== 'public' ||
    !Array.isArray(value.authorLabels) ||
    value.authorLabels.length !== 0 ||
    !['anyone', 'followers', 'mentioned', 'none'].includes(String(value.replyPolicy)) ||
    !['allowed', 'none'].includes(String(value.quotePolicy))
  ) {
    throw publicationError(
      'corrupt-state',
      'The saved post content is outside the supported public text schema.',
    );
  }
  if (
    value.contentWarnings.some(
      (warning) =>
        typeof warning !== 'string' ||
        warning.trim().length === 0 ||
        normalizePreviewText(warning) !== warning,
    )
  ) {
    throw publicationError('corrupt-state', 'The saved content warning is invalid.');
  }
  const parsed = postContentSchema.safeParse(value);
  if (!parsed.success) {
    throw publicationError(
      'corrupt-state',
      'The saved post content violates the protocol schema.',
      parsed.error,
    );
  }
  return normalizeSupportedPostContent(parsed.data);
}

function normalizeSupportedPostContent(content: PostContent): PostContent {
  return {
    format: 'plain',
    body: content.body,
    media: [],
    language: 'und',
    contentWarnings: [...content.contentWarnings],
    accessibility: {
      altTextReminderAcknowledged: false,
      captionReferences: [],
    },
    visibility: { kind: 'public' },
    authorLabels: [],
    replyPolicy: content.replyPolicy,
    quotePolicy: content.quotePolicy,
  };
}

async function parseSignedArtifact(
  value: unknown,
  context: PostPublicationContext,
): Promise<SignedPostPublicationArtifact> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['envelopeBytes', 'objectId', 'cid', 'payloadHash']) ||
    typeof value.envelopeBytes !== 'string' ||
    !objectIdSchema.safeParse(value.objectId).success ||
    !cidSchema.safeParse(value.cid).success ||
    !digestSchema.safeParse(value.payloadHash).success
  ) {
    throw publicationError('corrupt-state', 'The saved signed artifact is invalid.');
  }
  const bytes = decodeStoredEnvelope(value.envelopeBytes, 'corrupt-state');
  const inspected = await inspectSignedEnvelope(bytes, context, 'corrupt-state');
  if (
    inspected.envelopeBytes !== value.envelopeBytes ||
    inspected.objectId !== value.objectId ||
    inspected.cid !== value.cid ||
    inspected.payloadHash !== value.payloadHash
  ) {
    throw publicationError(
      'corrupt-state',
      'The saved signed-envelope coordinates do not match its exact canonical bytes.',
    );
  }
  return inspected;
}

function parseStorageReceipt(
  value: unknown,
  context: PostPublicationContext,
  signed: SignedPostPublicationArtifact,
): PostPublicationStorageReceipt {
  try {
    return normalizeStorageReceipt(value as PostPublicationStorageReceipt, context, signed);
  } catch (error) {
    throw publicationError('corrupt-state', 'The saved storage receipt is invalid.', error);
  }
}

function parseFinalizedEvidence(
  value: unknown,
  context: PostPublicationContext,
  signed: SignedPostPublicationArtifact,
): FinalizedPostTransactionEvidence {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'commitment',
      'transactionSignature',
      'finalizedSlot',
      'observedAuthorSequence',
      'postPda',
      'objectId',
      'cid',
      'payloadHash',
    ]) ||
    value.commitment !== 'finalized' ||
    typeof value.transactionSignature !== 'string' ||
    typeof value.finalizedSlot !== 'string' ||
    typeof value.observedAuthorSequence !== 'string' ||
    typeof value.postPda !== 'string' ||
    typeof value.objectId !== 'string' ||
    typeof value.cid !== 'string' ||
    typeof value.payloadHash !== 'string'
  ) {
    throw publicationError('corrupt-state', 'The saved finality evidence has an invalid shape.');
  }
  const evidence: FinalizedPostTransactionEvidence = {
    commitment: 'finalized',
    transactionSignature: value.transactionSignature,
    finalizedSlot: value.finalizedSlot,
    observedAuthorSequence: value.observedAuthorSequence,
    postPda: value.postPda,
    objectId: value.objectId,
    cid: value.cid,
    payloadHash: value.payloadHash,
  };
  assertFinalizedEvidence(evidence, context, signed, 'corrupt-state');
  return evidence;
}

function decodeStoredEnvelope(
  encoded: string,
  code: 'corrupt-state' | 'invalid-evidence',
): Uint8Array {
  try {
    const bytes = decodeMultibaseBase64Url(encoded);
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_SIGNED_POST_ENVELOPE_BYTES ||
      encodeMultibaseBase64Url(bytes) !== encoded
    ) {
      throw new TypeError('Envelope byte encoding is empty, oversized, or noncanonical.');
    }
    return bytes;
  } catch (error) {
    throw publicationError(code, 'The saved signed-envelope byte encoding is invalid.', error);
  }
}

function decodeNonce(value: unknown): Uint8Array {
  if (typeof value !== 'string') {
    throw publicationError('corrupt-state', 'A publication nonce is not a string.');
  }
  try {
    const bytes = decodeMultibaseBase64Url(value, NONCE_BYTES);
    if (encodeMultibaseBase64Url(bytes) !== value) {
      throw new TypeError('Nonce encoding is not canonical.');
    }
    return bytes;
  } catch (error) {
    throw publicationError(
      'corrupt-state',
      'A publication nonce must contain exactly 16 canonical bytes.',
      error,
    );
  }
}

async function requirePostPublicationIntent(
  storage: PostPublicationIntentStorage,
): Promise<PostPublicationIntent> {
  const state = await loadPostPublicationIntent(storage);
  if (state === null) {
    throw publicationError(
      'invalid-transition',
      'No prepared publication intent exists in browser storage.',
    );
  }
  return state;
}

function persistTransition(
  storage: PostPublicationIntentStorage,
  current: PostPublicationIntent | null,
  next: PostPublicationIntent,
): PostPublicationIntent {
  // localStorage has no compare-and-swap primitive. These comparisons detect
  // many stale writes but are not an atomic cross-tab mutex; browser callers
  // must hold the exclusive WetDrool publication Web Lock for the complete
  // transition and cleanup sequence.
  const expected = current === null ? null : serializePostPublicationIntent(current);
  const serialized = serializePostPublicationIntent(next);
  let observed: string | null;
  try {
    observed = storage.getItem(POST_PUBLICATION_INTENT_STORAGE_KEY);
  } catch (error) {
    throw publicationError(
      'storage-unavailable',
      'Browser storage could not be read before publication state was updated.',
      error,
    );
  }
  if (observed !== expected) {
    throw publicationError(
      'state-conflict',
      'Publication state changed in another browser context; refusing to overwrite it.',
    );
  }

  try {
    storage.setItem(POST_PUBLICATION_INTENT_STORAGE_KEY, serialized);
    observed = storage.getItem(POST_PUBLICATION_INTENT_STORAGE_KEY);
  } catch (error) {
    throw publicationError(
      'storage-unavailable',
      'Browser storage could not durably save publication state.',
      error,
    );
  }
  if (observed !== serialized) {
    throw publicationError(
      observed === expected ? 'storage-unavailable' : 'state-conflict',
      observed === expected
        ? 'Browser storage did not retain the publication state update.'
        : 'A conflicting browser context replaced the publication state update.',
    );
  }
  return next;
}

function isStage(value: unknown): value is PostPublicationIntentStage {
  return value === 'prepared' || value === 'signed' || value === 'stored' || value === 'finalized';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (!hasExactKeys(value, expected)) {
    throw publicationError('corrupt-state', 'The saved publication stage has unknown fields.');
  }
}

function isBoundedNonemptyString(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    UTF8.encode(value).byteLength <= maximumBytes
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function publicationError(
  code: PostPublicationIntentErrorCode,
  message: string,
  cause?: unknown,
): PostPublicationIntentError {
  return new PostPublicationIntentError(code, message, cause === undefined ? undefined : { cause });
}

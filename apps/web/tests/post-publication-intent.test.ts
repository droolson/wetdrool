import {
  buildPostPayload,
  canonicalizeEnvelope,
  decodeMultibaseBase64Url,
  signPayload,
  signingKeyIdFor,
} from '@wokesocial/protocol';
import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';

import { createEmptyComposerDraft, type ComposerDraft } from '../lib/composer-draft';
import {
  MAX_POST_PUBLICATION_INTENT_BYTES,
  MAX_SIGNED_POST_ENVELOPE_BYTES,
  POST_PUBLICATION_INTENT_STORAGE_KEY,
  acknowledgeFinalizedPostPublicationIntent,
  buildPostPayloadForIntent,
  loadPostPublicationIntent,
  parsePostPublicationIntent,
  preparePostPublicationIntent,
  publicTextPostContentFromDraft,
  recordFinalizedPostTransaction,
  recordPostStorageReceipt,
  recordSignedPostEnvelope,
  serializePostPublicationIntent,
  type FinalizedPostTransactionInput,
  type PostPublicationIntent,
  type PostPublicationIntentEnvironment,
  type PostPublicationIntentStorage,
  type PostPublicationStorageReceipt,
  type PreparePostPublicationIntentInput,
} from '../lib/post-publication-intent';

const SOLANA_KEY = '11111111111111111111111111111111';
const NETWORK = `wokenet:v1:${SOLANA_KEY}:${SOLANA_KEY}`;
const IDENTITY = `wokesocialid:v1:${NETWORK}:${SOLANA_KEY}`;
const PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const ROOT_SIGNING_KEY = signingKeyIdFor(IDENTITY, ed25519.getPublicKey(PRIVATE_KEY), 'root');
const NOW = new Date('2026-07-29T12:34:56.000Z');
const TRANSACTION_SIGNATURE = '1'.repeat(64);

class MemoryStorage implements PostPublicationIntentStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function draft(text = 'A durable public post.'): ComposerDraft {
  const value = createEmptyComposerDraft();
  value.text = text;
  return value;
}

function input(value = draft()): PreparePostPublicationIntentInput {
  return {
    draft: value,
    network: NETWORK,
    identity: IDENTITY,
    rootSigningKey: ROOT_SIGNING_KEY,
    expectedAuthorSequence: 8n,
  };
}

function deterministicEnvironment(
  onRandom?: (call: number) => void,
): PostPublicationIntentEnvironment {
  let call = 0;
  return {
    derivePostPda({ network, identity, postNonce }) {
      expect(network).toBe(NETWORK);
      expect(identity).toBe(IDENTITY);
      expect(postNonce).toHaveLength(16);
      return SOLANA_KEY;
    },
    now: () => new Date(NOW),
    randomBytes(length) {
      call += 1;
      onRandom?.(call);
      return Uint8Array.from({ length }, (_, index) => call * 16 + index);
    },
  };
}

function signedBytes(intent: PostPublicationIntent): Uint8Array {
  const payload = buildPostPayloadForIntent(intent);
  return canonicalizeEnvelope(signPayload(payload, PRIVATE_KEY));
}

function receipt(intent: Extract<PostPublicationIntent, { stage: 'signed' }>) {
  const envelopeBytes = decodeMultibaseBase64Url(intent.signed.envelopeBytes);
  return {
    cid: intent.signed.cid,
    provider: 'local-cas',
    providerVersion: '1',
    locator: `http://127.0.0.1:3000/api/cas/${intent.signed.cid}`,
    byteLength: envelopeBytes.byteLength,
    publishedAt: '2026-07-29T12:35:00.000Z',
    policy: { permanence: 'deletion-compatible' },
    verified: true,
  } satisfies PostPublicationStorageReceipt;
}

function finality(
  intent: Extract<PostPublicationIntent, { stage: 'stored' | 'finalized' }>,
): FinalizedPostTransactionInput {
  return {
    commitment: 'finalized',
    transactionSignature: TRANSACTION_SIGNATURE,
    finalizedSlot: 42n,
    observedAuthorSequence: 9n,
    postPda: intent.context.postPda,
    objectId: intent.signed.objectId,
    cid: intent.signed.cid,
    payloadHash: intent.signed.payloadHash,
  };
}

async function signedIntent(storage: MemoryStorage) {
  const prepared = await preparePostPublicationIntent(storage, input(), deterministicEnvironment());
  const signed = await recordSignedPostEnvelope(storage, signedBytes(prepared));
  if (signed.stage !== 'signed') {
    throw new Error('Expected a signed publication intent.');
  }
  return signed;
}

describe('public text publication mapping', () => {
  it('maps the Followers composer choice to the protocol followers audience', () => {
    const value = draft('Exact body\nwith a second line.');
    value.contentWarning = 'Discussion of grief';
    value.replyPermission = 'following';
    value.remixPermission = 'disabled';
    value.storagePolicy = 'ipfs';

    expect(publicTextPostContentFromDraft(value)).toEqual({
      format: 'plain',
      body: 'Exact body\nwith a second line.',
      media: [],
      language: 'und',
      contentWarnings: ['Discussion of grief'],
      accessibility: {
        altTextReminderAcknowledged: false,
        captionReferences: [],
      },
      visibility: { kind: 'public' },
      authorLabels: [],
      replyPolicy: 'followers',
      quotePolicy: 'none',
    });
  });

  it('rejects incomplete, restricted, media, permanent, and unrepresentable drafts', () => {
    const cases: ComposerDraft[] = [];

    cases.push(createEmptyComposerDraft());

    const followers = draft();
    followers.audience = 'followers';
    cases.push(followers);

    const staleCommunity = draft();
    staleCommunity.communityId = 'hidden-stale-value';
    cases.push(staleCommunity);

    const media = draft();
    media.media = {
      sourceUrl: 'https://media.example/post.jpg',
      mediaType: 'image/jpeg',
      altText: 'A violet square.',
    };
    cases.push(media);

    const permanent = draft();
    permanent.storagePolicy = 'arweave';
    cases.push(permanent);

    const askFirst = draft();
    askFirst.remixPermission = 'ask-first';
    cases.push(askFirst);

    for (const unsupported of cases) {
      expect(
        () => publicTextPostContentFromDraft(unsupported),
        JSON.stringify(unsupported),
      ).toThrow(expect.objectContaining({ code: 'unsupported-draft' }));
    }
  });

  it('rejects control-normalized and over-byte-bound content warnings', () => {
    const controlled = draft('visible\u0000hidden');
    expect(() => publicTextPostContentFromDraft(controlled)).toThrow(
      expect.objectContaining({ code: 'unsupported-draft' }),
    );

    const oversizedWarning = draft();
    oversizedWarning.contentWarning = '💜'.repeat(100);
    expect(() => publicTextPostContentFromDraft(oversizedWarning)).toThrow(
      expect.objectContaining({ code: 'unsupported-draft' }),
    );
  });
});

describe('durable publication intent state', () => {
  it('round trips exact prepared, signed, stored, and finalized evidence', async () => {
    const storage = new MemoryStorage();
    const prepared = await preparePostPublicationIntent(
      storage,
      input(),
      deterministicEnvironment(),
    );

    expect(prepared).toMatchObject({
      version: 1,
      stage: 'prepared',
      context: {
        network: NETWORK,
        identity: IDENTITY,
        rootSigningKey: ROOT_SIGNING_KEY,
        expectedAuthorSequence: '8',
        createdAt: NOW.toISOString(),
        postPda: SOLANA_KEY,
      },
    });
    expect(decodeMultibaseBase64Url(prepared.context.postNonce)).toHaveLength(16);
    expect(decodeMultibaseBase64Url(prepared.context.payloadNonce)).toHaveLength(16);
    expect(buildPostPayloadForIntent(prepared)).toEqual(
      buildPostPayload(
        {
          network: NETWORK,
          author: IDENTITY,
          signingKey: ROOT_SIGNING_KEY,
        },
        prepared.context.content,
        {
          createdAt: NOW,
          nonce: decodeMultibaseBase64Url(prepared.context.payloadNonce, 16),
        },
      ),
    );

    const exactEnvelopeBytes = signedBytes(prepared);
    const signed = await recordSignedPostEnvelope(storage, exactEnvelopeBytes);
    expect(signed.stage).toBe('signed');
    if (signed.stage !== 'signed') {
      throw new Error('Expected signed state.');
    }
    expect(decodeMultibaseBase64Url(signed.signed.envelopeBytes)).toEqual(exactEnvelopeBytes);

    const stored = await recordPostStorageReceipt(storage, receipt(signed));
    expect(stored.stage).toBe('stored');
    if (stored.stage !== 'stored') {
      throw new Error('Expected stored state.');
    }

    const finalized = await recordFinalizedPostTransaction(storage, finality(stored));
    expect(finalized).toMatchObject({
      stage: 'finalized',
      finalizedTransaction: {
        commitment: 'finalized',
        finalizedSlot: '42',
        observedAuthorSequence: '9',
        transactionSignature: TRANSACTION_SIGNATURE,
      },
    });
    expect(await loadPostPublicationIntent(storage)).toEqual(finalized);

    const serialized = storage.values.get(POST_PUBLICATION_INTENT_STORAGE_KEY);
    expect(serialized).toBe(serializePostPublicationIntent(finalized));
    await expect(parsePostPublicationIntent(serialized ?? '')).resolves.toEqual(finalized);
  });

  it('reuses every generated coordinate and signed byte on identical retries', async () => {
    const storage = new MemoryStorage();
    let randomCalls = 0;
    const first = await preparePostPublicationIntent(
      storage,
      input(),
      deterministicEnvironment(() => {
        randomCalls += 1;
      }),
    );
    expect(randomCalls).toBe(2);

    const retryEnvironment: PostPublicationIntentEnvironment = {
      derivePostPda: deterministicEnvironment().derivePostPda,
      now() {
        throw new Error('An existing intent must not generate another timestamp.');
      },
      randomBytes() {
        throw new Error('An existing intent must not generate another nonce.');
      },
    };
    const retried = await preparePostPublicationIntent(storage, input(), retryEnvironment);
    expect(retried).toEqual(first);

    const bytes = signedBytes(first);
    const signed = await recordSignedPostEnvelope(storage, bytes);
    expect(await recordSignedPostEnvelope(storage, Uint8Array.from(bytes))).toEqual(signed);
  });

  it('fails closed when any draft or identity coordinate changes', async () => {
    const storage = new MemoryStorage();
    await preparePostPublicationIntent(storage, input(), deterministicEnvironment());

    const changedDraft = draft('This would be a different post.');
    await expect(
      preparePostPublicationIntent(storage, input(changedDraft), deterministicEnvironment()),
    ).rejects.toMatchObject({ code: 'state-conflict' });

    await expect(
      preparePostPublicationIntent(
        storage,
        { ...input(), expectedAuthorSequence: 9n },
        deterministicEnvironment(),
      ),
    ).rejects.toMatchObject({ code: 'state-conflict' });

    await expect(
      preparePostPublicationIntent(storage, input(), {
        ...deterministicEnvironment(),
        derivePostPda: () => 'SysvarRent111111111111111111111111111111111',
      }),
    ).rejects.toMatchObject({ code: 'state-conflict' });
  });

  it('rejects corrupt, oversized, noncanonical, and contradictory persisted state', async () => {
    await expect(parsePostPublicationIntent('{broken')).rejects.toMatchObject({
      code: 'corrupt-state',
    });
    await expect(
      parsePostPublicationIntent('x'.repeat(MAX_POST_PUBLICATION_INTENT_BYTES + 1)),
    ).rejects.toMatchObject({ code: 'corrupt-state' });

    const storage = new MemoryStorage();
    const signed = await signedIntent(storage);
    const serialized = serializePostPublicationIntent(signed);
    await expect(parsePostPublicationIntent(` ${serialized}`)).rejects.toMatchObject({
      code: 'corrupt-state',
    });

    const contradictory = JSON.parse(serialized) as {
      signed: { objectId: string };
    };
    contradictory.signed.objectId = `wokesocialobj:v1:post:u${'A'.repeat(43)}`;
    await expect(parsePostPublicationIntent(JSON.stringify(contradictory))).rejects.toMatchObject({
      code: 'corrupt-state',
    });

    const withUnknownField = JSON.parse(serialized) as Record<string, unknown>;
    withUnknownField.extra = true;
    await expect(
      parsePostPublicationIntent(JSON.stringify(withUnknownField)),
    ).rejects.toMatchObject({ code: 'corrupt-state' });

    await expect(
      recordSignedPostEnvelope(storage, new Uint8Array(MAX_SIGNED_POST_ENVELOPE_BYTES + 1)),
    ).rejects.toMatchObject({ code: 'invalid-evidence' });
  });

  it('rejects conflicting envelope and storage updates', async () => {
    const storage = new MemoryStorage();
    const signed = await signedIntent(storage);
    const conflictingPayload = buildPostPayload(
      {
        network: NETWORK,
        author: IDENTITY,
        signingKey: ROOT_SIGNING_KEY,
      },
      { ...signed.context.content, body: 'Conflicting signed body.' },
      {
        createdAt: NOW,
        nonce: decodeMultibaseBase64Url(signed.context.payloadNonce, 16),
      },
    );
    const conflictingBytes = canonicalizeEnvelope(signPayload(conflictingPayload, PRIVATE_KEY));
    await expect(recordSignedPostEnvelope(storage, conflictingBytes)).rejects.toMatchObject({
      code: 'state-conflict',
    });

    const firstReceipt = receipt(signed);
    await recordPostStorageReceipt(storage, firstReceipt);
    await expect(
      recordPostStorageReceipt(storage, {
        ...firstReceipt,
        provider: 'different-provider',
      }),
    ).rejects.toMatchObject({ code: 'state-conflict' });
  });

  it('keeps finality monotonic and accepts only exact idempotent evidence', async () => {
    const storage = new MemoryStorage();
    const signed = await signedIntent(storage);
    const exactReceipt = receipt(signed);
    const stored = await recordPostStorageReceipt(storage, exactReceipt);
    if (stored.stage !== 'stored') {
      throw new Error('Expected stored state.');
    }

    await expect(
      recordFinalizedPostTransaction(storage, {
        ...finality(stored),
        commitment: 'confirmed',
      } as unknown as FinalizedPostTransactionInput),
    ).rejects.toMatchObject({ code: 'invalid-evidence' });
    await expect(
      recordFinalizedPostTransaction(storage, {
        ...finality(stored),
        observedAuthorSequence: 10n,
      }),
    ).rejects.toMatchObject({ code: 'invalid-evidence' });

    const exactFinality = finality(stored);
    const finalized = await recordFinalizedPostTransaction(storage, exactFinality);
    expect(finalized.stage).toBe('finalized');
    expect(await recordFinalizedPostTransaction(storage, exactFinality)).toEqual(finalized);
    expect(await recordPostStorageReceipt(storage, exactReceipt)).toEqual(finalized);
    expect(await recordSignedPostEnvelope(storage, signedBytes(finalized))).toEqual(finalized);

    await expect(
      recordFinalizedPostTransaction(storage, {
        ...exactFinality,
        finalizedSlot: 43n,
      }),
    ).rejects.toMatchObject({ code: 'state-conflict' });
  });

  it('retires only the exact finalized intent after indexed success', async () => {
    const storage = new MemoryStorage();
    const signed = await signedIntent(storage);
    const stored = await recordPostStorageReceipt(storage, receipt(signed));
    if (stored.stage !== 'stored') {
      throw new Error('Expected stored state.');
    }
    const finalized = await recordFinalizedPostTransaction(storage, finality(stored));
    if (finalized.stage !== 'finalized') {
      throw new Error('Expected finalized state.');
    }

    await acknowledgeFinalizedPostPublicationIntent(storage, finalized);
    await expect(loadPostPublicationIntent(storage)).resolves.toBeNull();
    await expect(
      acknowledgeFinalizedPostPublicationIntent(storage, finalized),
    ).resolves.toBeUndefined();

    const otherStorage = new MemoryStorage();
    const otherPrepared = await preparePostPublicationIntent(
      otherStorage,
      input(draft('A different completed post.')),
      deterministicEnvironment(),
    );
    const otherSigned = await recordSignedPostEnvelope(otherStorage, signedBytes(otherPrepared));
    if (otherSigned.stage !== 'signed') {
      throw new Error('Expected another signed state.');
    }
    const otherStored = await recordPostStorageReceipt(otherStorage, receipt(otherSigned));
    if (otherStored.stage !== 'stored') {
      throw new Error('Expected another stored state.');
    }
    const otherFinalized = await recordFinalizedPostTransaction(
      otherStorage,
      finality(otherStored),
    );
    if (otherFinalized.stage !== 'finalized') {
      throw new Error('Expected another finalized state.');
    }
    storage.setItem(
      POST_PUBLICATION_INTENT_STORAGE_KEY,
      serializePostPublicationIntent(otherFinalized),
    );
    await expect(
      acknowledgeFinalizedPostPublicationIntent(storage, finalized),
    ).rejects.toMatchObject({ code: 'state-conflict' });
    expect(await loadPostPublicationIntent(storage)).toEqual(otherFinalized);
  });

  it('rejects permanent, wrong-byte, and pre-signing storage receipts', async () => {
    const storage = new MemoryStorage();
    const prepared = await preparePostPublicationIntent(
      storage,
      input(),
      deterministicEnvironment(),
    );
    const fakeReceipt = {
      cid: 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      provider: 'local-cas',
      providerVersion: '1',
      locator: 'local',
      byteLength: 1,
      publishedAt: NOW.toISOString(),
      policy: { permanence: 'deletion-compatible' },
      verified: true,
    } as PostPublicationStorageReceipt;
    await expect(recordPostStorageReceipt(storage, fakeReceipt)).rejects.toMatchObject({
      code: 'invalid-transition',
    });

    const signed = await recordSignedPostEnvelope(storage, signedBytes(prepared));
    if (signed.stage !== 'signed') {
      throw new Error('Expected signed state.');
    }
    await expect(
      recordPostStorageReceipt(storage, {
        ...receipt(signed),
        byteLength: 1,
      }),
    ).rejects.toMatchObject({ code: 'invalid-evidence' });
    await expect(
      recordPostStorageReceipt(storage, {
        ...receipt(signed),
        policy: { permanence: 'permanent' },
      } as unknown as PostPublicationStorageReceipt),
    ).rejects.toMatchObject({ code: 'invalid-evidence' });
  });

  it('surfaces browser-storage read, write, and silent-persistence failures', async () => {
    const readFailure: PostPublicationIntentStorage = {
      getItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('not reached');
      },
      setItem() {
        throw new Error('not reached');
      },
    };
    await expect(loadPostPublicationIntent(readFailure)).rejects.toMatchObject({
      code: 'storage-unavailable',
    });

    const writeFailure: PostPublicationIntentStorage = {
      getItem() {
        return null;
      },
      removeItem() {
        throw new Error('not reached');
      },
      setItem() {
        throw new Error('quota');
      },
    };
    await expect(
      preparePostPublicationIntent(writeFailure, input(), deterministicEnvironment()),
    ).rejects.toMatchObject({ code: 'storage-unavailable' });

    const silentFailure: PostPublicationIntentStorage = {
      getItem() {
        return null;
      },
      removeItem() {
        throw new Error('not reached');
      },
      setItem() {
        // Deliberately discard the write.
      },
    };
    await expect(
      preparePostPublicationIntent(silentFailure, input(), deterministicEnvironment()),
    ).rejects.toMatchObject({ code: 'storage-unavailable' });
  });
});

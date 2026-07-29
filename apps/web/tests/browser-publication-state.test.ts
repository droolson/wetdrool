import {
  canonicalizeEnvelope,
  decodeMultibaseBase64Url,
  signPayload,
  signingKeyIdFor,
} from '@wokesocial/protocol';
import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';

import type { BrowserPublicationStateError } from '../lib/browser-publication-state';
import {
  completeLockedFinalizedPublicationCleanup,
  discardLockedDraftWithoutIntent,
  saveLockedDraftWithoutIntent,
  selectLockedPublicationState,
} from '../lib/browser-publication-state';
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  createEmptyComposerDraft,
  parseComposerDraft,
  serializeComposerDraft,
  type ComposerDraft,
} from '../lib/composer-draft';
import {
  POST_PUBLICATION_INTENT_STORAGE_KEY,
  buildPostPayloadForIntent,
  preparePostPublicationIntent,
  recordFinalizedPostTransaction,
  recordPostStorageReceipt,
  recordSignedPostEnvelope,
  serializePostPublicationIntent,
  type FinalizedPostPublicationIntent,
} from '../lib/post-publication-intent';

const SOLANA_KEY = '11111111111111111111111111111111';
const NETWORK = `wokenet:v1:${SOLANA_KEY}:${SOLANA_KEY}`;
const IDENTITY = `wokesocialid:v1:${NETWORK}:${SOLANA_KEY}`;
const PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const ROOT_SIGNING_KEY = signingKeyIdFor(IDENTITY, ed25519.getPublicKey(PRIVATE_KEY), 'root');

class MemoryStorage {
  readonly values = new Map<string, string>();
  blockIntentRemoval = false;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    if (this.blockIntentRemoval && key === POST_PUBLICATION_INTENT_STORAGE_KEY) return;
    this.values.delete(key);
  }
}

function draft(text: string): ComposerDraft {
  const value = createEmptyComposerDraft();
  value.text = text;
  return value;
}

async function preparedIntent(storage: MemoryStorage, value: ComposerDraft) {
  return preparePostPublicationIntent(
    storage,
    {
      draft: value,
      network: NETWORK,
      identity: IDENTITY,
      rootSigningKey: ROOT_SIGNING_KEY,
      expectedAuthorSequence: 8n,
    },
    {
      derivePostPda: () => SOLANA_KEY,
      now: () => new Date('2026-07-29T12:34:56.000Z'),
      randomBytes: (length) => Uint8Array.from({ length }, (_, index) => index + 1),
    },
  );
}

async function finalizedIntent(
  storage: MemoryStorage,
  value: ComposerDraft,
): Promise<FinalizedPostPublicationIntent> {
  const prepared = await preparedIntent(storage, value);
  const signed = await recordSignedPostEnvelope(
    storage,
    canonicalizeEnvelope(signPayload(buildPostPayloadForIntent(prepared), PRIVATE_KEY)),
  );
  if (signed.stage !== 'signed') throw new Error('Expected signed intent.');
  const envelopeBytes = decodeMultibaseBase64Url(signed.signed.envelopeBytes);
  const stored = await recordPostStorageReceipt(storage, {
    cid: signed.signed.cid,
    provider: 'local-cas',
    providerVersion: '1',
    locator: `http://localhost:3000/api/local-cas/${signed.signed.cid}`,
    byteLength: envelopeBytes.byteLength,
    publishedAt: '2026-07-29T12:35:00.000Z',
    policy: { permanence: 'deletion-compatible' },
    verified: true,
  });
  if (stored.stage !== 'stored') throw new Error('Expected stored intent.');
  const finalized = await recordFinalizedPostTransaction(storage, {
    commitment: 'finalized',
    transactionSignature: '1'.repeat(64),
    finalizedSlot: 42n,
    observedAuthorSequence: 9n,
    postPda: stored.context.postPda,
    objectId: stored.signed.objectId,
    cid: stored.signed.cid,
    payloadHash: stored.signed.payloadHash,
  });
  if (finalized.stage !== 'finalized') throw new Error('Expected finalized intent.');
  return finalized;
}

describe('locked browser publication state', () => {
  it('uses the exact stored intent draft instead of stale visible React state', async () => {
    const storage = new MemoryStorage();
    const boundDraft = draft('The durable intent owns this exact draft.');
    const staleVisibleDraft = draft('A stale tab must not overwrite durable state.');
    const intent = await preparedIntent(storage, boundDraft);
    const boundSerialized = serializeComposerDraft(boundDraft);
    storage.values.set(COMPOSER_DRAFT_STORAGE_KEY, boundSerialized);

    const selected = await selectLockedPublicationState(storage, staleVisibleDraft);

    expect(selected).toMatchObject({
      draft: boundDraft,
      draftSerialized: boundSerialized,
      intent: { stage: intent.stage },
      intentSerialized: serializePostPublicationIntent(intent),
    });
    expect(storage.values.get(COMPOSER_DRAFT_STORAGE_KEY)).toBe(boundSerialized);
  });

  it('persists an exact crash-safe draft when stale UI state outlives a retired intent', async () => {
    const storage = new MemoryStorage();
    const visibleDraft = draft('This exact draft must be saved before publication.');

    const selected = await selectLockedPublicationState(storage, visibleDraft);

    expect(selected.intent).toBeNull();
    expect(selected.draft).toEqual(visibleDraft);
    expect(selected.draftSerialized).toBe(serializeComposerDraft(visibleDraft));
    expect(storage.values.get(COMPOSER_DRAFT_STORAGE_KEY)).toBe(selected.draftSerialized);
  });

  it('blocks stale save and discard actions while an exact durable intent is active', async () => {
    const storage = new MemoryStorage();
    const boundDraft = draft('Bound publication state.');
    await preparedIntent(storage, boundDraft);
    const boundSerialized = serializeComposerDraft(boundDraft);
    storage.values.set(COMPOSER_DRAFT_STORAGE_KEY, boundSerialized);

    await expect(
      saveLockedDraftWithoutIntent(storage, draft('Stale replacement.')),
    ).rejects.toMatchObject({ code: 'intent-active' });
    await expect(discardLockedDraftWithoutIntent(storage)).rejects.toMatchObject({
      code: 'intent-active',
    });
    expect(storage.values.get(COMPOSER_DRAFT_STORAGE_KEY)).toBe(boundSerialized);
  });

  it('cleans up only the exact finalized intent and its exact bound draft', async () => {
    const storage = new MemoryStorage();
    const boundDraft = draft('Finalized exact draft.');
    const intent = await finalizedIntent(storage, boundDraft);
    const boundSerialized = serializeComposerDraft(boundDraft);
    storage.values.set(COMPOSER_DRAFT_STORAGE_KEY, boundSerialized);

    await completeLockedFinalizedPublicationCleanup(storage, boundSerialized, intent);

    expect(storage.values.has(COMPOSER_DRAFT_STORAGE_KEY)).toBe(false);
    expect(storage.values.has(POST_PUBLICATION_INTENT_STORAGE_KEY)).toBe(false);
  });

  it('treats an already acknowledged intent as complete without deleting a newer draft', async () => {
    const storage = new MemoryStorage();
    const boundDraft = draft('Old finalized draft.');
    const intent = await finalizedIntent(storage, boundDraft);
    const expectedSerialized = serializeComposerDraft(boundDraft);
    const newerDraft = draft('A newer tab owns this draft.');
    const newerSerialized = serializeComposerDraft(newerDraft);
    storage.values.delete(POST_PUBLICATION_INTENT_STORAGE_KEY);
    storage.values.set(COMPOSER_DRAFT_STORAGE_KEY, newerSerialized);

    await expect(
      completeLockedFinalizedPublicationCleanup(storage, expectedSerialized, intent),
    ).resolves.toBeUndefined();
    expect(storage.values.get(COMPOSER_DRAFT_STORAGE_KEY)).toBe(newerSerialized);
    expect(parseComposerDraft(newerSerialized)).toEqual(newerDraft);
  });

  it('preserves a newly saved byte-identical draft after the old intent was acknowledged', async () => {
    const storage = new MemoryStorage();
    const boundDraft = draft('The user intentionally saved these same words again.');
    const intent = await finalizedIntent(storage, boundDraft);
    const expectedSerialized = serializeComposerDraft(boundDraft);
    storage.values.delete(POST_PUBLICATION_INTENT_STORAGE_KEY);
    storage.values.set(COMPOSER_DRAFT_STORAGE_KEY, expectedSerialized);

    await completeLockedFinalizedPublicationCleanup(storage, expectedSerialized, intent);

    expect(storage.values.get(COMPOSER_DRAFT_STORAGE_KEY)).toBe(expectedSerialized);
    expect(parseComposerDraft(expectedSerialized)).toEqual(boundDraft);
  });

  it('is idempotent after the exact draft and finalized intent are already cleared', async () => {
    const storage = new MemoryStorage();
    const boundDraft = draft('Exactly once publication with repeatable cleanup.');
    const intent = await finalizedIntent(storage, boundDraft);
    const expectedSerialized = serializeComposerDraft(boundDraft);
    storage.values.set(COMPOSER_DRAFT_STORAGE_KEY, expectedSerialized);

    await completeLockedFinalizedPublicationCleanup(storage, expectedSerialized, intent);
    await expect(
      completeLockedFinalizedPublicationCleanup(storage, expectedSerialized, intent),
    ).resolves.toBeUndefined();

    expect(storage.values.has(COMPOSER_DRAFT_STORAGE_KEY)).toBe(false);
    expect(storage.values.has(POST_PUBLICATION_INTENT_STORAGE_KEY)).toBe(false);
  });

  it('never deletes a changed draft while the old finalized intent remains', async () => {
    const storage = new MemoryStorage();
    const boundDraft = draft('Old finalized draft.');
    const intent = await finalizedIntent(storage, boundDraft);
    const expectedSerialized = serializeComposerDraft(boundDraft);
    const newerSerialized = serializeComposerDraft(draft('Newer exact draft.'));
    storage.values.set(COMPOSER_DRAFT_STORAGE_KEY, newerSerialized);

    await expect(
      completeLockedFinalizedPublicationCleanup(storage, expectedSerialized, intent),
    ).rejects.toMatchObject({ code: 'draft-conflict', draftCleared: false });
    expect(storage.values.get(COMPOSER_DRAFT_STORAGE_KEY)).toBe(newerSerialized);
    expect(storage.values.get(POST_PUBLICATION_INTENT_STORAGE_KEY)).toBe(
      serializePostPublicationIntent(intent),
    );
  });

  it('reports whether acknowledgement failed after the exact draft was cleared', async () => {
    const storage = new MemoryStorage();
    const boundDraft = draft('Exact draft with failed acknowledgement.');
    const intent = await finalizedIntent(storage, boundDraft);
    const expectedSerialized = serializeComposerDraft(boundDraft);
    storage.values.set(COMPOSER_DRAFT_STORAGE_KEY, expectedSerialized);
    storage.blockIntentRemoval = true;

    await expect(
      completeLockedFinalizedPublicationCleanup(storage, expectedSerialized, intent),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BrowserPublicationStateError>>({
        code: 'storage-unavailable',
        draftCleared: true,
      }),
    );
    expect(storage.values.has(COMPOSER_DRAFT_STORAGE_KEY)).toBe(false);
  });
});

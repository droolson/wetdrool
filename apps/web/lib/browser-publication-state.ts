import {
  COMPOSER_DRAFT_STORAGE_KEY,
  createEmptyComposerDraft,
  discardExactComposerDraft,
  parseComposerDraft,
  serializeComposerDraft,
  type ComposerDraft,
  type DraftStorage,
} from './composer-draft';
import {
  POST_PUBLICATION_INTENT_STORAGE_KEY,
  acknowledgeFinalizedPostPublicationIntent,
  parsePostPublicationIntent,
  publicTextPostContentFromDraft,
  serializePostPublicationIntent,
  type FinalizedPostPublicationIntent,
  type PostPublicationIntent,
} from './post-publication-intent';

export type BrowserPublicationStateErrorCode =
  'corrupt-draft' | 'draft-conflict' | 'intent-active' | 'intent-conflict' | 'storage-unavailable';

export class BrowserPublicationStateError extends Error {
  override readonly name = 'BrowserPublicationStateError';

  constructor(
    readonly code: BrowserPublicationStateErrorCode,
    message: string,
    readonly draftCleared = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface LockedPublicationStorageState {
  readonly draft: ComposerDraft | null;
  readonly draftSerialized: string | null;
  readonly intent: PostPublicationIntent | null;
  readonly intentSerialized: string | null;
}

export interface LockedPublicationSelection {
  readonly draft: ComposerDraft;
  readonly draftSerialized: string | null;
  readonly intent: PostPublicationIntent | null;
  readonly intentSerialized: string | null;
}

/**
 * Reads and parses the exact draft/intent pair selected while the caller holds
 * the exclusive browser publication lock. A second read detects any
 * non-cooperating storage mutation that happens while an intent is verified.
 */
export async function readLockedPublicationStorageState(
  storage: DraftStorage,
): Promise<LockedPublicationStorageState> {
  const selected = readRawState(storage);
  const intent =
    selected.intentSerialized === null
      ? null
      : await parsePostPublicationIntent(selected.intentSerialized);
  const draft =
    selected.draftSerialized === null ? null : parseComposerDraft(selected.draftSerialized);
  if (selected.draftSerialized !== null && draft === null) {
    throw stateError(
      'corrupt-draft',
      'The exact saved Composer draft is not valid canonical local state.',
    );
  }
  if (draft !== null && serializeComposerDraft(draft) !== selected.draftSerialized) {
    throw stateError(
      'corrupt-draft',
      'The exact saved Composer draft is not in canonical serialized form.',
    );
  }

  const verified = readRawState(storage);
  if (
    verified.draftSerialized !== selected.draftSerialized ||
    verified.intentSerialized !== selected.intentSerialized
  ) {
    throw stateError(
      'storage-unavailable',
      'The saved draft or publication intent changed while its exact state was being verified.',
    );
  }
  return Object.freeze({ ...selected, draft, intent });
}

/**
 * Selects the only draft that may be passed to the publication orchestrator.
 * A current durable intent always wins over captured React state. Without an
 * intent, the visible draft is first persisted and read back exactly so a
 * crash cannot leave an unbound in-flight publication.
 */
export async function selectLockedPublicationState(
  storage: DraftStorage,
  visibleDraft: ComposerDraft,
): Promise<LockedPublicationSelection> {
  const selected = await readLockedPublicationStorageState(storage);
  if (selected.intent !== null) {
    if (selected.draft === null) {
      if (selected.intent.stage !== 'finalized') {
        throw stateError(
          'draft-conflict',
          'A non-finalized publication intent has no exact saved draft to resume.',
        );
      }
      return Object.freeze({
        draft: createEmptyComposerDraft(),
        draftSerialized: null,
        intent: selected.intent,
        intentSerialized: selected.intentSerialized,
      });
    }
    assertDraftMatchesIntent(selected.draft, selected.intent);
    return Object.freeze({
      draft: selected.draft,
      draftSerialized: selected.draftSerialized,
      intent: selected.intent,
      intentSerialized: selected.intentSerialized,
    });
  }

  const draftSerialized = canonicalDraft(visibleDraft);
  writeExactDraftWithoutIntent(storage, selected, draftSerialized);
  const draft = parseComposerDraft(draftSerialized);
  if (draft === null) {
    throw stateError(
      'corrupt-draft',
      'The visible Composer draft could not be serialized exactly.',
    );
  }
  return Object.freeze({
    draft,
    draftSerialized,
    intent: null,
    intentSerialized: null,
  });
}

export async function saveLockedDraftWithoutIntent(
  storage: DraftStorage,
  visibleDraft: ComposerDraft,
): Promise<string> {
  const selected = await readLockedPublicationStorageState(storage);
  if (selected.intent !== null) {
    throw stateError(
      'intent-active',
      'A durable publication intent is active; refusing to replace its saved draft.',
    );
  }
  const draftSerialized = canonicalDraft(visibleDraft);
  writeExactDraftWithoutIntent(storage, selected, draftSerialized);
  return draftSerialized;
}

export async function discardLockedDraftWithoutIntent(
  storage: DraftStorage,
): Promise<string | null> {
  const selected = await readLockedPublicationStorageState(storage);
  if (selected.intent !== null) {
    throw stateError(
      'intent-active',
      'A durable publication intent is active; refusing to discard its saved draft.',
    );
  }
  if (!discardExactComposerDraft(storage, selected.draftSerialized)) {
    throw stateError(
      'draft-conflict',
      'The exact selected Composer draft changed before it could be discarded.',
    );
  }
  const verified = readRawState(storage);
  if (verified.draftSerialized !== null || verified.intentSerialized !== null) {
    throw stateError(
      'storage-unavailable',
      'Browser storage did not retain the exact discarded-draft state.',
    );
  }
  return selected.draftSerialized;
}

/**
 * Completes cleanup only when both pieces of storage still equal the exact
 * publication operation. It clears that exact draft first, then acknowledges
 * that exact finalized intent. `draftCleared` tells the caller whether an
 * acknowledgement retry must expect draft absence.
 */
export async function completeLockedFinalizedPublicationCleanup(
  storage: DraftStorage,
  expectedDraftSerialized: string | null,
  expectedIntent: FinalizedPostPublicationIntent,
): Promise<void> {
  const expectedIntentSerialized = serializePostPublicationIntent(expectedIntent);
  const parsedExpectedIntent = await parsePostPublicationIntent(expectedIntentSerialized);
  if (parsedExpectedIntent.stage !== 'finalized') {
    throw stateError(
      'intent-conflict',
      'Only an exact finalized publication intent can be cleaned up.',
    );
  }
  const expectedDraft =
    expectedDraftSerialized === null ? null : parseComposerDraft(expectedDraftSerialized);
  if (
    expectedDraftSerialized !== null &&
    (expectedDraft === null || serializeComposerDraft(expectedDraft) !== expectedDraftSerialized)
  ) {
    throw stateError(
      'corrupt-draft',
      'The publication cleanup draft is not exact canonical local state.',
    );
  }
  if (expectedDraft !== null) {
    assertDraftMatchesIntent(expectedDraft, parsedExpectedIntent);
  }

  const selected = await readLockedPublicationStorageState(storage);
  if (selected.intentSerialized === null) {
    // Another serialized tab may already have acknowledged this exact
    // publication. Its absence is the terminal cleanup state. Current cleanup
    // always clears the draft before acknowledging the intent, so no draft is
    // authorized for deletion here. A newly saved draft may be byte-identical
    // to the old one and must still be preserved.
    return;
  }
  if (selected.intentSerialized !== expectedIntentSerialized) {
    throw stateError(
      'intent-conflict',
      'The exact finalized publication intent is no longer active; refusing cleanup.',
    );
  }
  if (selected.draftSerialized !== expectedDraftSerialized) {
    throw stateError(
      'draft-conflict',
      'The saved Composer draft differs from the exact publication draft; refusing cleanup.',
    );
  }
  if (!discardExactComposerDraft(storage, expectedDraftSerialized)) {
    throw stateError(
      'draft-conflict',
      'The exact publication draft changed before cleanup could clear it.',
    );
  }

  try {
    await acknowledgeFinalizedPostPublicationIntent(storage, parsedExpectedIntent);
  } catch (error) {
    throw stateError(
      'storage-unavailable',
      'The exact publication draft was cleared, but its finalized intent remains pending.',
      true,
      error,
    );
  }
}

function assertDraftMatchesIntent(draft: ComposerDraft, intent: PostPublicationIntent): void {
  let content: ReturnType<typeof publicTextPostContentFromDraft>;
  try {
    content = publicTextPostContentFromDraft(draft);
  } catch (error) {
    throw stateError(
      'draft-conflict',
      'The saved draft cannot represent the active publication intent exactly.',
      false,
      error,
    );
  }
  if (
    draft.storagePolicy !== intent.context.storagePolicy ||
    JSON.stringify(content) !== JSON.stringify(intent.context.content)
  ) {
    throw stateError(
      'draft-conflict',
      'The saved draft does not match the exact active publication intent.',
    );
  }
}

function canonicalDraft(draft: ComposerDraft): string {
  const serialized = serializeComposerDraft(draft);
  const parsed = parseComposerDraft(serialized);
  if (parsed === null || serializeComposerDraft(parsed) !== serialized) {
    throw stateError('corrupt-draft', 'The visible Composer draft is not exact canonical state.');
  }
  return serialized;
}

function writeExactDraftWithoutIntent(
  storage: DraftStorage,
  selected: LockedPublicationStorageState,
  draftSerialized: string,
): void {
  const beforeWrite = readRawState(storage);
  if (
    selected.intentSerialized !== null ||
    beforeWrite.intentSerialized !== null ||
    beforeWrite.draftSerialized !== selected.draftSerialized
  ) {
    throw stateError(
      'intent-active',
      'Publication storage changed or gained an active intent before the draft could be saved.',
    );
  }
  try {
    storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, draftSerialized);
  } catch (error) {
    throw stateError(
      'storage-unavailable',
      'Browser storage could not save the exact Composer draft.',
      false,
      error,
    );
  }
  const verified = readRawState(storage);
  if (verified.draftSerialized !== draftSerialized || verified.intentSerialized !== null) {
    throw stateError(
      'storage-unavailable',
      'Browser storage did not retain the exact crash-safe publication draft.',
    );
  }
}

function readRawState(storage: DraftStorage): {
  readonly draftSerialized: string | null;
  readonly intentSerialized: string | null;
} {
  try {
    return {
      draftSerialized: storage.getItem(COMPOSER_DRAFT_STORAGE_KEY),
      intentSerialized: storage.getItem(POST_PUBLICATION_INTENT_STORAGE_KEY),
    };
  } catch (error) {
    throw stateError(
      'storage-unavailable',
      'Browser storage could not read the exact draft and publication intent.',
      false,
      error,
    );
  }
}

function stateError(
  code: BrowserPublicationStateErrorCode,
  message: string,
  draftCleared = false,
  cause?: unknown,
): BrowserPublicationStateError {
  return new BrowserPublicationStateError(
    code,
    message,
    draftCleared,
    cause === undefined ? undefined : { cause },
  );
}

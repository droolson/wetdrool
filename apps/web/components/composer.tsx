'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StatusBadge } from '@wokesocial/ui';

import { BrowserAuthClient } from '@/lib/auth/browser-auth-client';
import { BrowserAuthError } from '@/lib/auth/errors';
import {
  BrowserPublicationLockError,
  withExclusiveLocalnetPublicationLock,
} from '@/lib/browser-publication-lock';
import {
  BrowserPublicationStateError,
  completeLockedFinalizedPublicationCleanup,
  discardLockedDraftWithoutIntent,
  saveLockedDraftWithoutIntent,
  selectLockedPublicationState,
} from '@/lib/browser-publication-state';
import {
  MAX_POST_CHARACTERS,
  MAX_POST_UTF8_BYTES,
  COMPOSER_DRAFT_STORAGE_KEY,
  REPLY_PERMISSION_LABELS,
  createEmptyComposerDraft,
  loadComposerDraft,
  normalizePreviewText,
  unicodeCharacterCount,
  utf8ByteLength,
  validateComposerDraft,
  type ComposerDraft,
} from '@/lib/composer-draft';
import {
  POST_PUBLICATION_INTENT_STORAGE_KEY,
  loadPostPublicationIntent,
  type PostPublicationIntentStage,
} from '@/lib/post-publication-intent';
import {
  LocalnetTextPostPublicationError,
  publishLocalnetTextPost,
  type LocalnetTextPostPublicationResult,
  type LocalnetTextPostPublicationStage,
} from '@/lib/localnet-post-publication';
import type { LocalnetPublicationConfig } from '@/lib/localnet-publication-config';

type SaveState = 'idle' | 'saved' | 'storage-error';

interface ComposerProps {
  readonly publicationConfig: LocalnetPublicationConfig;
}

type AuthReadiness = 'authenticated' | 'checking' | 'error' | 'unauthenticated';

type DurableIntentView =
  | { readonly kind: 'checking' }
  | { readonly kind: 'none' }
  | {
      readonly kind: 'active';
      readonly objectId?: string;
      readonly stage: PostPublicationIntentStage;
    }
  | { readonly detail: string; readonly kind: 'invalid' };

type PublicationView =
  | { readonly kind: 'idle' }
  | {
      readonly cancelRequested: boolean;
      readonly kind: 'active';
      readonly stage: LocalnetTextPostPublicationStage;
    }
  | {
      readonly detail: string;
      readonly kind: 'cancelled';
      readonly stage: LocalnetTextPostPublicationStage;
    }
  | {
      readonly detail: string;
      readonly kind: 'error';
      readonly requiresAuthentication: boolean;
      readonly stage?: LocalnetTextPostPublicationStage;
    }
  | {
      readonly cleanup: 'complete' | 'pending';
      readonly cleanupDetail?: string;
      readonly cleanupExpectedDraftSerialized: string | null;
      readonly kind: 'success';
      readonly publicationDraftSerialized: string | null;
      readonly result: LocalnetTextPostPublicationResult;
    };

const PUBLICATION_STEPS = [
  {
    label: 'Approve a fresh, user-verifying passkey prompt.',
    stages: ['authenticating'],
  },
  {
    label: 'Derive and reconcile the deterministic WokeNet identity.',
    stages: ['deriving-identity', 'reconciling-identity'],
  },
  {
    label: 'Check the local test-SOL rent budget and identity account.',
    stages: ['funding', 'creating-identity', 'indexing-identity'],
  },
  {
    label: 'Prepare and sign the exact canonical plain-text envelope.',
    stages: ['preparing-post', 'signing-post'],
  },
  {
    label: 'Store and verify the exact bytes in the local content store.',
    stages: ['storing-post'],
  },
  {
    label: 'Reconcile, simulate, submit, and verify local finality.',
    stages: ['reconciling-post', 'publishing-post', 'verifying-finality'],
  },
  {
    label: 'Wait for the indexer checkpoint covering the finalized post.',
    stages: ['indexing-post'],
  },
  {
    label: 'Re-read the exact local content bytes before reporting success.',
    stages: ['verifying-content'],
  },
  {
    label: 'Return one verified localnet evidence bundle.',
    stages: ['complete'],
  },
] as const satisfies readonly {
  readonly label: string;
  readonly stages: readonly LocalnetTextPostPublicationStage[];
}[];

export function Composer({ publicationConfig }: ComposerProps) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydration,
    getServerHydration,
  );

  if (!hydrated) {
    return (
      <div className="compose-preparing" role="status">
        Preparing the local draft workspace…
      </div>
    );
  }

  return <HydratedComposer publicationConfig={publicationConfig} />;
}

function HydratedComposer({ publicationConfig }: ComposerProps) {
  const [initialDraft] = useState(() => loadComposerDraft(window.localStorage));
  const [draft, setDraft] = useState(() => initialDraft ?? createEmptyComposerDraft());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [restored, setRestored] = useState(initialDraft !== null);
  const [authReadiness, setAuthReadiness] = useState<AuthReadiness>(() =>
    publicationConfig.kind === 'available' ? 'checking' : 'unauthenticated',
  );
  const [publication, setPublication] = useState<PublicationView>({ kind: 'idle' });
  const [durableIntent, setDurableIntent] = useState<DurableIntentView>({
    kind: 'checking',
  });
  const validation = useMemo(() => validateComposerDraft(draft), [draft]);
  const publicationEligibility = useMemo(
    () => getPublicationEligibility(draft, validation.valid),
    [draft, validation.valid],
  );
  const previewText = normalizePreviewText(draft.text);
  const previewWarning = normalizePreviewText(draft.contentWarning);
  const textCharacterCount = unicodeCharacterCount(previewText);
  const textByteCount = utf8ByteLength(previewText);
  const authClient = useMemo(
    () =>
      publicationConfig.kind === 'available'
        ? new BrowserAuthClient({ baseUrl: publicationConfig.runtime.authServiceUrl })
        : undefined,
    [publicationConfig],
  );
  const publicationStatusRef = useRef<HTMLDivElement>(null);
  const publicationAbortRef = useRef<AbortController | null>(null);
  const publicationBusy = publication.kind === 'active';
  const finalizedIntentRecovery =
    durableIntent.kind === 'active' && durableIntent.stage === 'finalized';
  const publicationStartEligible = publicationEligibility.eligible || finalizedIntentRecovery;
  const publicationDraftLocked =
    publicationBusy ||
    durableIntent.kind === 'checking' ||
    durableIntent.kind === 'active' ||
    durableIntent.kind === 'invalid' ||
    (publication.kind === 'success' && publication.cleanup === 'pending') ||
    ((publication.kind === 'cancelled' || publication.kind === 'error') &&
      publication.stage !== undefined &&
      stageMayHaveDurablePostIntent(publication.stage));

  useEffect(() => {
    let current = true;
    void refreshDurableIntent();
    window.addEventListener('storage', handleStorage);
    return () => {
      current = false;
      window.removeEventListener('storage', handleStorage);
    };

    function handleStorage(event: StorageEvent) {
      if (event.storageArea !== window.localStorage) return;
      if (event.key === null || event.key === POST_PUBLICATION_INTENT_STORAGE_KEY) {
        void refreshDurableIntent();
      }
      if (event.key === null || event.key === COMPOSER_DRAFT_STORAGE_KEY) {
        const storedDraft = loadComposerDraft(window.localStorage);
        setDraft(storedDraft ?? createEmptyComposerDraft());
        setRestored(storedDraft !== null);
        setSaveState('idle');
      }
    }

    async function refreshDurableIntent() {
      try {
        const intent = await loadPostPublicationIntent(window.localStorage);
        if (!current) return;
        setDurableIntent(
          intent === null
            ? { kind: 'none' }
            : {
                kind: 'active',
                ...(intent.stage === 'prepared' ? {} : { objectId: intent.signed.objectId }),
                stage: intent.stage,
              },
        );
      } catch {
        if (current) {
          setDurableIntent({
            detail:
              'The saved publication intent could not be verified. Editing and publication remain locked until local browser storage is repaired.',
            kind: 'invalid',
          });
        }
      }
    }
  }, []);

  useEffect(() => {
    if (authClient === undefined) return;
    const client = authClient;
    let current = true;
    void refreshAuthReadiness();
    return () => {
      current = false;
    };

    async function refreshAuthReadiness() {
      setAuthReadiness('checking');
      try {
        const session = await client.session();
        if (current) setAuthReadiness(session === undefined ? 'unauthenticated' : 'authenticated');
      } catch {
        if (current) setAuthReadiness('error');
      }
    }
  }, [authClient]);

  useEffect(
    () => () => {
      publicationAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (
      publication.kind === 'cancelled' ||
      publication.kind === 'error' ||
      publication.kind === 'success'
    ) {
      publicationStatusRef.current?.focus();
    }
  }, [publication]);

  function update<K extends keyof ComposerDraft>(key: K, value: ComposerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveState('idle');
    setConfirmDiscard(false);
    resetTerminalPublication();
  }

  function updateAudience(audience: ComposerDraft['audience']) {
    setDraft((current) => ({
      ...current,
      audience,
      communityId: audience === 'community' ? current.communityId : '',
    }));
    setSaveState('idle');
    setConfirmDiscard(false);
    resetTerminalPublication();
  }

  function updateMedia<K extends keyof ComposerDraft['media']>(
    key: K,
    value: ComposerDraft['media'][K],
  ) {
    setDraft((current) => ({
      ...current,
      media: { ...current.media, [key]: value },
    }));
    setSaveState('idle');
    setConfirmDiscard(false);
    resetTerminalPublication();
  }

  async function save() {
    try {
      await withExclusiveLocalnetPublicationLock(window.localStorage, () =>
        saveLockedDraftWithoutIntent(window.localStorage, draft),
      );
      setSaveState('saved');
      setConfirmDiscard(false);
    } catch {
      setSaveState('storage-error');
    }
  }

  async function discard() {
    try {
      await withExclusiveLocalnetPublicationLock(window.localStorage, () =>
        discardLockedDraftWithoutIntent(window.localStorage),
      );
      setDraft(createEmptyComposerDraft());
      setSaveState('idle');
      setRestored(false);
      setConfirmDiscard(false);
      resetTerminalPublication();
    } catch {
      setSaveState('storage-error');
    }
  }

  function resetTerminalPublication() {
    setPublication((current) => (current.kind === 'active' ? current : { kind: 'idle' }));
  }

  async function refreshAuthSession() {
    if (authClient === undefined) return;
    setAuthReadiness('checking');
    try {
      setAuthReadiness(
        (await authClient.session()) === undefined ? 'unauthenticated' : 'authenticated',
      );
    } catch {
      setAuthReadiness('error');
    }
  }

  async function startPublication() {
    if (publicationConfig.kind !== 'available' || authClient === undefined || publicationBusy) {
      return;
    }
    if (durableIntent.kind === 'checking' || durableIntent.kind === 'invalid') {
      return;
    }
    if (!publicationStartEligible) {
      setPublication({
        detail: publicationEligibility.detail,
        kind: 'error',
        requiresAuthentication: false,
      });
      return;
    }
    if (authReadiness !== 'authenticated') {
      setPublication({
        detail:
          'No active passkey service session is ready in this browser. Create an account or sign in, then check the session again.',
        kind: 'error',
        requiresAuthentication: true,
      });
      return;
    }
    const controller = new AbortController();
    let lastStage: LocalnetTextPostPublicationStage = 'authenticating';
    publicationAbortRef.current = controller;
    setPublication({
      cancelRequested: false,
      kind: 'active',
      stage: 'authenticating',
    });

    try {
      const completion = await withExclusiveLocalnetPublicationLock(
        window.localStorage,
        async () => {
          const selected = await selectLockedPublicationState(window.localStorage, draft);
          if (selected.intent === null) {
            setSaveState('saved');
          }
          const result = await publishLocalnetTextPost({
            abortSignal: controller.signal,
            authClient,
            draft: selected.draft,
            onProgress: ({ stage }) => {
              lastStage = stage;
              setPublication((current) =>
                current.kind === 'active'
                  ? {
                      cancelRequested: current.cancelRequested,
                      kind: 'active',
                      stage,
                    }
                  : current,
              );
            },
            runtime: publicationConfig.runtime,
            storage: window.localStorage,
          });

          try {
            await completeLockedFinalizedPublicationCleanup(
              window.localStorage,
              selected.draftSerialized,
              result.finalizedIntent,
            );
            return {
              cleanup: 'complete' as const,
              cleanupExpectedDraftSerialized: null,
              draftCleared: true,
              publicationDraftSerialized: selected.draftSerialized,
              result,
            };
          } catch (error) {
            const draftCleared =
              error instanceof BrowserPublicationStateError && error.draftCleared;
            return {
              cleanup: 'pending' as const,
              cleanupDetail: draftCleared
                ? 'The exact publication draft was cleared, but its exact finalized intent could not be acknowledged. Publication stays locked for a safe cleanup retry.'
                : 'The post is verified, but the exact finalized intent and its exact saved draft no longer matched at cleanup. No changed draft was removed.',
              cleanupExpectedDraftSerialized: draftCleared ? null : selected.draftSerialized,
              draftCleared,
              publicationDraftSerialized: selected.draftSerialized,
              result,
            };
          }
        },
        { signal: controller.signal },
      );
      const { cleanup, cleanupDetail, draftCleared, result } = completion;
      if (draftCleared) {
        synchronizeDraftFromStorage();
      } else {
        setSaveState('storage-error');
      }

      setDurableIntent(
        cleanup === 'complete'
          ? { kind: 'none' }
          : {
              kind: 'active',
              objectId: result.post.objectId,
              stage: 'finalized',
            },
      );

      setPublication({
        cleanup,
        ...(cleanupDetail === undefined ? {} : { cleanupDetail }),
        cleanupExpectedDraftSerialized: completion.cleanupExpectedDraftSerialized,
        kind: 'success',
        publicationDraftSerialized: completion.publicationDraftSerialized,
        result,
      });
    } catch (error) {
      if (isPublicationCancellation(error, controller.signal)) {
        setPublication({
          detail:
            'The proof stopped before a verified final result was returned. A local transaction may already exist; retrying reconciles the same durable intent before any new submission.',
          kind: 'cancelled',
          stage: lastStage,
        });
      } else {
        const requiresAuthentication =
          error instanceof BrowserAuthError &&
          (error.code === 'csrf-unavailable' ||
            error.code === 'service-rejected' ||
            error.code === 'key-wrapper-invalid');
        if (requiresAuthentication) setAuthReadiness('unauthenticated');
        setPublication({
          detail: safePublicationError(error),
          kind: 'error',
          requiresAuthentication,
          stage: lastStage,
        });
      }
    } finally {
      if (publicationAbortRef.current === controller) {
        publicationAbortRef.current = null;
      }
    }
  }

  function cancelPublication() {
    const controller = publicationAbortRef.current;
    if (controller === null || controller.signal.aborted) return;
    controller.abort(new DOMException('Localnet publication cancelled by the user.', 'AbortError'));
    setPublication((current) =>
      current.kind === 'active'
        ? {
            ...current,
            cancelRequested: true,
          }
        : current,
    );
  }

  async function finishLocalCleanup() {
    if (publication.kind !== 'success' || publication.cleanup === 'complete') return;
    let cleanupExpectedDraftSerialized = publication.cleanupExpectedDraftSerialized;
    try {
      await withExclusiveLocalnetPublicationLock(window.localStorage, () =>
        completeLockedFinalizedPublicationCleanup(
          window.localStorage,
          cleanupExpectedDraftSerialized,
          publication.result.finalizedIntent,
        ),
      );
      synchronizeDraftFromStorage();
      setDurableIntent({ kind: 'none' });
      setPublication({
        ...publication,
        cleanup: 'complete',
        cleanupDetail: undefined,
        cleanupExpectedDraftSerialized: null,
      });
    } catch (error) {
      if (error instanceof BrowserPublicationStateError && error.draftCleared) {
        cleanupExpectedDraftSerialized = null;
      }
      setPublication({
        ...publication,
        cleanup: 'pending',
        cleanupDetail:
          'Exact saved-draft or finalized-intent cleanup is still pending. No changed draft was removed; the verified result remains visible and the Composer stays locked.',
        cleanupExpectedDraftSerialized,
      });
    }
  }

  function synchronizeDraftFromStorage() {
    const storedDraft = loadComposerDraft(window.localStorage);
    setDraft(storedDraft ?? createEmptyComposerDraft());
    setRestored(storedDraft !== null);
    setSaveState(storedDraft === null ? 'idle' : 'saved');
  }

  return (
    <>
      {publicationConfig.kind === 'available' ? (
        <section className="localnet-proof-scope" aria-labelledby="localnet-proof-scope-title">
          <header>
            <div>
              <p className="section-kicker">Development proof boundary</p>
              <h2 id="localnet-proof-scope-title">A real local write—not a production launch.</h2>
            </div>
            <StatusBadge tone="verified">Loopback-only</StatusBadge>
          </header>
          <p>
            This adapter asks for fresh passkey verification, may faucet and spend test SOL for
            local account rent and fees, writes to the configured WokeNet program on a Solana local
            validator, verifies local content storage, and waits for an indexer checkpoint. It does
            not publish globally, transfer $WOKE, or use mainnet funds.
          </p>
          <dl>
            <div>
              <dt>Cluster</dt>
              <dd>Solana local validator</dd>
            </div>
            <div>
              <dt>Rent budget</dt>
              <dd>
                Up to{' '}
                {(publicationConfig.runtime.targetBalanceLamports / 1_000_000_000).toLocaleString(
                  'en',
                )}{' '}
                faucet test SOL
              </dd>
            </div>
            <div>
              <dt>Program</dt>
              <dd className="inline-identifier">
                <code>{publicationConfig.runtime.context.programAddress}</code>
              </dd>
            </div>
            <div>
              <dt>Content</dt>
              <dd>Verified local CAS receipt</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <div className="compose-workspace">
        <form className="compose-form" onSubmit={(event) => event.preventDefault()}>
          <div className="compose-form__status">
            <StatusBadge tone="pending">Device draft</StatusBadge>
            <p aria-live="polite">
              {saveState === 'saved'
                ? 'Draft saved on this device.'
                : saveState === 'storage-error'
                  ? 'Browser storage is unavailable. Keep this page open to retain the draft.'
                  : restored
                    ? 'A draft saved on this device was restored.'
                    : publicationConfig.kind === 'available'
                      ? 'Nothing is signed, stored, or submitted until you start the localnet proof.'
                      : 'Nothing leaves this browser while the publication proof is locked.'}
            </p>
          </div>

          <fieldset
            aria-label="Post draft"
            className="compose-form__fields"
            disabled={publicationDraftLocked}
          >
            <section className="compose-section" aria-labelledby="compose-words-title">
              <div className="compose-section__heading">
                <span aria-hidden="true">01</span>
                <div>
                  <h2 id="compose-words-title">The words</h2>
                  <p>Plain text stays readable across clients and storage providers.</p>
                </div>
              </div>

              <div className="field-stack">
                <label htmlFor="compose-text">Post text</label>
                <textarea
                  aria-describedby={
                    validation.errors.text
                      ? 'compose-text-count compose-text-error'
                      : 'compose-text-count'
                  }
                  aria-invalid={Boolean(validation.errors.text)}
                  autoFocus
                  id="compose-text"
                  maxLength={MAX_POST_UTF8_BYTES}
                  onChange={(event) => update('text', event.target.value)}
                  placeholder="What deserves the room’s attention?"
                  rows={8}
                  value={draft.text}
                />
                <div className="field-meta" id="compose-text-count">
                  <span>Plain text · line breaks preserved</span>
                  <span>
                    {textCharacterCount.toLocaleString('en')} /{' '}
                    {MAX_POST_CHARACTERS.toLocaleString('en')} characters ·{' '}
                    {textByteCount.toLocaleString('en')} /{' '}
                    {MAX_POST_UTF8_BYTES.toLocaleString('en')} UTF-8 bytes
                  </span>
                </div>
                {validation.errors.text ? (
                  <p className="field-error" id="compose-text-error">
                    {validation.errors.text}
                  </p>
                ) : null}
              </div>

              <div className="field-stack">
                <label htmlFor="content-warning">
                  Content warning <span>Optional</span>
                </label>
                <input
                  aria-describedby={
                    validation.errors.contentWarning
                      ? 'content-warning-help content-warning-error'
                      : 'content-warning-help'
                  }
                  aria-invalid={Boolean(validation.errors.contentWarning)}
                  id="content-warning"
                  maxLength={160}
                  onChange={(event) => update('contentWarning', event.target.value)}
                  placeholder="For example: discussion of grief"
                  value={draft.contentWarning}
                />
                <p className="field-help" id="content-warning-help">
                  This appears before the post body so readers can choose when to continue.
                </p>
                {validation.errors.contentWarning ? (
                  <p className="field-error" id="content-warning-error">
                    {validation.errors.contentWarning}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="compose-section" aria-labelledby="compose-media-title">
              <div className="compose-section__heading">
                <span aria-hidden="true">02</span>
                <div>
                  <h2 id="compose-media-title">Media reference</h2>
                  <p>Describe a content-addressed asset. Uploading is not connected.</p>
                </div>
              </div>

              <div className="field-grid">
                <div className="field-stack field-stack--wide">
                  <label htmlFor="media-source">
                    Media URL <span>Optional</span>
                  </label>
                  <input
                    aria-describedby={
                      validation.errors.sourceUrl
                        ? 'media-source-help media-source-error'
                        : 'media-source-help'
                    }
                    aria-invalid={Boolean(validation.errors.sourceUrl)}
                    id="media-source"
                    inputMode="url"
                    maxLength={2_000}
                    onChange={(event) => updateMedia('sourceUrl', event.target.value)}
                    placeholder="ipfs://… or https://…"
                    type="text"
                    value={draft.media.sourceUrl}
                  />
                  <p className="field-help" id="media-source-help">
                    A reference is draft metadata only; this app does not fetch or upload it here.
                  </p>
                  {validation.errors.sourceUrl ? (
                    <p className="field-error" id="media-source-error">
                      {validation.errors.sourceUrl}
                    </p>
                  ) : null}
                </div>
                <div className="field-stack">
                  <label htmlFor="media-type">Media type</label>
                  <input
                    aria-describedby={validation.errors.mediaType ? 'media-type-error' : undefined}
                    aria-invalid={Boolean(validation.errors.mediaType)}
                    id="media-type"
                    maxLength={120}
                    onChange={(event) => updateMedia('mediaType', event.target.value)}
                    placeholder="image/jpeg"
                    value={draft.media.mediaType}
                  />
                  {validation.errors.mediaType ? (
                    <p className="field-error" id="media-type-error">
                      {validation.errors.mediaType}
                    </p>
                  ) : null}
                </div>
                <div className="field-stack field-stack--full">
                  <label htmlFor="media-alt">Alt text</label>
                  <textarea
                    aria-describedby={
                      validation.errors.altText
                        ? 'media-alt-help media-alt-error'
                        : 'media-alt-help'
                    }
                    aria-invalid={Boolean(validation.errors.altText)}
                    id="media-alt"
                    maxLength={1_000}
                    onChange={(event) => updateMedia('altText', event.target.value)}
                    placeholder="Describe what matters in the image, audio, or video."
                    rows={3}
                    value={draft.media.altText}
                  />
                  <p className="field-help" id="media-alt-help">
                    Required when a media reference is present.
                  </p>
                  {validation.errors.altText ? (
                    <p className="field-error" id="media-alt-error">
                      {validation.errors.altText}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="compose-section" aria-labelledby="compose-boundaries-title">
              <div className="compose-section__heading">
                <span aria-hidden="true">03</span>
                <div>
                  <h2 id="compose-boundaries-title">The boundaries</h2>
                  <p>State audience, conversation permissions, and intended storage explicitly.</p>
                </div>
              </div>

              <div className="field-grid field-grid--three">
                <div className="field-stack">
                  <label htmlFor="audience">Audience</label>
                  <select
                    id="audience"
                    onChange={(event) =>
                      updateAudience(event.target.value as ComposerDraft['audience'])
                    }
                    value={draft.audience}
                  >
                    <option value="public">Public network</option>
                    <option value="followers">Followers</option>
                    <option value="community">One community</option>
                  </select>
                </div>
                <div className="field-stack">
                  <label htmlFor="reply-permission">Who may reply</label>
                  <select
                    id="reply-permission"
                    onChange={(event) =>
                      update(
                        'replyPermission',
                        event.target.value as ComposerDraft['replyPermission'],
                      )
                    }
                    value={draft.replyPermission}
                  >
                    <option value="everyone">{REPLY_PERMISSION_LABELS.everyone}</option>
                    <option value="following">{REPLY_PERMISSION_LABELS.following}</option>
                    <option value="mentioned">{REPLY_PERMISSION_LABELS.mentioned}</option>
                    <option value="nobody">{REPLY_PERMISSION_LABELS.nobody}</option>
                  </select>
                </div>
                <div className="field-stack">
                  <label htmlFor="remix-permission">Quote and remix</label>
                  <select
                    id="remix-permission"
                    onChange={(event) =>
                      update(
                        'remixPermission',
                        event.target.value as ComposerDraft['remixPermission'],
                      )
                    }
                    value={draft.remixPermission}
                  >
                    <option value="allow-with-credit">Allow with credit</option>
                    <option value="ask-first">Ask first</option>
                    <option value="disabled">Do not allow</option>
                  </select>
                </div>
                <div className="field-stack field-stack--wide">
                  <label htmlFor="storage-policy">Publication storage preference</label>
                  <select
                    id="storage-policy"
                    onChange={(event) =>
                      update('storagePolicy', event.target.value as ComposerDraft['storagePolicy'])
                    }
                    value={draft.storagePolicy}
                  >
                    <option value="provider-default">Verified local provider</option>
                    <option value="ipfs">External IPFS (adapter required)</option>
                    <option value="arweave">Permanent Arweave (adapter required)</option>
                  </select>
                  <p className="field-help">
                    This localnet proof honors only the verified local provider. IPFS and Arweave
                    remain unavailable until their own adapters can return and verify receipts.
                  </p>
                </div>
                {draft.audience === 'community' ? (
                  <div className="field-stack">
                    <label htmlFor="community-id">Community identifier</label>
                    <input
                      aria-describedby={
                        validation.errors.communityId ? 'community-id-error' : undefined
                      }
                      aria-invalid={Boolean(validation.errors.communityId)}
                      id="community-id"
                      maxLength={180}
                      onChange={(event) => update('communityId', event.target.value)}
                      placeholder="Protocol community ID"
                      value={draft.communityId}
                    />
                    {validation.errors.communityId ? (
                      <p className="field-error" id="community-id-error">
                        {validation.errors.communityId}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>

            <div className="compose-actions">
              <button
                className="native-action native-action--quiet"
                onClick={() => void save()}
                type="button"
              >
                Save draft
              </button>
              {confirmDiscard ? (
                <div
                  className="discard-confirmation"
                  role="group"
                  aria-label="Confirm draft discard"
                >
                  <span>This removes the saved local draft.</span>
                  <button
                    className="text-action"
                    onClick={() => setConfirmDiscard(false)}
                    type="button"
                  >
                    Keep draft
                  </button>
                  <button
                    className="text-action text-action--danger"
                    onClick={() => void discard()}
                    type="button"
                  >
                    Discard now
                  </button>
                </div>
              ) : (
                <button
                  className="text-action"
                  onClick={() => setConfirmDiscard(true)}
                  type="button"
                >
                  Discard draft
                </button>
              )}
            </div>
          </fieldset>
        </form>

        <aside className="compose-preview" aria-labelledby="preview-title">
          <div className="compose-preview__heading">
            <div>
              <p className="section-kicker">Plain-text preview</p>
              <h2 id="preview-title">As readers would receive it</h2>
            </div>
            <StatusBadge tone={validation.valid ? 'neutral' : 'degraded'}>
              {validation.valid ? 'Draft complete' : 'Draft incomplete'}
            </StatusBadge>
          </div>

          <article className="preview-post">
            <header>
              <span className="preview-post__avatar" aria-hidden="true">
                Y
              </span>
              <div>
                <strong>Your portable identity</strong>
                <span>No account connected</span>
              </div>
            </header>
            {previewWarning.trim() ? (
              <div className="preview-content-warning">
                <strong>Content warning</strong>
                <p>{previewWarning}</p>
              </div>
            ) : null}
            <p
              className={previewText.trim() ? 'preview-post__body' : 'preview-post__body is-empty'}
            >
              {previewText.trim() || 'Your plain-text post preview will appear here.'}
            </p>
            {draft.media.sourceUrl.trim() ? (
              <div className="preview-media">
                <span>Referenced media</span>
                <strong>{draft.media.mediaType.trim() || 'Type not supplied'}</strong>
                <p>{normalizePreviewText(draft.media.altText).trim() || 'Alt text required'}</p>
              </div>
            ) : null}
            <dl>
              <div>
                <dt>Audience</dt>
                <dd>{audienceLabel(draft)}</dd>
              </div>
              <div>
                <dt>Replies</dt>
                <dd>{permissionLabel(draft.replyPermission)}</dd>
              </div>
              <div>
                <dt>Quote / remix</dt>
                <dd>{remixLabel(draft.remixPermission)}</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>{storageLabel(draft.storagePolicy)}</dd>
              </div>
            </dl>
          </article>

          {publicationConfig.kind === 'unavailable' ? (
            <div className="publication-lock" role="note">
              <div>
                <p className="section-kicker">Publication locked</p>
                <h3>The development proof runtime is unavailable.</h3>
              </div>
              <p>{publicationConfig.detail}</p>
              <ol>
                <li>Fresh passkey approval and deterministic identity reconciliation</li>
                <li>Verified local content-addressed storage receipt</li>
                <li>Finalized local-validator transaction and indexer checkpoint</li>
              </ol>
              <button aria-describedby="publication-lock-note" disabled type="button">
                Publish unavailable
              </button>
              <p id="publication-lock-note">
                No signing, upload, faucet request, payment, or transaction is attempted in this
                locked state.
              </p>
              <div className="publication-auth-links">
                <Link href="/onboarding">Create a passkey account</Link>
                <Link href="/signin">Sign in with a passkey</Link>
              </div>
            </div>
          ) : (
            <div
              aria-busy={publicationBusy}
              className="publication-panel"
              data-outcome={publicationOutcome(publication)}
            >
              <header>
                <div>
                  <p className="section-kicker">Localnet publication proof</p>
                  <h3>{publicationTitle(publication)}</h3>
                </div>
                <StatusBadge tone={publicationTone(publication)}>
                  {publicationBadge(publication)}
                </StatusBadge>
              </header>

              <p
                className="publication-panel__eligibility"
                data-eligible={publicationStartEligible}
              >
                {finalizedIntentRecovery
                  ? 'A finalized durable intent can resume without a saved draft: exact content, chain account, transaction, and indexer evidence will be revalidated before cleanup.'
                  : publicationEligibility.detail}
              </p>

              {durableIntent.kind === 'active' ? (
                <div
                  className="publication-panel__note"
                  data-durable-intent-stage={durableIntent.stage}
                  data-testid="durable-publication-resume"
                  role="note"
                >
                  <strong>A durable publication is ready to resume.</strong>
                  <p>
                    Saved stage: {durableIntent.stage}. Editing and discard are locked. Resume
                    reuses the exact timestamp, nonces, CID, account address, and finalized evidence
                    instead of creating another post.
                  </p>
                  {durableIntent.objectId === undefined ? null : (
                    <code>{durableIntent.objectId}</code>
                  )}
                </div>
              ) : durableIntent.kind === 'checking' ? (
                <p className="publication-panel__note" role="status">
                  Checking for a durable publication before enabling edits…
                </p>
              ) : durableIntent.kind === 'invalid' ? (
                <p className="publication-error" role="alert">
                  {durableIntent.detail}
                </p>
              ) : null}

              <p className="publication-auth-state">{authReadinessCopy(authReadiness)}</p>
              {authReadiness === 'authenticated' ? null : (
                <div className="publication-auth-links">
                  <Link href="/onboarding">Create a passkey account</Link>
                  <Link href="/signin">Sign in with a passkey</Link>
                  <button
                    className="text-action"
                    disabled={authReadiness === 'checking'}
                    onClick={() => void refreshAuthSession()}
                    type="button"
                  >
                    {authReadiness === 'checking' ? 'Checking session…' : 'Check session again'}
                  </button>
                </div>
              )}

              <ol className="publication-progress" aria-label="Localnet proof stages">
                {PUBLICATION_STEPS.map((step, index) => (
                  <li data-state={publicationStepState(publication, index)} key={step.label}>
                    {step.label}
                  </li>
                ))}
              </ol>

              <div
                aria-atomic="true"
                aria-live={publication.kind === 'error' ? 'assertive' : 'polite'}
                className="publication-live"
                ref={publicationStatusRef}
                role={publication.kind === 'error' ? 'alert' : 'status'}
                tabIndex={-1}
              >
                <p className="publication-live-copy">{publicationLiveCopy(publication)}</p>
              </div>

              {publication.kind === 'error' ? (
                <p className="publication-error">{publication.detail}</p>
              ) : null}

              {publication.kind === 'cancelled' ? (
                <p className="publication-panel__note">{publication.detail}</p>
              ) : null}

              {publication.kind === 'success' ? (
                <>
                  <PublicationEvidence result={publication.result} />
                  {publication.cleanup === 'pending' ? (
                    <p className="publication-cleanup-warning">
                      {publication.cleanupDetail ??
                        'Saved-draft cleanup is pending. The verified result remains visible in this view.'}
                    </p>
                  ) : (
                    <p className="publication-panel__note">
                      The active publication intent was retired only after the indexed checkpoint
                      succeeded; the saved Composer draft was then cleared. This rendered evidence
                      describes a local validator proof only.
                    </p>
                  )}
                </>
              ) : null}

              <div className="publication-actions">
                {publication.kind === 'active' ? (
                  <button
                    className="publication-action--cancel"
                    disabled={publication.cancelRequested}
                    onClick={cancelPublication}
                    type="button"
                  >
                    {publication.cancelRequested ? 'Cancellation requested…' : 'Cancel proof'}
                  </button>
                ) : publication.kind === 'success' && publication.cleanup === 'pending' ? (
                  <button
                    className="publication-action--secondary"
                    onClick={() => void finishLocalCleanup()}
                    type="button"
                  >
                    Finish local cleanup
                  </button>
                ) : publication.kind === 'success' ? null : (
                  <button
                    aria-describedby="localnet-publish-boundary"
                    className="publication-action--primary"
                    disabled={
                      !publicationStartEligible ||
                      authReadiness !== 'authenticated' ||
                      publicationBusy ||
                      durableIntent.kind === 'checking' ||
                      durableIntent.kind === 'invalid'
                    }
                    onClick={() => void startPublication()}
                    type="button"
                  >
                    {durableIntent.kind === 'active'
                      ? 'Resume exact local proof'
                      : publication.kind === 'cancelled' || publication.kind === 'error'
                        ? 'Retry the same local proof'
                        : authReadiness === 'checking'
                          ? 'Checking passkey session…'
                          : authReadiness !== 'authenticated'
                            ? 'Sign in before publishing'
                            : 'Publish proof to local validator'}
                  </button>
                )}
              </div>

              <p className="publication-panel__note">
                <span id="localnet-publish-boundary">
                  This can request faucet test SOL and spend it on local rent and transaction fees.
                  It never transfers $WOKE or production funds.
                </span>
              </p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function PublicationEvidence({ result }: { readonly result: LocalnetTextPostPublicationResult }) {
  const receipt = result.post.storageReceipt;
  const indexedCheckpoint = result.post.indexed.meta.checkpointSlot;
  return (
    <dl className="publication-evidence" aria-label="Verified localnet publication evidence">
      <div className="publication-evidence__wide">
        <dt>WokeNet deployment</dt>
        <dd>
          <code>{result.networkId}</code>
        </dd>
      </div>
      <div className="publication-evidence__wide">
        <dt>Root authority</dt>
        <dd>
          <code>{result.rootAuthority}</code>
        </dd>
      </div>
      <div>
        <dt>Identity disposition</dt>
        <dd>
          {result.identity.disposition === 'created' ? 'Created and finalized' : 'Reconciled'}
        </dd>
      </div>
      <div>
        <dt>Identity finalized slot</dt>
        <dd>{result.identity.finalizedSlot.toString()}</dd>
      </div>
      <div className="publication-evidence__wide">
        <dt>WokeSocial identity ID</dt>
        <dd>
          <code>{result.identity.id}</code>
        </dd>
      </div>
      <div className="publication-evidence__wide">
        <dt>Identity account</dt>
        <dd>
          <code>{result.identity.address}</code>
        </dd>
      </div>
      <div>
        <dt>Identity sequence</dt>
        <dd>{result.identity.sequence.toString()}</dd>
      </div>
      <div>
        <dt>Indexed identity slot</dt>
        <dd>{result.identity.indexed.updatedSlot.toString()}</dd>
      </div>
      {result.identity.transaction === null ? null : (
        <>
          <div className="publication-evidence__wide">
            <dt>Finalized identity transaction</dt>
            <dd>
              <code>{result.identity.transaction.signature}</code>
            </dd>
          </div>
          <div>
            <dt>Identity simulation slot</dt>
            <dd>{result.identity.transaction.simulationSlot.toString()}</dd>
          </div>
          <div>
            <dt>Simulated identity fee</dt>
            <dd>{result.identity.transaction.simulatedFeeLamports.toString()} lamports</dd>
          </div>
        </>
      )}
      <div>
        <dt>Identity account rent</dt>
        <dd>
          {result.identity.rentExemptLamports === null
            ? 'Unavailable · existing account reconciled'
            : `${result.identity.rentExemptLamports.toLocaleString('en')} lamports`}
        </dd>
      </div>
      <div>
        <dt>Faucet funding</dt>
        <dd>
          {result.funding.fundedLamports === 0
            ? 'No airdrop required'
            : `${result.funding.fundedLamports.toLocaleString('en')} lamports`}
        </dd>
      </div>
      <div>
        <dt>Balance after faucet check</dt>
        <dd>{result.funding.balanceLamports.toLocaleString('en')} lamports</dd>
      </div>
      {result.funding.airdropSignature === null ? null : (
        <div className="publication-evidence__wide">
          <dt>Finalized faucet signature</dt>
          <dd>
            <code>{result.funding.airdropSignature}</code>
          </dd>
        </div>
      )}
      <div>
        <dt>Post disposition</dt>
        <dd>{result.post.disposition === 'published' ? 'Published locally' : 'Reconciled'}</dd>
      </div>
      <div>
        <dt>Storage disposition</dt>
        <dd>{storageDispositionLabel(result.post.storageDisposition)}</dd>
      </div>
      <div className="publication-evidence__wide">
        <dt>Post reference account</dt>
        <dd>
          <code>{result.post.address}</code>
        </dd>
      </div>
      <div className="publication-evidence__wide">
        <dt>Object ID</dt>
        <dd>
          <code>{result.post.objectId}</code>
        </dd>
      </div>
      <div className="publication-evidence__wide">
        <dt>Content CID</dt>
        <dd>
          <code>{result.post.cid}</code>
        </dd>
      </div>
      <div className="publication-evidence__wide">
        <dt>Canonical payload hash</dt>
        <dd>
          <code>{result.post.payloadHash}</code>
        </dd>
      </div>
      <div>
        <dt>Storage receipt</dt>
        <dd>{`${receipt.provider} v${receipt.providerVersion} · verified`}</dd>
      </div>
      <div>
        <dt>Stored bytes</dt>
        <dd>{receipt.byteLength.toLocaleString('en')}</dd>
      </div>
      <div>
        <dt>Storage policy</dt>
        <dd>{receipt.policy.permanence}</dd>
      </div>
      <div>
        <dt>Client-observed storage time</dt>
        <dd>{receipt.publishedAt}</dd>
      </div>
      <div className="publication-evidence__wide">
        <dt>Storage locator</dt>
        <dd>
          <code>{receipt.locator}</code>
        </dd>
      </div>
      <div className="publication-evidence__wide">
        <dt>Finalized post transaction</dt>
        <dd>
          <code>{result.post.transaction.signature}</code>
        </dd>
      </div>
      <div>
        <dt>Finalized post slot</dt>
        <dd>{result.post.transaction.slot.toString()}</dd>
      </div>
      <div>
        <dt>Observed author sequence</dt>
        <dd>{result.post.transaction.observedAuthorSequence.toString()}</dd>
      </div>
      <div>
        <dt>Transaction evidence</dt>
        <dd>{transactionSourceLabel(result.post.transaction.source)}</dd>
      </div>
      <div>
        <dt>Post account rent</dt>
        <dd>
          {result.post.rentExemptLamports === null
            ? 'Unavailable · recovered execution'
            : `${result.post.rentExemptLamports.toLocaleString('en')} lamports`}
        </dd>
      </div>
      <div>
        <dt>Simulated post fee</dt>
        <dd>
          {result.post.execution === null
            ? 'Unavailable · recovered execution'
            : `${result.post.execution.simulatedFeeLamports.toLocaleString('en')} lamports`}
        </dd>
      </div>
      <div>
        <dt>Indexed checkpoint slot</dt>
        <dd>{indexedCheckpoint === null ? 'Unavailable' : indexedCheckpoint.toString()}</dd>
      </div>
      <div>
        <dt>Indexer source</dt>
        <dd>{result.post.indexed.meta.source}</dd>
      </div>
      <div>
        <dt>Indexer observation</dt>
        <dd>{result.post.indexed.meta.indexedAt}</dd>
      </div>
      <div>
        <dt>Returned intent snapshot</dt>
        <dd>Finalized evidence returned</dd>
      </div>
    </dl>
  );
}

function publicationOutcome(publication: PublicationView): 'error' | 'idle' | 'success' {
  if (publication.kind === 'success') return 'success';
  if (publication.kind === 'error') return 'error';
  return 'idle';
}

function publicationTone(
  publication: PublicationView,
): 'degraded' | 'neutral' | 'pending' | 'verified' {
  switch (publication.kind) {
    case 'active':
      return 'pending';
    case 'cancelled':
    case 'error':
      return 'degraded';
    case 'success':
      return 'verified';
    case 'idle':
      return 'neutral';
  }
}

function publicationBadge(publication: PublicationView): string {
  switch (publication.kind) {
    case 'active':
      return publication.cancelRequested ? 'Stopping safely' : 'Proof in progress';
    case 'cancelled':
      return 'Stopped without success';
    case 'error':
      return 'Not verified';
    case 'success':
      return 'Verified local proof';
    case 'idle':
      return 'No write started';
  }
}

function publicationTitle(publication: PublicationView): string {
  switch (publication.kind) {
    case 'active':
      return 'Verify every boundary before success.';
    case 'cancelled':
      return 'The proof stopped before verification.';
    case 'error':
      return 'No publication success was claimed.';
    case 'success':
      return 'One localnet post is fully evidenced.';
    case 'idle':
      return 'Prepare a verifiable local receipt.';
  }
}

function publicationLiveCopy(publication: PublicationView): string {
  switch (publication.kind) {
    case 'active':
      return publication.cancelRequested
        ? 'Cancellation was requested. The current boundary is stopping; finalized chain actions cannot be reversed.'
        : progressStageCopy(publication.stage);
    case 'cancelled':
      return stageMayHaveDurablePostIntent(publication.stage)
        ? 'Stopped. The draft is locked to its persisted coordinates; retry reconciles them before any new submission.'
        : 'Stopped before post coordinates were persisted. No verified publication result was returned.';
    case 'error':
      return publication.stage !== undefined && stageMayHaveDurablePostIntent(publication.stage)
        ? 'The pipeline ended without complete evidence. The draft is locked to its durable coordinates for an exact retry.'
        : 'The pipeline ended without returning complete verified evidence.';
    case 'success':
      return 'Verified complete: storage bytes, finalized post reference, and indexer checkpoint agree.';
    case 'idle':
      return 'Idle. No passkey prompt, content write, faucet request, or transaction has started.';
  }
}

function progressStageCopy(stage: LocalnetTextPostPublicationStage): string {
  switch (stage) {
    case 'authenticating':
      return 'Waiting for a fresh user-verifying passkey approval. Private key material stays inside the callback scope.';
    case 'deriving-identity':
      return 'Deriving the deterministic primary WokeNet identity from the verified public root.';
    case 'reconciling-identity':
      return 'Checking the exact identity account before deciding whether a create transaction is needed.';
    case 'funding':
      return 'Checking local rent and fee readiness; the loopback faucet may add test SOL up to the disclosed target.';
    case 'creating-identity':
      return 'Simulating, submitting, and finalizing the deterministic identity account on the local validator.';
    case 'indexing-identity':
      return 'Waiting for the local indexer to cover the finalized identity slot and exact root authority.';
    case 'preparing-post':
      return 'Persisting the post timestamp and nonces before signing so a retry cannot invent new coordinates.';
    case 'signing-post':
      return 'Requesting a signature over the exact canonical public plain-text envelope.';
    case 'storing-post':
      return 'Writing the canonical envelope bytes to local content storage and verifying the returned CID receipt.';
    case 'reconciling-post':
      return 'Checking the deterministic post reference and durable intent before any new transaction.';
    case 'publishing-post':
      return 'Simulating and submitting only the exact post reference to the Solana local validator.';
    case 'verifying-finality':
      return 'Verifying finalized account bytes, transaction coordinates, CID, and canonical payload hash.';
    case 'indexing-post':
      return 'Waiting for the local indexer checkpoint to cover the finalized post slot.';
    case 'verifying-content':
      return 'Re-reading the exact canonical envelope from local content storage before reporting success.';
    case 'complete':
      return 'Every stage reported complete; validating the returned evidence bundle before showing success.';
  }
}

function stageMayHaveDurablePostIntent(stage: LocalnetTextPostPublicationStage): boolean {
  return [
    'preparing-post',
    'signing-post',
    'storing-post',
    'reconciling-post',
    'publishing-post',
    'verifying-finality',
    'indexing-post',
    'verifying-content',
    'complete',
  ].includes(stage);
}

function publicationStepState(
  publication: PublicationView,
  stepIndex: number,
): 'active' | 'complete' | 'pending' | 'stopped' {
  if (publication.kind === 'success') return 'complete';
  if (
    publication.kind === 'idle' ||
    (publication.kind === 'error' && publication.stage === undefined)
  ) {
    return 'pending';
  }
  const stage =
    publication.kind === 'active' ||
    publication.kind === 'cancelled' ||
    publication.kind === 'error'
      ? publication.stage
      : undefined;
  if (stage === undefined) return 'pending';
  const activeStep = PUBLICATION_STEPS.findIndex((step) =>
    (step.stages as readonly string[]).includes(stage),
  );
  if (activeStep < 0) return 'pending';
  if (stepIndex < activeStep) return 'complete';
  if (stepIndex > activeStep) return 'pending';
  return publication.kind === 'active' ? 'active' : 'stopped';
}

function authReadinessCopy(readiness: AuthReadiness): string {
  switch (readiness) {
    case 'authenticated':
      return 'An authentication-service session is active. Publication still requires a fresh passkey prompt.';
    case 'checking':
      return 'Checking this browser for an active authentication-service session…';
    case 'unauthenticated':
      return 'No active passkey service session was found. Sign in or create a passkey account first.';
    case 'error':
      return 'The local authentication service could not confirm a session. No signer has been requested.';
  }
}

function safePublicationError(error: unknown): string {
  if (error instanceof BrowserPublicationLockError) {
    return `${error.message} No publication operation ran outside the exclusive browser lock.`;
  }
  if (error instanceof BrowserAuthError) {
    return `${error.message} No verified local publication result was returned.`;
  }
  const generic =
    'A local dependency or verification boundary failed. No verified publication result was returned; inspect the local validator, content store, authentication service, and indexer before retrying.';
  if (process.env.NODE_ENV === 'development' && error instanceof LocalnetTextPostPublicationError) {
    return `${generic} Development diagnostic: ${boundedErrorChain(error)}`;
  }
  return generic;
}

function boundedErrorChain(error: Error): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const code = 'code' in current && typeof current.code === 'string' ? `:${current.code}` : '';
    const stage =
      'stage' in current && typeof current.stage === 'string' ? `@${current.stage}` : '';
    parts.push(`${current.name}${code}${stage} — ${current.message}`.slice(0, 320));
    current = current.cause;
  }
  return parts.join(' ← ');
}

function isPublicationCancellation(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (error instanceof BrowserAuthError && error.code === 'ceremony-cancelled') return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'aborted'
  );
}

function storageDispositionLabel(
  disposition: LocalnetTextPostPublicationResult['post']['storageDisposition'],
): string {
  switch (disposition) {
    case 'stored':
      return 'Stored and verified';
    case 'already-present':
      return 'Existing bytes verified';
    case 'durable-receipt':
      return 'Durable receipt reconciled';
  }
}

function transactionSourceLabel(
  source: LocalnetTextPostPublicationResult['post']['transaction']['source'],
): string {
  switch (source) {
    case 'execution':
      return 'Current execution';
    case 'durable-intent':
      return 'Durable intent';
    case 'rpc-recovery':
      return 'RPC response recovery';
  }
}

function subscribeToHydration() {
  return () => undefined;
}

function getClientHydration() {
  return true;
}

function getServerHydration() {
  return false;
}

function audienceLabel(draft: ComposerDraft): string {
  switch (draft.audience) {
    case 'public':
      return 'Public network';
    case 'followers':
      return 'Followers';
    case 'community':
      return draft.communityId.trim()
        ? `Community · ${normalizePreviewText(draft.communityId)}`
        : 'Community not chosen';
  }
}

function permissionLabel(permission: ComposerDraft['replyPermission']): string {
  return REPLY_PERMISSION_LABELS[permission];
}

function remixLabel(permission: ComposerDraft['remixPermission']): string {
  switch (permission) {
    case 'allow-with-credit':
      return 'Allowed with credit';
    case 'ask-first':
      return 'Ask first';
    case 'disabled':
      return 'Not allowed';
  }
}

function storageLabel(policy: ComposerDraft['storagePolicy']): string {
  switch (policy) {
    case 'provider-default':
      return 'Verified local provider';
    case 'ipfs':
      return 'External IPFS · adapter required';
    case 'arweave':
      return 'Permanent Arweave · adapter required';
  }
}

interface PublicationEligibility {
  readonly eligible: boolean;
  readonly detail: string;
}

function getPublicationEligibility(
  draft: ComposerDraft,
  draftValid: boolean,
): PublicationEligibility {
  if (!draftValid) {
    return {
      eligible: false,
      detail: 'Complete the draft and resolve its validation messages before starting the proof.',
    };
  }
  if (draft.audience !== 'public' || draft.communityId !== '') {
    return {
      eligible: false,
      detail: 'The localnet proof currently supports a public audience only.',
    };
  }
  if (draft.media.sourceUrl !== '' || draft.media.mediaType !== '' || draft.media.altText !== '') {
    return {
      eligible: false,
      detail: 'Remove the media reference and metadata. This proof accepts plain text only.',
    };
  }
  if (draft.storagePolicy !== 'provider-default') {
    return {
      eligible: false,
      detail:
        'This proof verifies only the configured local filesystem provider. Choose Verified local provider; IPFS and Arweave require separate receipt-verifying adapters.',
    };
  }
  if (draft.remixPermission === 'ask-first') {
    return {
      eligible: false,
      detail:
        'The protocol cannot preserve an ask-first remix policy yet. Choose allow with credit or do not allow.',
    };
  }
  return {
    eligible: true,
    detail:
      'Eligible: public plain text, no media, and the verified local filesystem provider. A fresh passkey approval is still required.',
  };
}

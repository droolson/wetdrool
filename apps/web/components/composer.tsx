'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { StatusBadge } from '@socially-woke/ui';

import {
  MAX_POST_CHARACTERS,
  MAX_POST_UTF8_BYTES,
  createEmptyComposerDraft,
  discardComposerDraft,
  loadComposerDraft,
  normalizePreviewText,
  saveComposerDraft,
  unicodeCharacterCount,
  utf8ByteLength,
  validateComposerDraft,
  type ComposerDraft,
} from '@/lib/composer-draft';

type SaveState = 'idle' | 'saved' | 'storage-error';

export function Composer() {
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

  return <HydratedComposer />;
}

function HydratedComposer() {
  const [initialDraft] = useState(() => loadComposerDraft(window.localStorage));
  const [draft, setDraft] = useState(() => initialDraft ?? createEmptyComposerDraft());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [restored, setRestored] = useState(initialDraft !== null);
  const validation = useMemo(() => validateComposerDraft(draft), [draft]);
  const previewText = normalizePreviewText(draft.text);
  const previewWarning = normalizePreviewText(draft.contentWarning);
  const textCharacterCount = unicodeCharacterCount(previewText);
  const textByteCount = utf8ByteLength(previewText);

  function update<K extends keyof ComposerDraft>(key: K, value: ComposerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveState('idle');
    setConfirmDiscard(false);
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
  }

  function save() {
    setSaveState(saveComposerDraft(window.localStorage, draft) ? 'saved' : 'storage-error');
    setConfirmDiscard(false);
  }

  function discard() {
    const discarded = discardComposerDraft(window.localStorage);
    setDraft(createEmptyComposerDraft());
    setSaveState(discarded ? 'idle' : 'storage-error');
    setRestored(false);
    setConfirmDiscard(false);
  }

  return (
    <div className="compose-workspace">
      <form className="compose-form" onSubmit={(event) => event.preventDefault()}>
        <div className="compose-form__status">
          <StatusBadge tone="pending">Local draft only</StatusBadge>
          <p aria-live="polite">
            {saveState === 'saved'
              ? 'Draft saved on this device.'
              : saveState === 'storage-error'
                ? 'Browser storage is unavailable. Keep this page open to retain the draft.'
                : restored
                  ? 'A draft saved on this device was restored.'
                  : 'Nothing leaves this browser while publication adapters are unavailable.'}
          </p>
        </div>

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
                {textByteCount.toLocaleString('en')} / {MAX_POST_UTF8_BYTES.toLocaleString('en')}{' '}
                UTF-8 bytes
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
                  validation.errors.altText ? 'media-alt-help media-alt-error' : 'media-alt-help'
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
                  update('audience', event.target.value as ComposerDraft['audience'])
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
                  update('replyPermission', event.target.value as ComposerDraft['replyPermission'])
                }
                value={draft.replyPermission}
              >
                <option value="everyone">Everyone</option>
                <option value="following">People I follow</option>
                <option value="mentioned">Mentioned people</option>
                <option value="nobody">No replies</option>
              </select>
            </div>
            <div className="field-stack">
              <label htmlFor="remix-permission">Quote and remix</label>
              <select
                id="remix-permission"
                onChange={(event) =>
                  update('remixPermission', event.target.value as ComposerDraft['remixPermission'])
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
                <option value="provider-default">Ask the configured provider</option>
                <option value="ipfs">Content-addressed / IPFS</option>
                <option value="arweave">Permanent / Arweave</option>
              </select>
              <p className="field-help">
                This preference is not executed until an adapter can return and verify a receipt.
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
          <button className="native-action native-action--quiet" onClick={save} type="button">
            Save draft
          </button>
          {confirmDiscard ? (
            <div className="discard-confirmation" role="group" aria-label="Confirm draft discard">
              <span>This removes the saved local draft.</span>
              <button
                className="text-action"
                onClick={() => setConfirmDiscard(false)}
                type="button"
              >
                Keep draft
              </button>
              <button className="text-action text-action--danger" onClick={discard} type="button">
                Discard now
              </button>
            </div>
          ) : (
            <button className="text-action" onClick={() => setConfirmDiscard(true)} type="button">
              Discard draft
            </button>
          )}
        </div>
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
          <p className={previewText.trim() ? 'preview-post__body' : 'preview-post__body is-empty'}>
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

        <div className="publication-lock">
          <div>
            <p className="section-kicker">Publication locked</p>
            <h3>Three receipts are still required.</h3>
          </div>
          <ol>
            <li>Signed canonical manifest</li>
            <li>Verified storage receipt</li>
            <li>Finalized protocol transaction</li>
          </ol>
          <button aria-describedby="publication-lock-note" disabled type="button">
            Publish unavailable
          </button>
          <p id="publication-lock-note">
            No signing, upload, payment, or transaction is attempted by this preview.
          </p>
        </div>
      </aside>
    </div>
  );
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
  switch (permission) {
    case 'everyone':
      return 'Everyone';
    case 'following':
      return 'People you follow';
    case 'mentioned':
      return 'Mentioned people';
    case 'nobody':
      return 'No replies';
  }
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
      return 'Provider choice';
    case 'ipfs':
      return 'Content-addressed / IPFS';
    case 'arweave':
      return 'Permanent / Arweave';
  }
}

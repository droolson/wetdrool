'use client';

import { useEffect, useMemo, useState } from 'react';
import { InfoCard, StatePanel, StatusBadge } from '@wetdrool/ui';

import {
  createEmptySiteBuilderDraft,
  deriveSiteSubdomain,
  discardSiteBuilderDraft,
  loadSiteBuilderDraft,
  prepareSiteGenerationRequest,
  saveSiteBuilderDraft,
  SITE_ACCENTS,
  SITE_PRESETS,
  SiteSubdomainError,
  validateSiteBuilderDraft,
  type SiteBuilderDraft,
  type SitePresetId,
} from '@/lib/site-builder';
import { DROOL_AI_MODELS, DROOL_AI_SITE_BUILDER_MODEL } from '@/lib/drool-ai';

interface SiteBuilderProps {
  readonly runtime:
    | { readonly detail: string; readonly kind: 'unavailable' }
    | { readonly endpoint: string; readonly kind: 'configured' };
}

type SaveState = 'idle' | 'saved' | 'storage-error';

export function SiteBuilder({ runtime }: SiteBuilderProps) {
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState<SiteBuilderDraft>(createEmptySiteBuilderDraft);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const stored = loadSiteBuilderDraft(window.localStorage);
    if (stored !== null) {
      setDraft(stored);
      setRestored(true);
    }
    setHydrated(true);
  }, []);

  const validation = useMemo(() => validateSiteBuilderDraft(draft), [draft]);
  const subdomain = useMemo(() => {
    try {
      return draft.handle.trim() === '' ? null : deriveSiteSubdomain(draft.handle);
    } catch (error) {
      return error instanceof SiteSubdomainError ? null : null;
    }
  }, [draft.handle]);
  const preset = SITE_PRESETS.find((candidate) => candidate.id === draft.preset) ?? SITE_PRESETS[0];
  const preparedRequest = useMemo(() => {
    if (!validation.valid) return null;
    try {
      return prepareSiteGenerationRequest(draft);
    } catch {
      return null;
    }
  }, [draft, validation.valid]);
  const builderModel = DROOL_AI_MODELS.find((model) => model.id === DROOL_AI_SITE_BUILDER_MODEL);

  if (!hydrated) {
    return (
      <div className="compose-preparing" role="status">
        Preparing the local site draft workspace…
      </div>
    );
  }

  function update<K extends keyof SiteBuilderDraft>(key: K, value: SiteBuilderDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveState('idle');
  }

  function save() {
    try {
      saveSiteBuilderDraft(window.localStorage, draft);
      setSaveState('saved');
    } catch {
      setSaveState('storage-error');
    }
  }

  function discard() {
    try {
      discardSiteBuilderDraft(window.localStorage);
      setDraft(createEmptySiteBuilderDraft());
      setRestored(false);
      setSaveState('idle');
    } catch {
      setSaveState('storage-error');
    }
  }

  return (
    <div className="compose-workspace">
      <form className="compose-form" onSubmit={(event) => event.preventDefault()}>
        <div className="compose-form__status">
          <StatusBadge tone="pending">Device draft</StatusBadge>
          <p aria-live="polite">
            {saveState === 'saved'
              ? 'Site draft saved on this device.'
              : saveState === 'storage-error'
                ? 'Browser storage is unavailable. Keep this page open to retain the draft.'
                : restored
                  ? 'A site draft saved on this device was restored.'
                  : 'Nothing is generated, uploaded, or served until publishing goes live.'}
          </p>
        </div>

        <section className="compose-section" aria-labelledby="site-subdomain-title">
          <div className="compose-section__heading">
            <span aria-hidden="true">01</span>
            <div>
              <h2 id="site-subdomain-title">Your subdomain</h2>
              <p>Every finalized `.drool` handle reserves one exact `wetdrool.com` subdomain.</p>
            </div>
          </div>
          <div className="field-stack">
            <label htmlFor="site-handle">.drool handle</label>
            <input
              aria-describedby={
                validation.errors.handle ? 'site-handle-help site-handle-error' : 'site-handle-help'
              }
              aria-invalid={Boolean(validation.errors.handle)}
              id="site-handle"
              maxLength={40}
              onChange={(event) => update('handle', event.target.value)}
              placeholder="alexbtc420 or anon_7n044tsjxrfm5e23"
              value={draft.handle}
            />
            <p className="field-help" id="site-handle-help">
              {subdomain === null
                ? 'Underscores map to hyphens; two different handles can never collide on one label.'
                : `Reserved bundle: ${subdomain.host} · ${subdomain.email}`}
            </p>
            {validation.errors.handle ? (
              <p className="field-error" id="site-handle-error">
                {validation.errors.handle}
              </p>
            ) : null}
          </div>
          <p className="field-help">
            The label becomes yours to serve only after the handle claim is finalized onchain and
            the site-publishing service verifies it. This flow never claims a handle for you.
          </p>
        </section>

        <section className="compose-section" aria-labelledby="site-preset-title">
          <div className="compose-section__heading">
            <span aria-hidden="true">02</span>
            <div>
              <h2 id="site-preset-title">Pick a preset</h2>
              <p>Three starting points. Every claim on the finished site stays verifiable.</p>
            </div>
          </div>
          <div className="product-card-grid" role="radiogroup" aria-label="Site presets">
            {SITE_PRESETS.map((candidate) => (
              <label
                className="site-preset-option"
                data-featured={candidate.featured}
                data-selected={draft.preset === candidate.id}
                key={candidate.id}
              >
                <input
                  checked={draft.preset === candidate.id}
                  name="site-preset"
                  onChange={() => update('preset', candidate.id as SitePresetId)}
                  type="radio"
                  value={candidate.id}
                />
                <span className="site-preset-option__body">
                  <span className="site-preset-option__label">
                    <strong>{candidate.label}</strong>
                    {candidate.featured ? (
                      <StatusBadge tone="verified">Featured</StatusBadge>
                    ) : null}
                  </span>
                  <em>{candidate.headline}</em>
                  <span>{candidate.description}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="compose-section" aria-labelledby="site-brand-title">
          <div className="compose-section__heading">
            <span aria-hidden="true">03</span>
            <div>
              <h2 id="site-brand-title">Brand and brief</h2>
              <p>The builder generates from exactly this brief — nothing hidden is added.</p>
            </div>
          </div>
          <div className="field-grid">
            <div className="field-stack">
              <label htmlFor="site-title">Site title</label>
              <input
                aria-invalid={Boolean(validation.errors.title)}
                id="site-title"
                maxLength={80}
                onChange={(event) => update('title', event.target.value)}
                placeholder={preset.id === 'crypto-project' ? 'Woke Protocol' : 'My site'}
                value={draft.title}
              />
              {validation.errors.title ? (
                <p className="field-error">{validation.errors.title}</p>
              ) : null}
            </div>
            <div className="field-stack">
              <label htmlFor="site-accent">Accent</label>
              <select
                id="site-accent"
                onChange={(event) =>
                  update('accent', event.target.value as SiteBuilderDraft['accent'])
                }
                value={draft.accent}
              >
                {SITE_ACCENTS.map((accent) => (
                  <option key={accent} value={accent}>
                    {accent}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-stack field-stack--full">
              <label htmlFor="site-tagline">
                Tagline <span>Optional</span>
              </label>
              <input
                aria-invalid={Boolean(validation.errors.tagline)}
                id="site-tagline"
                maxLength={160}
                onChange={(event) => update('tagline', event.target.value)}
                placeholder="One sentence readers should remember."
                value={draft.tagline}
              />
              {validation.errors.tagline ? (
                <p className="field-error">{validation.errors.tagline}</p>
              ) : null}
            </div>
            <div className="field-stack field-stack--full">
              <label htmlFor="site-prompt">
                Builder brief <span>Optional</span>
              </label>
              <textarea
                aria-invalid={Boolean(validation.errors.prompt)}
                id="site-prompt"
                maxLength={2_000}
                onChange={(event) => update('prompt', event.target.value)}
                placeholder={
                  preset.id === 'crypto-project'
                    ? 'Describe the project, its Solana program or token coordinates, roadmap milestones, and community links. The builder will only state what it can verify or clearly label.'
                    : 'Describe the voice, sections, and links you want.'
                }
                rows={5}
                value={draft.prompt}
              />
              {validation.errors.prompt ? (
                <p className="field-error">{validation.errors.prompt}</p>
              ) : null}
            </div>
          </div>
          <div className="compose-actions">
            <button className="native-action native-action--quiet" onClick={save} type="button">
              Save draft
            </button>
            <button className="text-action" onClick={discard} type="button">
              Discard draft
            </button>
          </div>
        </section>

        <section className="compose-section" aria-labelledby="site-generation-title">
          <div className="compose-section__heading">
            <span aria-hidden="true">04</span>
            <div>
              <h2 id="site-generation-title">Drool AI generation</h2>
              <p>
                {builderModel === undefined
                  ? 'Self-hosted generation.'
                  : `Powered by ${builderModel.label} on the self-hosted Drool AI runtime.`}
              </p>
            </div>
          </div>
          {runtime.kind === 'configured' ? (
            <p className="publication-panel__note">
              A Drool AI runtime endpoint is configured. Generation remains disabled until the
              runtime passes its evaluation gates and the site-publishing service exists; the
              prepared request below is exactly what it will receive.
            </p>
          ) : (
            <p className="publication-panel__note">{runtime.detail}</p>
          )}
          {preparedRequest === null ? (
            <p className="field-help">
              Complete the handle, preset, and title to see the exact prepared generation request.
            </p>
          ) : (
            <details className="proof-details" open>
              <summary>Exact prepared generation request</summary>
              <pre className="site-generation-request">
                <code>{JSON.stringify(preparedRequest, null, 2)}</code>
              </pre>
            </details>
          )}
          <button className="publication-action--primary" disabled type="button">
            Generate site (runtime not connected)
          </button>
        </section>
      </form>

      <aside className="compose-preview" aria-labelledby="site-preview-title">
        <div className="compose-preview__heading">
          <div>
            <p className="section-kicker">Deterministic preview</p>
            <h2 id="site-preview-title">How {subdomain?.host ?? 'your subdomain'} starts</h2>
          </div>
          <StatusBadge tone={validation.valid ? 'neutral' : 'degraded'}>
            {validation.valid ? 'Draft complete' : 'Draft incomplete'}
          </StatusBadge>
        </div>
        <SitePreview draft={draft} />
        <p className="publication-panel__note">
          This preview renders locally from your draft. Generated sites are static bundles with no
          trackers or external scripts, and every on-chain claim must come from verified data or
          state an honest unavailable value.
        </p>
      </aside>
    </div>
  );
}

function SitePreview({ draft }: { readonly draft: SiteBuilderDraft }) {
  const title = draft.title.trim() || 'Untitled site';
  const tagline = draft.tagline.trim();
  if (draft.preset === 'crypto-project') {
    return (
      <article className="site-preview" data-accent={draft.accent} data-preset="crypto-project">
        <header className="site-preview__hero">
          <p className="section-kicker">Solana project</p>
          <h3>{title}</h3>
          <p>{tagline || 'A verifiable home for the project and its community.'}</p>
        </header>
        <dl className="publication-evidence" aria-label="On-chain stats placeholders">
          <div>
            <dt>Token supply</dt>
            <dd>Awaiting verified on-chain data</dd>
          </div>
          <div>
            <dt>Holders</dt>
            <dd>Awaiting verified on-chain data</dd>
          </div>
          <div>
            <dt>Program</dt>
            <dd>Awaiting verified deployment record</dd>
          </div>
          <div>
            <dt>Liquidity</dt>
            <dd>Awaiting verified on-chain data</dd>
          </div>
        </dl>
        <section aria-label="Roadmap preview">
          <h4>Roadmap</h4>
          <ol>
            <li>Milestones come from your brief — dated, falsifiable, never “soon”.</li>
            <li>Shipped items can link to transactions and releases.</li>
          </ol>
        </section>
        <section aria-label="Community proof preview">
          <h4>Community proof</h4>
          <p>
            Verified WetDrool posts and community activity syndicate here with their signatures
            intact.
          </p>
        </section>
        <footer className="site-preview__footer">
          <p>
            Not financial advice. On-chain facts are shown from verified sources or marked
            unavailable — never estimated.
          </p>
        </footer>
      </article>
    );
  }
  return (
    <article className="site-preview" data-accent={draft.accent} data-preset={draft.preset}>
      <header className="site-preview__hero">
        <p className="section-kicker">
          {draft.preset === 'personal-blog' ? 'Personal blog' : 'Work portfolio'}
        </p>
        <h3>{title}</h3>
        <p>
          {tagline ||
            (draft.preset === 'personal-blog'
              ? 'Your verified posts, readable anywhere.'
              : 'Projects and experience with receipts.')}
        </p>
      </header>
      <section>
        <h4>{draft.preset === 'personal-blog' ? 'Recent posts' : 'Projects'}</h4>
        <p>
          {draft.preset === 'personal-blog'
            ? 'Verified WetDrool posts syndicate here after publishing goes live.'
            : 'Each project entry links to real artifacts you name in the brief.'}
        </p>
      </section>
    </article>
  );
}

export function SiteBuilderUnavailableNote() {
  return (
    <StatePanel
      eyebrow="Publishing not live"
      headingLevel={2}
      title="Drafting works today; serving comes with the publishing service."
      tone="empty"
    >
      <p>
        Wildcard `wetdrool.com` DNS, TLS, and the site-publishing service are not deployed. Drafts
        stay on this device until then.
      </p>
    </StatePanel>
  );
}

export function SiteBuilderInfoCards() {
  return (
    <section className="product-card-grid" aria-label="Site builder commitments">
      <InfoCard eyebrow="Ownership" title="Your handle, your subdomain" tone="plum">
        <p>
          One finalized `.drool` handle maps to exactly one `wetdrool.com` label — deterministically,
          with no auctions and no squatting.
        </p>
      </InfoCard>
      <InfoCard eyebrow="Honesty" title="No fabricated on-chain claims" tone="coral">
        <p>
          Crypto Project pages render supply, holders, and program facts from verified sources or
          say “unavailable”. The builder never invents numbers.
        </p>
      </InfoCard>
      <InfoCard eyebrow="Self-hosted AI" title="Your models, not a data funnel" tone="sky">
        <p>
          Generation runs on the self-hosted Drool AI runtime. Briefs are not sent to third-party
          model providers.
        </p>
      </InfoCard>
      <InfoCard eyebrow="Mail" title="handle@wetdrool.com, encrypted" tone="neutral">
        <p>
          The same handle reserves an E2EE inbox keyed to your onchain identity. Mail between
          WetDrool identities is end-to-end encrypted; mail to ordinary providers cannot be, and
          the client will say which is which. The mail service is not deployed yet.
        </p>
      </InfoCard>
    </section>
  );
}

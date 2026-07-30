'use client';

import { useMemo, useState } from 'react';
import { InfoCard, StatePanel, StatusBadge } from '@wokesocial/ui';

import { deriveSiteSubdomain, SiteSubdomainError } from '@/lib/site-builder';

type TokenStandard = 'spl-token' | 'token-2022';

interface LaunchDraft {
  name: string;
  ticker: string;
  description: string;
  imageRef: string;
  standard: TokenStandard;
  creatorHandle: string;
  virtualSolReserves: string;
  graduationSol: string;
}

const EMPTY_DRAFT: LaunchDraft = {
  name: '',
  ticker: '',
  description: '',
  imageRef: '',
  standard: 'token-2022',
  creatorHandle: '',
  virtualSolReserves: '30',
  graduationSol: '85',
};

const OPEN_GATES = [
  'A reviewed mint-aware Solana ABI with an ADR — the quarantined legacy payment ABI stays dead and is never reused.',
  'Bonding-curve program implementation, adversarial tests, and an independent security review.',
  'Exact-destination disclosure and simulation before every signature, extended to token transactions.',
  'Fee, rent, refund, and sponsorship policy published before any real funds move.',
  'Legal and user-protection review for token launching and trading surfaces.',
] as const;

const AGENT_ENDPOINTS = [
  {
    method: 'GET',
    path: '/v1/launchpad/tokens',
    detail:
      'Bounded discovery: curve state, graduation progress, and verified social-sentiment aggregates per token. Noncanonical, checkpoint-stamped.',
  },
  {
    method: 'GET',
    path: '/v1/launchpad/tokens/{mint}/analysis',
    detail:
      'Woke Hermes analysis over sourced signals only — every claim carries its sources and uncertainty; no advice, no price targets.',
  },
  {
    method: 'POST',
    path: '/v1/launchpad/quotes',
    detail:
      'Deterministic bonding-curve quote for an exact lamport amount, with the exact Solana destination and fee breakdown an agent must disclose.',
  },
  {
    method: 'POST',
    path: '/v1/launchpad/launch-intents',
    detail:
      'Noncustodial launch intent: the platform never holds keys. An agent receives exact simulate-first transaction coordinates to sign client-side.',
  },
] as const;

export function Launchpad() {
  const [draft, setDraft] = useState<LaunchDraft>(EMPTY_DRAFT);

  const handleSubdomain = useMemo(() => {
    if (draft.creatorHandle.trim() === '') return null;
    try {
      return deriveSiteSubdomain(draft.creatorHandle);
    } catch (error) {
      return error instanceof SiteSubdomainError ? null : null;
    }
  }, [draft.creatorHandle]);

  const ticker = draft.ticker.trim().toUpperCase();
  const tickerValid = /^[A-Z0-9]{2,10}$/.test(ticker);

  function update<K extends keyof LaunchDraft>(key: K, value: LaunchDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <>
      <StatePanel
        eyebrow="Preview only"
        headingLevel={2}
        title="No token is created and no trade executes from this page."
        tone="empty"
      >
        <p>
          This is the launch experience being built, shown honestly. Real launching and trading stay
          disabled until every gate below passes. Nothing here is financial advice, and no `$WOKE`
          token exists.
        </p>
      </StatePanel>

      <section className="compose-section" aria-labelledby="launchpad-flow-title">
        <div className="compose-section__heading">
          <span aria-hidden="true">01</span>
          <div>
            <h2 id="launchpad-flow-title">Fair launch, native to the feed</h2>
            <p>Bonding-curve mechanics people know, without leaving the conversation.</p>
          </div>
        </div>
        <div className="product-card-grid">
          <InfoCard eyebrow="Launch" title="One post, one token" tone="plum">
            <p>
              A launch is a signed post. The token thread is the social thread — replies, reactions,
              and holder updates live where trading happens, not on a separate site.
            </p>
          </InfoCard>
          <InfoCard eyebrow="Curve" title="Fair by construction" tone="coral">
            <p>
              Everyone buys the same bonding curve from lamport one — no presale, no team allocation
              by default. At the graduation threshold, liquidity moves to a public Solana AMM.
            </p>
          </InfoCard>
          <InfoCard eyebrow="Signals" title="Sentiment with sources" tone="sky">
            <p>
              Trending ranks on verified, signed social activity — not bot volume. AI analysis cites
              its sources and states uncertainty instead of hyping.
            </p>
          </InfoCard>
          <InfoCard eyebrow="Custody" title="Your keys, always" tone="neutral">
            <p>
              Every signature shows the exact Solana destination first — the same fail-closed
              disclosure the composer already enforces. The platform never holds funds.
            </p>
          </InfoCard>
        </div>
      </section>

      <section className="compose-section" aria-labelledby="launchpad-draft-title">
        <div className="compose-section__heading">
          <span aria-hidden="true">02</span>
          <div>
            <h2 id="launchpad-draft-title">Draft a launch</h2>
            <p>Solana SPL or Token-2022. This draft stays in this browser tab.</p>
          </div>
        </div>
        <form className="compose-form" onSubmit={(event) => event.preventDefault()}>
          <div className="field-grid">
            <div className="field-stack">
              <label htmlFor="launch-name">Token name</label>
              <input
                id="launch-name"
                maxLength={40}
                onChange={(event) => update('name', event.target.value)}
                placeholder="Woke Doge"
                value={draft.name}
              />
            </div>
            <div className="field-stack">
              <label htmlFor="launch-ticker">Ticker</label>
              <input
                aria-invalid={draft.ticker !== '' && !tickerValid}
                id="launch-ticker"
                maxLength={10}
                onChange={(event) => update('ticker', event.target.value)}
                placeholder="WDOGE"
                value={draft.ticker}
              />
              {draft.ticker !== '' && !tickerValid ? (
                <p className="field-error">Tickers use 2–10 letters or digits.</p>
              ) : null}
            </div>
            <div className="field-stack">
              <label htmlFor="launch-standard">Token standard</label>
              <select
                id="launch-standard"
                onChange={(event) => update('standard', event.target.value as TokenStandard)}
                value={draft.standard}
              >
                <option value="token-2022">Solana Token-2022</option>
                <option value="spl-token">Solana SPL Token</option>
              </select>
            </div>
            <div className="field-stack">
              <label htmlFor="launch-handle">
                Creator .woke handle <span>Optional</span>
              </label>
              <input
                id="launch-handle"
                maxLength={40}
                onChange={(event) => update('creatorHandle', event.target.value)}
                placeholder="alexbtc420"
                value={draft.creatorHandle}
              />
              <p className="field-help">
                {handleSubdomain === null
                  ? 'Launches attribute to a verified .woke identity, never an anonymous deployer.'
                  : `Attributed to ${handleSubdomain.handle}.woke · project site: ${handleSubdomain.host}`}
              </p>
            </div>
            <div className="field-stack field-stack--full">
              <label htmlFor="launch-description">Description</label>
              <textarea
                id="launch-description"
                maxLength={500}
                onChange={(event) => update('description', event.target.value)}
                placeholder="What is this token, honestly?"
                rows={3}
                value={draft.description}
              />
            </div>
            <div className="field-stack">
              <label htmlFor="launch-reserves">Initial virtual SOL reserves</label>
              <input
                id="launch-reserves"
                inputMode="decimal"
                onChange={(event) => update('virtualSolReserves', event.target.value)}
                value={draft.virtualSolReserves}
              />
              <p className="field-help">Sets the curve’s starting price depth.</p>
            </div>
            <div className="field-stack">
              <label htmlFor="launch-graduation">Graduation threshold (SOL)</label>
              <input
                id="launch-graduation"
                inputMode="decimal"
                onChange={(event) => update('graduationSol', event.target.value)}
                value={draft.graduationSol}
              />
              <p className="field-help">Curve liquidity migrates to a public AMM at this mark.</p>
            </div>
          </div>

          <article className="preview-post" aria-label="Token card preview">
            <header>
              <span className="preview-post__avatar" aria-hidden="true">
                {(ticker || 'T').slice(0, 1)}
              </span>
              <div>
                <strong>
                  {draft.name.trim() || 'Unnamed token'}
                  {tickerValid ? ` · $${ticker}` : ''}
                </strong>
                <span>
                  {handleSubdomain === null
                    ? 'Creator identity not set'
                    : `by ${handleSubdomain.handle}.woke`}
                </span>
              </div>
            </header>
            <p className="preview-post__body">
              {draft.description.trim() || 'The token card shows exactly what you write here.'}
            </p>
            <dl>
              <div>
                <dt>Standard</dt>
                <dd>{draft.standard === 'token-2022' ? 'Token-2022' : 'SPL Token'}</dd>
              </div>
              <div>
                <dt>Curve</dt>
                <dd>{draft.virtualSolReserves || '—'} SOL virtual reserves</dd>
              </div>
              <div>
                <dt>Graduates at</dt>
                <dd>{draft.graduationSol || '—'} SOL</dd>
              </div>
              <div>
                <dt>Sentiment</dt>
                <dd>Awaiting verified signals</dd>
              </div>
            </dl>
          </article>

          <button
            aria-describedby="launch-gate-note"
            className="publication-action--primary"
            disabled
            type="button"
          >
            Launch token (gated — see what remains)
          </button>
          <p className="publication-panel__note" id="launch-gate-note">
            Launching enables only after every open gate passes. Solana rent and network fees will
            always be disclosed exactly before a signature; “no fee” will never mean hidden fees.
          </p>
        </form>
      </section>

      <section className="compose-section" aria-labelledby="launchpad-discovery-title">
        <div className="compose-section__heading">
          <span aria-hidden="true">03</span>
          <div>
            <h2 id="launchpad-discovery-title">Discovery and analysis</h2>
            <p>Trending by verified sentiment, analyzed by self-hosted models.</p>
          </div>
        </div>
        <StatePanel
          eyebrow="No tokens yet"
          headingLevel={3}
          title="The trending board is empty because nothing has launched."
          tone="empty"
        >
          <p>
            When launching goes live, this board ranks tokens by signed social activity from the
            open indexer — never by paid placement or fabricated volume. Woke Hermes analysis
            appears beside each token with sources and stated uncertainty.
          </p>
        </StatePanel>
      </section>

      <section className="compose-section" aria-labelledby="launchpad-agents-title">
        <div className="compose-section__heading">
          <span aria-hidden="true">04</span>
          <div>
            <h2 id="launchpad-agents-title">Built for AI agents</h2>
            <p>The same rails people use, exposed as a typed, noncustodial API.</p>
          </div>
        </div>
        <ul className="launchpad-agent-endpoints">
          {AGENT_ENDPOINTS.map((endpoint) => (
            <li key={endpoint.path}>
              <p>
                <StatusBadge tone="pending">Prepared</StatusBadge>{' '}
                <code className="inline-identifier">
                  {endpoint.method} {endpoint.path}
                </code>
              </p>
              <p>{endpoint.detail}</p>
            </li>
          ))}
        </ul>
        <p className="publication-panel__note">
          Agents get quotes, sentiment, and simulate-first transaction coordinates — and sign with
          their own keys. Paper trading ships before any real-money agent execution, which stays
          disabled until the automation gates pass.
        </p>
      </section>

      <section className="compose-section" aria-labelledby="launchpad-gates-title">
        <div className="compose-section__heading">
          <span aria-hidden="true">05</span>
          <div>
            <h2 id="launchpad-gates-title">What remains before launch day</h2>
            <p>Named gates, in order. None are marketing.</p>
          </div>
        </div>
        <ol className="publication-progress" aria-label="Open launchpad gates">
          {OPEN_GATES.map((gate) => (
            <li data-state="pending" key={gate}>
              {gate}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

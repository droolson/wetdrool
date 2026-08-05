'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import { getFounderStudio, proModeQuote, type CreatorStudioProfile } from '@/lib/creator-economy';
import { getDroolTokenConfig } from '@/lib/drool-token';
import { getE2eeCapabilityReport } from '@/lib/e2ee-status';

function placeholderProfile(handle: string): CreatorStudioProfile {
  const founder = getFounderStudio();
  return {
    handle,
    displayName: handle,
    pronouns: 'not set',
    bio: 'Creator surface awaiting signed profile + offerings.',
    tags: [],
    e2eeDms: true,
    jurisdictionNote: founder.jurisdictionNote,
    offerings: founder.offerings.map((o) => ({ ...o, status: 'staged' as const })),
  };
}

export function CreatorStudio({ handle }: { readonly handle?: string }) {
  const founderHandle = getFounderStudio().handle;
  const initial: CreatorStudioProfile = (() => {
    const founder = getFounderStudio();
    if (!handle || handle === founder.handle || handle === 'kingofqueens6ix') return founder;
    return placeholderProfile(handle);
  })();

  const [profile, setProfile] = useState<CreatorStudioProfile>(initial);
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const resolved = (handle ?? founderHandle).replace(/^@/, '');
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const { fetchCreator } = await import('@/lib/product-client');
      const result = await fetchCreator(resolved);
      if (cancelled) return;
      if (result.kind === 'ok' && result.data.profile) {
        setProfile(result.data.profile);
        setSource('api');
      } else {
        setProfile(
          resolved === founderHandle || resolved === 'kingofqueens6ix'
            ? getFounderStudio()
            : placeholderProfile(resolved),
        );
        setSource('local');
        setError(result.kind === 'error' ? result.message : 'Creator API unavailable.');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, founderHandle]);

  const token = getDroolTokenConfig();
  const e2ee = getE2eeCapabilityReport();
  const pro = proModeQuote();

  return (
    <div className="creator-studio">
      <header className="creator-studio__hero">
        <div>
          <p className="section-kicker">Creator · OnlyFans-class · decentralized</p>
          <h1>
            {profile.displayName}{' '}
            <span className="creator-studio__handle">@{profile.handle}</span>
          </h1>
          <p className="creator-studio__pronouns">{profile.pronouns}</p>
          <p>{profile.bio}</p>
          <ul className="creator-studio__tags">
            {profile.tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div className="creator-studio__badges">
          <StatusBadge tone={source === 'api' ? 'verified' : 'degraded'}>
            {loading ? 'loading' : source === 'api' ? 'api profile' : 'local profile'}
          </StatusBadge>
          <StatusBadge tone="pending">E2EE DMs {e2ee.pairwise}</StatusBadge>
          <StatusBadge tone={token.status === 'live' ? 'verified' : 'degraded'}>
            {token.symbol} {token.status}
          </StatusBadge>
          <StatusBadge tone="neutral">Swiss foundation planned</StatusBadge>
        </div>
      </header>

      {error ? (
        <p className="field-help" role="status">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="field-help" role="status">
          Loading creator profile…
        </p>
      ) : null}

      <section aria-labelledby="offerings-title">
        <h2 id="offerings-title">Offerings</h2>
        <ul className="offering-grid">
          {profile.offerings.map((o) => (
            <li key={o.id}>
              <article className="offering-card">
                <p className="section-kicker">{o.kind}</p>
                <h3>{o.title}</h3>
                <p className="offering-card__price">
                  ${o.priceUsd.toFixed(2)} · {o.pricePoints} pts
                  {o.acceptsDrool ? ` · ${token.symbol}` : ''}
                </p>
                <p>{o.detail}</p>
                <p className="field-help">
                  Delivery: {o.e2eeDelivery ? 'E2EE ciphertext on device' : 'public/live surface'} ·{' '}
                  {o.status}
                </p>
                <button type="button" disabled>
                  Checkout staged
                </button>
              </article>
            </li>
          ))}
        </ul>
      </section>

      <section className="creator-studio__pro" aria-labelledby="pro-title">
        <h2 id="pro-title">Pro mode · ${pro.monthlyUsd}/mo</h2>
        <ul>
          {pro.perks.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="field-help">
          {token.symbol} transfer tax target {token.transferTaxLabel} on{' '}
          <a href={token.revshareUrl} rel="noopener noreferrer">
            revshare.dev
          </a>
          . Mint: {token.status}. {token.robinhood.detail}
        </p>
      </section>

      <p className="field-help">{profile.jurisdictionNote}</p>
      <p>
        <Link href="/feeds">← Shorts</Link> · <Link href="/live">Live</Link> ·{' '}
        <Link href="/market">Market</Link> · profile API <code>/api/v1/creators/:handle</code>
      </p>
    </div>
  );
}

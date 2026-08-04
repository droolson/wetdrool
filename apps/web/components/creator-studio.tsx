'use client';

import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import { getFounderStudio, proModeQuote, type CreatorStudioProfile } from '@/lib/creator-economy';
import { getDroolTokenConfig } from '@/lib/drool-token';
import { getE2eeCapabilityReport } from '@/lib/e2ee-status';

export function CreatorStudio({ handle }: { readonly handle?: string }) {
  const founder = getFounderStudio();
  const profile: CreatorStudioProfile =
    !handle || handle === founder.handle || handle === 'kingofqueens6ix'
      ? founder
      : {
          handle,
          displayName: handle,
          pronouns: 'not set',
          bio: 'Creator surface awaiting signed profile + offerings.',
          tags: [],
          e2eeDms: true,
          jurisdictionNote: founder.jurisdictionNote,
          offerings: founder.offerings.map((o) => ({ ...o, status: 'staged' as const })),
        };

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
          <StatusBadge tone="pending">E2EE DMs {e2ee.pairwise}</StatusBadge>
          <StatusBadge tone={token.status === 'live' ? 'verified' : 'degraded'}>
            {token.symbol} {token.status}
          </StatusBadge>
          <StatusBadge tone="neutral">Swiss foundation planned</StatusBadge>
        </div>
      </header>

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
        <Link href="/token">Token</Link>
      </p>
    </div>
  );
}

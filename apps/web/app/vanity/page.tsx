import type { Metadata } from 'next';
import { ButtonLink, SectionHeading, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { vanityQuote, VANITY_MONTHLY_USD } from '@/lib/points';

export const metadata: Metadata = {
  title: 'Vanity · .drool',
  description: `Claim your name.drool vanity address for $${VANITY_MONTHLY_USD}/mo in SOL, USDC, or points.`,
};

export default function VanityPage() {
  const quote = vanityQuote();

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">${VANITY_MONTHLY_USD}/mo</StatusBadge>}
        eyebrow="Vanity addresses"
        title="you.drool — cute asf"
      >
        <p>
          Reserve a <strong>.drool</strong> handle. Pay monthly in SOL, USDC, or points. Points
          pricing still respects the global rule: points issued never exceed ad revenue.
        </p>
      </AppPageHeader>

      <section className="vanity-pricing">
        <SectionHeading eyebrow="Perks" title="What you unlock" />
        <ul>
          {quote.perks.map((perk) => (
            <li key={perk}>{perk}</li>
          ))}
        </ul>
        <dl className="price-table">
          <div>
            <dt>USD</dt>
            <dd>${quote.monthlyUsd.toFixed(2)} / mo</dd>
          </div>
          <div>
            <dt>USDC</dt>
            <dd>{quote.usdc.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Points (est.)</dt>
            <dd>{quote.pointsPrice.toLocaleString()} pts</dd>
          </div>
          <div>
            <dt>SOL</dt>
            <dd>{quote.solEstimate === null ? 'market rate at checkout' : quote.solEstimate.toFixed(4)}</dd>
          </div>
        </dl>
        <ButtonLink href="/signin">Sign in to claim</ButtonLink>
      </section>
    </div>
  );
}

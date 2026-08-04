import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { getDroolTokenConfig, transferTaxAmount } from '@/lib/drool-token';
import { proModeQuote } from '@/lib/creator-economy';

export const metadata: Metadata = {
  title: '$DROOL',
  description: '$DROOL tokenomics — RevShare 3% tax target, points gamification, mint-pending until CA is set.',
};

export default function TokenPage() {
  const token = getDroolTokenConfig();
  const pro = proModeQuote();
  const exampleTax = transferTaxAmount(100);

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={
          <StatusBadge tone={token.status === 'live' ? 'verified' : 'degraded'}>
            {token.status}
          </StatusBadge>
        }
        eyebrow="Economy"
        title={`${token.symbol} · points · Pro`}
      >
        <p>
          Reddit-like points fund engagement. {token.symbol} is the on-chain rail (mint not
          invented). Transfer tax target <strong>{token.transferTaxLabel}</strong> via{' '}
          <a href={token.revshareUrl} rel="noopener noreferrer">
            revshare.dev
          </a>
          .
        </p>
      </AppPageHeader>

      <section className="token-grid">
        <article className="token-card">
          <h2>{token.symbol}</h2>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{token.status}</dd>
            </div>
            <div>
              <dt>Mint</dt>
              <dd>{token.mint || '— set NEXT_PUBLIC_DROOL_MINT when live —'}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>
                {token.transferTaxBps} bps ({token.transferTaxLabel}) — e.g. 100 units → {exampleTax}{' '}
                tax units
              </dd>
            </div>
            <div>
              <dt>Robinhood</dt>
              <dd>{token.robinhood.detail}</dd>
            </div>
          </dl>
          <ul>
            {token.uses.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
          <ul className="token-card__not">
            {token.notClaims.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </article>

        <article className="token-card">
          <h2>Points</h2>
          <p>
            Local ledger on device. Issuance never exceeds ad-revenue point units for the period.
            Watch shorts, check in, post — when the pool is funded.
          </p>
          <p>
            <Link href="/feeds">Earn on shorts →</Link>
          </p>
        </article>

        <article className="token-card">
          <h2>Pro · ${pro.monthlyUsd}/mo</h2>
          <ul>
            {pro.perks.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="field-help">{pro.points} points equivalent at 100 pts/USD.</p>
        </article>
      </section>
    </div>
  );
}

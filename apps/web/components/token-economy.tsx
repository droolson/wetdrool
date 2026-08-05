'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import { getDroolTokenConfig, transferTaxAmount, type DroolTokenConfig } from '@/lib/drool-token';
import { proModeQuote } from '@/lib/creator-economy';
import { AppPageHeader } from '@/components/app-page-header';

type ProQuote = ReturnType<typeof proModeQuote>;

interface HonestFlags {
  readonly mintExists: boolean;
  readonly droolMintInvented: boolean;
  readonly earningClaimed: boolean;
  readonly pointsAreNotToken: boolean;
  readonly solIsNotDrool: boolean;
  readonly tradeExecutable: boolean;
}

export function TokenEconomy() {
  const localToken = getDroolTokenConfig();
  const localPro = proModeQuote();
  const [token, setToken] = useState<DroolTokenConfig>(localToken);
  const [pro, setPro] = useState<ProQuote>(localPro);
  const [exampleTax, setExampleTax] = useState(() => transferTaxAmount(100));
  const [honest, setHonest] = useState<HonestFlags | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchToken } = await import('@/lib/product-client');
      const result = await fetchToken();
      if (result.kind === 'ok' && result.data.token) {
        setToken(result.data.token);
        if (result.data.pro) setPro(result.data.pro as ProQuote);
        if (typeof result.data.exampleTaxOn100 === 'number') {
          setExampleTax(result.data.exampleTaxOn100);
        }
        if (result.data.honest) setHonest(result.data.honest);
        setNote(result.data.note ?? null);
        setSource('api');
      } else {
        setToken(getDroolTokenConfig());
        setPro(proModeQuote());
        setExampleTax(transferTaxAmount(100));
        setSource('local');
        setError(result.kind === 'error' ? result.message : 'Token API empty.');
        setNote('Local config fallback. Mint is not invented client-side.');
      }
    } catch {
      setSource('local');
      setError('Network error loading token config.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={
          <>
            <StatusBadge tone={token.status === 'live' ? 'verified' : 'degraded'}>
              {token.status}
            </StatusBadge>
            <StatusBadge tone={source === 'api' ? 'pending' : 'degraded'}>
              {loading ? 'loading' : source === 'api' ? 'api config' : 'local config'}
            </StatusBadge>
          </>
        }
        eyebrow="Economy"
        title={`${token.symbol} · points · Pro`}
      >
        <p>
          Reddit-like points fund engagement. {token.symbol} is a planned on-chain rail only when a
          verified mint is configured. Transfer tax target <strong>{token.transferTaxLabel}</strong>{' '}
          via{' '}
          <a href={token.revshareUrl} rel="noopener noreferrer">
            revshare.dev
          </a>
          . No earnings or MRR are claimed here.
        </p>
      </AppPageHeader>

      {loading ? (
        <p className="field-help" role="status">
          Loading economy config…
        </p>
      ) : null}
      {error ? (
        <p className="field-help" role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : null}
      {note ? <p className="field-help">{note}</p> : null}
      {honest ? (
        <ul className="field-help" aria-label="Honest economy flags">
          <li>mintExists: {String(honest.mintExists)}</li>
          <li>droolMintInvented: {String(honest.droolMintInvented)}</li>
          <li>earningClaimed: {String(honest.earningClaimed)}</li>
          <li>tradeExecutable: {String(honest.tradeExecutable)}</li>
          <li>pointsAreNotToken: {String(honest.pointsAreNotToken)}</li>
          <li>solIsNotDrool: {String(honest.solIsNotDrool)}</li>
        </ul>
      ) : null}

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
              <dd>{token.mint || '— not set (mint-pending; never invented) —'}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>
                {token.transferTaxBps} bps ({token.transferTaxLabel}) — e.g. 100 units → {exampleTax}{' '}
                tax units (config only)
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
            Watch shorts, check in, post — when the pool is funded. Points are not {token.symbol}.
          </p>
          <p>
            <Link href="/feeds">Earn on shorts →</Link> · <Link href="/fame">Hall of Fame →</Link>
          </p>
        </article>

        <article className="token-card">
          <h2>Pro · ${pro.monthlyUsd}/mo</h2>
          <ul>
            {pro.perks.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="field-help">{pro.points} points equivalent at 100 pts/USD (staged checkout).</p>
        </article>
      </section>

      <p className="field-help">
        Machine JSON: <Link href="/api/v1/token">/api/v1/token</Link> · launch surface stays preview
        only on <Link href="/launchpad">/launchpad</Link>.
      </p>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import {
  getDroolTokenConfig,
  getTokenHonestFlags,
  tokenEconomyNote,
  transferTaxAmount,
  type DroolTokenConfig,
  type TokenHonestFlags,
} from '@/lib/drool-token';
import { proModeQuote } from '@/lib/creator-economy';
import { AppPageHeader } from '@/components/app-page-header';

type ProQuote = ReturnType<typeof proModeQuote>;

export function TokenEconomy() {
  const localToken = getDroolTokenConfig();
  const localPro = proModeQuote();
  const [token, setToken] = useState<DroolTokenConfig>(localToken);
  const [pro, setPro] = useState<ProQuote>(localPro);
  const [exampleTax, setExampleTax] = useState(() => transferTaxAmount(100));
  const [honest, setHonest] = useState<TokenHonestFlags>(() => getTokenHonestFlags(localToken));
  const [note, setNote] = useState<string | null>(() => tokenEconomyNote(localToken));
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
        if (result.data.honest) {
          setHonest({
            mintExists: result.data.honest.mintExists === true,
            droolMintInvented: false,
            earningClaimed: false,
            pointsAreNotToken: true,
            solIsNotDrool: true,
            transferTaxConfigured: result.data.token.transferTaxBps === 300,
            tradeExecutable: false,
          });
        } else {
          setHonest(getTokenHonestFlags(result.data.token));
        }
        setNote(result.data.note ?? tokenEconomyNote(result.data.token));
        setSource('api');
      } else {
        const fallback = getDroolTokenConfig();
        setToken(fallback);
        setPro(proModeQuote());
        setExampleTax(transferTaxAmount(100));
        setHonest(getTokenHonestFlags(fallback));
        setNote(tokenEconomyNote(fallback));
        setSource('local');
        setError(result.kind === 'error' ? result.message : 'Token API empty.');
      }
    } catch {
      const fallback = getDroolTokenConfig();
      setToken(fallback);
      setHonest(getTokenHonestFlags(fallback));
      setNote(tokenEconomyNote(fallback));
      setSource('local');
      setError('Network error loading token config.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mintPending = !honest.mintExists;

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={
          <>
            <StatusBadge tone={token.status === 'live' ? 'verified' : 'degraded'}>
              {token.status}
            </StatusBadge>
            <StatusBadge tone={mintPending ? 'degraded' : 'verified'}>
              {mintPending ? 'mintExists: false' : 'mintExists: true'}
            </StatusBadge>
            <StatusBadge tone="degraded">earningClaimed: false</StatusBadge>
            <StatusBadge tone="pending">tradeExecutable: false</StatusBadge>
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

      <section className="token-honesty" aria-label="Mint and earnings honesty">
        <div className="token-honesty__badges" role="group" aria-label="Honest economy badges">
          <StatusBadge tone={mintPending ? 'degraded' : 'verified'}>
            {mintPending ? 'mint does not exist' : 'mint configured (env)'}
          </StatusBadge>
          <StatusBadge tone="degraded">mintExists: {String(honest.mintExists)}</StatusBadge>
          <StatusBadge tone="degraded">droolMintInvented: false</StatusBadge>
          <StatusBadge tone="degraded">earningClaimed: false</StatusBadge>
          <StatusBadge tone="pending">tradeExecutable: false</StatusBadge>
          <StatusBadge tone="verified">pointsAreNotToken: true</StatusBadge>
          <StatusBadge tone="verified">solIsNotDrool: true</StatusBadge>
        </div>
        <p className="field-help" role="status">
          Product rule: no $DROOL mint address is invented in-repo. Until a verified mint is pasted
          and reviewed, status stays mint-pending. Points are not {token.symbol}. SOL/lamports are
          never labeled {token.symbol}. Earnings and trade execution are not claimed.
        </p>
      </section>

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

      <section className="token-grid">
        <article className="token-card">
          <h2>{token.symbol}</h2>
          <div className="token-card__badges" aria-label={`${token.symbol} status badges`}>
            <StatusBadge tone={mintPending ? 'degraded' : 'verified'}>{token.status}</StatusBadge>
            <StatusBadge tone="degraded">earningClaimed: false</StatusBadge>
            {!token.mint ? (
              <StatusBadge tone="degraded">no CA · never invented</StatusBadge>
            ) : null}
          </div>
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
              <dt>mintExists</dt>
              <dd>{String(honest.mintExists)}</dd>
            </div>
            <div>
              <dt>earningClaimed</dt>
              <dd>false</dd>
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
          <StatusBadge tone="verified">points ≠ {token.symbol}</StatusBadge>
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
          <StatusBadge tone="pending">checkout staged · no earnings claim</StatusBadge>
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

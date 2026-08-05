'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ButtonLink, SectionHeading, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import {
  getVanityHonestFlags,
  getVanityRegistryStatus,
  vanityQuote,
  vanityRegistryNote,
  VANITY_MONTHLY_USD,
  type VanityHonestFlags,
  type VanityQuote,
} from '@/lib/points';
import type { VanityApiResponse } from '@/lib/product-client';

export function VanityRegistry() {
  const local = getVanityRegistryStatus();
  const [quote, setQuote] = useState<VanityQuote>(local.quote);
  const [honest, setHonest] = useState<VanityHonestFlags>(() => getVanityHonestFlags());
  const [note, setNote] = useState<string | null>(() => vanityRegistryNote());
  const [claimCount, setClaimCount] = useState(0);
  const [notClaims, setNotClaims] = useState<readonly string[]>(local.notClaims);
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchVanity } = await import('@/lib/product-client');
      const result = await fetchVanity();
      if (result.kind === 'ok' && result.data.ok) {
        applyApi(result.data);
        setSource('api');
      } else {
        applyLocal();
        setSource('local');
        setError(result.kind === 'error' ? result.message : 'Vanity API empty.');
      }
    } catch {
      applyLocal();
      setSource('local');
      setError('Network error loading vanity registry status.');
    } finally {
      setLoading(false);
    }

    function applyLocal() {
      const fallback = getVanityRegistryStatus();
      setQuote(fallback.quote);
      setHonest(getVanityHonestFlags());
      setNote(fallback.note);
      setClaimCount(0);
      setNotClaims(fallback.notClaims);
    }

    function applyApi(data: VanityApiResponse) {
      // Fail-closed: never trust API claimExecutable/registryLive true without product gate.
      setHonest({
        registryLive: false,
        claimExecutable: false,
        inventsOwnedNames: false,
        anonymousCandidateIsNotClaim: true,
        pointsDoNotClaim: true,
      });
      setQuote(
        data.quote
          ? {
              monthlyUsd: data.quote.monthlyUsd,
              solEstimate: data.quote.solEstimate ?? null,
              usdc: data.quote.usdc,
              pointsPrice: data.quote.pointsPrice,
              perks: data.quote.perks ?? vanityQuote().perks,
            }
          : vanityQuote(),
      );
      // Never invent owned names: product rule forces empty claimCount until registryLive.
      setClaimCount(0);
      setNotClaims(data.notClaims ?? getVanityRegistryStatus().notClaims);
      setNote(data.note ?? vanityRegistryNote());
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
            <StatusBadge tone="degraded">registryLive: false</StatusBadge>
            <StatusBadge tone="pending">claimExecutable: false</StatusBadge>
            <StatusBadge tone="pending">${VANITY_MONTHLY_USD}/mo intent</StatusBadge>
            <StatusBadge tone={source === 'api' ? 'pending' : 'degraded'}>
              {loading ? 'loading' : source === 'api' ? 'api status' : 'local status'}
            </StatusBadge>
          </>
        }
        eyebrow="Vanity addresses"
        title="you.drool — not claimable yet"
      >
        <p>
          Reserve a <strong>.drool</strong> handle is product intent. The vanity registry is{' '}
          <strong>not live</strong>, claim checkout is <strong>not executable</strong>, and this
          surface never invents owned names. Anonymous passkey candidates from identity flows are
          not paid vanity claims.
        </p>
      </AppPageHeader>

      <section className="token-honesty" aria-label="Vanity registry honesty">
        <div className="token-honesty__badges" role="group" aria-label="Honest vanity badges">
          <StatusBadge tone="degraded">registryLive: {String(honest.registryLive)}</StatusBadge>
          <StatusBadge tone="pending">claimExecutable: {String(honest.claimExecutable)}</StatusBadge>
          <StatusBadge tone="verified">inventsOwnedNames: false</StatusBadge>
          <StatusBadge tone="verified">claims: {claimCount}</StatusBadge>
          <StatusBadge tone="verified">anonymousCandidateIsNotClaim: true</StatusBadge>
          <StatusBadge tone="verified">pointsDoNotClaim: true</StatusBadge>
        </div>
        <p className="field-help" role="status">
          Product rule: no fake vanity registry. Until handle claims anchor through DroolNet and a
          verified projection exists, this API returns an empty claims list and refuses claim
          execution.
        </p>
      </section>

      {loading ? (
        <p className="field-help" role="status">
          Loading vanity registry status…
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

      <section className="vanity-pricing">
        <SectionHeading eyebrow="Perks (intent)" title="What a live registry would unlock" />
        <ul>
          {quote.perks.map((perk) => (
            <li key={perk}>{perk}</li>
          ))}
        </ul>
        <dl className="price-table">
          <div>
            <dt>USD</dt>
            <dd>${quote.monthlyUsd.toFixed(2)} / mo (intent)</dd>
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
            <dd>
              {quote.solEstimate === null ? 'market rate at checkout (not live)' : quote.solEstimate.toFixed(4)}
            </dd>
          </div>
        </dl>
        <p className="field-help">
          Pricing is shown for product planning only. <code>claimExecutable: false</code> — the
          claim button is disabled until a verified registry and settlement path ship.
        </p>
        <p>
          <ButtonLink href="/signin">Sign in for identity</ButtonLink>
          {' · '}
          <Link href="/onboarding">Onboarding</Link>
          {' · '}
          <Link href="/token">Economy honesty</Link>
        </p>
        <p className="field-help">
          Sign-in establishes passkey identity surfaces only; it does not claim a vanity name.
        </p>
      </section>

      <section className="token-honesty" aria-label="Not claimed">
        <SectionHeading eyebrow="Not claimed" title="What this page does not assert" />
        <ul>
          {notClaims.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

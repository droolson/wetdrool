'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import { AgeGatePanel } from '@/components/age-gate-panel';
import { sealBytes, sealText, openText, openEnvelope } from '@/lib/e2ee-seal';
import {
  describePaymentFailureReason,
  encodePaymentHeader,
  isValidSolanaAddress,
  isValidTxSignature,
  solFromLamports,
  type UnlockReceipt,
  type X402PaymentRequirements,
} from '@/lib/x402';
import type {
  MarketListingDto,
  MarketUnlockAttempt,
  MarketUnlockReceiptDto,
} from '@/lib/product-client';

type PublicListing = MarketListingDto;

const PAGE_SIZE = 12;

interface StoreMeta {
  readonly kind: 'memory-ephemeral' | 'file-local';
  readonly durableAcrossRestart?: boolean;
  readonly multiReplicaSafe?: boolean;
  readonly revenueReady?: false;
  readonly gate?: 'env-stable' | 'ephemeral';
  readonly label?: string;
  readonly note?: string;
}

interface PaymentMeta {
  readonly rpcConfigured: boolean;
  readonly network: string;
  readonly note?: string;
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function receiptTone(v: UnlockReceipt['verification'] | MarketUnlockReceiptDto['verification']): {
  label: string;
  tone: 'verified' | 'pending' | 'degraded';
} {
  switch (v) {
    case 'rpc_verified':
      return { label: 'RPC verified', tone: 'verified' };
    case 'prior_purchase':
      return { label: 'Prior purchase (this host)', tone: 'pending' };
    case 'dev_accept':
      return { label: 'Dev accept only', tone: 'degraded' };
    default:
      return { label: 'Unknown', tone: 'degraded' };
  }
}


function UnlockAttemptHistory({
  log,
  listingId,
}: {
  readonly log: readonly MarketUnlockAttempt[];
  readonly listingId: string | null;
}) {
  const forListing = listingId
    ? log.filter((a) => a.listingId === listingId)
    : [];
  const recent = log.slice(0, 8);
  if (recent.length === 0) {
    return (
      <div className="market__attempts" role="status">
        <h3 className="market__attempts-title">Unlock attempts (this browser)</h3>
        <p className="field-help">
          No attempts yet. Failures and successes are logged locally (listing id, time, status) —
          never secrets or full payment payloads. Host store remains replica-unsafe.
        </p>
      </div>
    );
  }
  return (
    <div className="market__attempts" role="region" aria-label="Unlock attempt history">
      <h3 className="market__attempts-title">Unlock attempts (this browser)</h3>
      <p className="field-help">
        Local-only log (localStorage). Success here does not prove multi-replica settlement.
        {listingId && forListing.length > 0
          ? ` Showing ${forListing.length} for this listing; ${recent.length} recent overall.`
          : null}
      </p>
      <ul className="market__attempt-list">
        {(listingId && forListing.length > 0 ? forListing : recent).slice(0, 12).map((a) => (
          <li key={a.id}>
            <StatusBadge tone={a.status === 'success' ? 'verified' : 'degraded'}>
              {a.status}
            </StatusBadge>{' '}
            <code>{a.listingId}</code> ·{' '}
            <time dateTime={a.at}>{a.at}</time>
            {a.reason ? (
              <>
                {' '}
                · <code>{a.reason}</code>
              </>
            ) : null}
            {a.verification ? <> · {a.verification}</> : null}
            {a.signatureHint ? (
              <>
                {' '}
                · sig <code>{a.signatureHint}</code>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Marketplace() {
  const [listings, setListings] = useState<readonly PublicListing[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [paymentMeta, setPaymentMeta] = useState<PaymentMeta | null>(null);
  const [storeMeta, setStoreMeta] = useState<StoreMeta | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [filterNote, setFilterNote] = useState<string | null>(null);

  // sell form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [payTo, setPayTo] = useState('');
  const [priceSol, setPriceSol] = useState('0.01');
  const [unlockSecret, setUnlockSecret] = useState('');
  const [textBody, setTextBody] = useState('');

  // unlock
  const [activeId, setActiveId] = useState<string | null>(null);
  const [accepts, setAccepts] = useState<X402PaymentRequirements | null>(null);
  const [txSig, setTxSig] = useState('');
  const [unlocked, setUnlocked] = useState<{
    text?: string;
    mediaUrl?: string;
    contentType?: string;
  } | null>(null);
  const [unlockReceipt, setUnlockReceipt] = useState<MarketUnlockReceiptDto | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [unlockStep, setUnlockStep] = useState<'idle' | 'payment_required' | 'claiming' | 'done'>(
    'idle',
  );
  const [attemptLog, setAttemptLog] = useState<readonly MarketUnlockAttempt[]>([]);

  const applyPage = useCallback(
    (
      data: {
        listings?: readonly PublicListing[];
        total?: number;
        hasMore?: boolean;
        nextOffset?: number | null;
        offset?: number;
        count?: number;
        paymentVerify?: PaymentMeta | null;
        store?: StoreMeta | null;
        filter?: { readonly note?: string | null };
      },
      mode: 'replace' | 'append',
    ) => {
      const page = data.listings ?? [];
      setListings((prev) => (mode === 'append' ? [...prev, ...page] : page));
      setTotal(data.total ?? page.length);
      setHasMore(Boolean(data.hasMore));
      if (data.nextOffset !== undefined) {
        setNextOffset(data.nextOffset);
      } else if (data.hasMore) {
        const base = data.offset ?? 0;
        setNextOffset(base + (data.count ?? page.length));
      } else {
        setNextOffset(null);
      }
      if (data.paymentVerify) setPaymentMeta(data.paymentVerify);
      if (data.store) setStoreMeta(data.store);
      if (data.filter?.note !== undefined) setFilterNote(data.filter.note ?? null);
    },
    [],
  );

  const refresh = useCallback(async (qOverride?: string) => {
    setLoading(true);
    setListError(null);
    const q = (qOverride !== undefined ? qOverride : activeQuery).trim();
    try {
      const { fetchMarket } = await import('@/lib/product-client');
      const result = await fetchMarket({
        limit: PAGE_SIZE,
        offset: 0,
        q: q || null,
      });
      if (result.kind !== 'ok') {
        setListError(result.message);
        setListings([]);
        setHasMore(false);
        setNextOffset(null);
        return;
      }
      applyPage(result.data, 'replace');
    } catch {
      setListError('Network error loading market.');
      setListings([]);
      setHasMore(false);
      setNextOffset(null);
    } finally {
      setLoading(false);
    }
  }, [activeQuery, applyPage]);

  const loadMore = useCallback(async () => {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    setListError(null);
    try {
      const { fetchMarket } = await import('@/lib/product-client');
      const result = await fetchMarket({
        limit: PAGE_SIZE,
        offset: nextOffset,
        q: activeQuery.trim() || null,
      });
      if (result.kind !== 'ok') {
        setListError(result.message);
        return;
      }
      applyPage(result.data, 'append');
    } catch {
      setListError('Network error loading more listings.');
    } finally {
      setLoadingMore(false);
    }
  }, [activeQuery, applyPage, loadingMore, nextOffset]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { readUnlockAttemptLog } = await import('@/lib/product-client');
      if (!cancelled) setAttemptLog(readUnlockAttemptLog());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sell = async (file?: File | null) => {
    setBusy(true);
    setStatus(null);
    try {
      if (!isValidSolanaAddress(payTo)) {
        setStatus('Invalid Solana payTo address.');
        return;
      }
      if (unlockSecret.length < 8) {
        setStatus('Unlock secret must be ≥ 8 characters (buyer receives it after verified pay).');
        return;
      }
      let envelope;
      if (file) {
        const buf = new Uint8Array(await file.arrayBuffer());
        if (buf.length > 4_000_000) {
          setStatus('Max 4MB media.');
          return;
        }
        envelope = await sealBytes(
          'listing-temp',
          unlockSecret,
          buf,
          file.type || 'application/octet-stream',
          'media-passthrough',
        );
      } else if (textBody.trim()) {
        envelope = await sealText('listing-temp', unlockSecret, textBody.trim());
      } else {
        setStatus('Add text or a media file.');
        return;
      }

      const res = await fetch('/api/v1/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || 'Untitled drop',
          description,
          seller: 'seller',
          payTo,
          priceSol: Number(priceSol),
          unlockSecret,
          envelope,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: { message?: string; code?: string };
        listing?: PublicListing;
      };
      if (!res.ok) {
        setStatus(body.error?.message || 'List failed');
        return;
      }
      setStatus(`Listed ${body.listing?.id}. Save your unlock secret offline — buyers get it after pay.`);
      setTitle('');
      setDescription('');
      setTextBody('');
      await refresh();
    } catch {
      setStatus('List failed.');
    } finally {
      setBusy(false);
    }
  };

  const openListing = async (id: string) => {
    setActiveId(id);
    setUnlocked(null);
    setUnlockReceipt(null);
    setTxSig('');
    setAccepts(null);
    setStatus(null);
    setFailReason(null);
    setUnlockStep('idle');
    const res = await fetch(`/api/v1/market/${id}`, { cache: 'no-store' });
    const body = (await res.json()) as {
      accepts?: X402PaymentRequirements[];
      listing?: PublicListing;
      error?: { message?: string; code?: string; reason?: string };
      unlockHints?: { payTo?: string; lamports?: string };
    };
    if (res.status === 402) {
      setAccepts(body.accepts?.[0] ?? null);
      setUnlockStep('payment_required');
      setFailReason(null);
      setStatus(
        body.error?.message ||
          describePaymentFailureReason('payment_required'),
      );
      return;
    }
    setStatus(body.error?.message || `Unexpected ${res.status}`);
  };

  const claimWithPayment = async () => {
    if (!activeId || !txSig.trim()) return;
    setBusy(true);
    setStatus(null);
    setFailReason(null);
    setUnlockStep('claiming');
    try {
      if (!isValidTxSignature(txSig.trim())) {
        setFailReason('invalid_signature');
        setStatus(describePaymentFailureReason('invalid_signature'));
        setUnlockStep('payment_required');
        const { recordUnlockAttempt, signatureHintFromTx } = await import('@/lib/product-client');
        setAttemptLog(
          recordUnlockAttempt({
            listingId: activeId,
            status: 'fail',
            reason: 'invalid_signature',
            signatureHint: signatureHintFromTx(txSig),
          }),
        );
        return;
      }
      const payment = {
        x402Version: 1 as const,
        scheme: 'exact' as const,
        network: (accepts?.network || 'solana:devnet') as 'solana:devnet' | 'solana:mainnet',
        payload: { signature: txSig.trim() },
      };
      const res = await fetch(`/api/v1/market/${activeId}`, {
        headers: {
          Accept: 'application/json',
          'X-PAYMENT': encodePaymentHeader(payment),
        },
        cache: 'no-store',
      });
      const body = (await res.json()) as {
        ok?: boolean;
        envelope?: Parameters<typeof openText>[1];
        unlockSecret?: string;
        error?: { message?: string; reason?: string; code?: string; reasonDetail?: string };
        devAccepted?: boolean;
        receipt?: MarketUnlockReceiptDto;
      };
      if (!res.ok || !body.ok || !body.envelope || !body.unlockSecret) {
        setUnlockStep('payment_required');
        const reason = body.error?.reason || 'payment_unverified';
        setFailReason(reason);
        setStatus(
          body.error?.reasonDetail ||
            body.error?.message ||
            describePaymentFailureReason(reason),
        );
        const { recordUnlockAttempt, signatureHintFromTx } = await import('@/lib/product-client');
        setAttemptLog(
          recordUnlockAttempt({
            listingId: activeId,
            status: 'fail',
            reason,
            signatureHint: signatureHintFromTx(txSig),
          }),
        );
        return;
      }
      const env = body.envelope;
      const secret = body.unlockSecret;
      if (env.contentType.startsWith('text/')) {
        const text = await openText(secret, env);
        setUnlocked({ text, contentType: env.contentType });
      } else {
        const { bytes, contentType } = await openEnvelope(secret, env);
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const url = URL.createObjectURL(new Blob([copy], { type: contentType }));
        setUnlocked({ mediaUrl: url, contentType });
      }
      setUnlockReceipt(body.receipt ?? null);
      setUnlockStep('done');
      {
        const { recordUnlockAttempt, signatureHintFromTx } = await import('@/lib/product-client');
        setAttemptLog(
          recordUnlockAttempt({
            listingId: activeId,
            status: 'success',
            ...(body.receipt?.verification
              ? { verification: body.receipt.verification }
              : body.devAccepted
                ? { verification: 'dev_accept' as const }
                : {}),
            signatureHint: signatureHintFromTx(txSig),
          }),
        );
      }
      if (body.receipt) {
        const tone = receiptTone(body.receipt.verification);
        setStatus(
          `${tone.label}. ${body.receipt.note} settlementAuthoritative=${String(body.receipt.settlementAuthoritative)}.`,
        );
      } else {
        setStatus(
          body.devAccepted
            ? 'Unlocked (dev accept — configure RPC for real verify). Not settlement-authoritative.'
            : 'Unlocked after verified payment. Host-local receipt only.',
        );
      }
    } catch {
      setUnlockStep('payment_required');
      setStatus('Claim failed (network or decrypt error).');
      if (activeId) {
        const { recordUnlockAttempt, signatureHintFromTx } = await import('@/lib/product-client');
        setAttemptLog(
          recordUnlockAttempt({
            listingId: activeId,
            status: 'fail',
            reason: 'client_error',
            signatureHint: signatureHintFromTx(txSig),
          }),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const flashCopy = (label: string) => {
    setCopyFlash(label);
    window.setTimeout(() => setCopyFlash(null), 2000);
  };

  const copyPayTo = async () => {
    if (!accepts?.payTo) return;
    try {
      await navigator.clipboard.writeText(accepts.payTo);
      flashCopy('payTo');
      setStatus(`payTo copied: ${accepts.payTo}`);
    } catch {
      setStatus('Could not copy payTo — select the address manually.');
    }
  };

  const copyAmountLamports = async () => {
    if (!accepts?.maxAmountRequired) return;
    try {
      await navigator.clipboard.writeText(accepts.maxAmountRequired);
      flashCopy('lamports');
      setStatus(`Amount copied: ${accepts.maxAmountRequired} lamports.`);
    } catch {
      setStatus('Could not copy amount.');
    }
  };

  const copyPayLine = async () => {
    if (!accepts) return;
    const line = `${solFromLamports(accepts.maxAmountRequired)} SOL → ${accepts.payTo} (${accepts.network})`;
    try {
      await navigator.clipboard.writeText(line);
      flashCopy('pay line');
      setStatus('Payment line copied (amount, payTo, network).');
    } catch {
      setStatus('Could not copy payment line.');
    }
  };

  const copyTxSig = async () => {
    if (!txSig.trim()) return;
    try {
      await navigator.clipboard.writeText(txSig.trim());
      flashCopy('signature');
    } catch {
      setStatus('Could not copy signature.');
    }
  };

  const rpcReady = paymentMeta?.rpcConfigured === true;
  const storeLabel =
    storeMeta?.kind === 'file-local'
      ? storeMeta.gate === 'env-stable'
        ? 'file store · gate stable'
        : 'file store · gate ephemeral'
      : 'memory store';

  const shown = listings.length;

  return (
    <AgeGatePanel
      kicker="Marketplace · 18+"
      title="E2EE market · adults only"
      confirmLabel="I am 18+ · enter market"
      help={
        <p>
          Paid adult drops use Solana x402 unlocks. No government ID. See{' '}
          <Link href="/settings/privacy">privacy / age policy</Link>.
        </p>
      }
    >
      <div className="market">
        <header className="market__header">
          <div>
            <p className="section-kicker">E2EE marketplace · x402 Solana</p>
            <h1>Sell sealed drops. Pay with SOL.</h1>
          </div>
          <div className="market__badges">
            <StatusBadge tone={rpcReady ? 'verified' : 'pending'}>
              {rpcReady ? 'RPC verify on' : 'HTTP 402 · RPC unset'}
            </StatusBadge>
            <StatusBadge tone={storeMeta?.kind === 'file-local' ? 'pending' : 'degraded'}>
              {storeMeta?.label ?? storeLabel}
            </StatusBadge>
            <StatusBadge tone="degraded">replica-unsafe</StatusBadge>
            <StatusBadge tone="degraded">not revenue-ready</StatusBadge>
          </div>
        </header>
        <p className="market__lede">
          List content sealed client-side (middle-out + AES). Buyers hit{' '}
          <strong>402 Payment Required</strong>, pay your Solana address, then unlock with the tx
          signature. Host never holds plaintext. Unlock receipts are host-local and{' '}
          <strong>settlementAuthoritative: false</strong>.
          {!rpcReady ? (
            <>
              {' '}
              <strong>Payment verification is fail-closed</strong> until{' '}
              <code>WETDROOL_SOLANA_RPC_URL</code> / <code>SOLANA_RPC_URL</code> /{' '}
              <code>NEXT_PUBLIC_SOLANA_RPC_URL</code> is set on the server — unpaid or unverified
              signatures will not unlock.
            </>
          ) : null}
        </p>
        {storeMeta?.note ? <p className="field-help">{storeMeta.note}</p> : null}

        <section className="market__sell card-panel">
          <h2>List a drop</h2>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </label>
          <label>
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </label>
          <label>
            Pay to (Solana address)
            <input
              value={payTo}
              onChange={(e) => setPayTo(e.target.value)}
              placeholder="Base58 recipient"
              spellCheck={false}
            />
          </label>
          <label>
            Price (SOL)
            <input value={priceSol} onChange={(e) => setPriceSol(e.target.value)} />
          </label>
          <label>
            Unlock secret (≥8 chars — buyer gets this after verified pay)
            <input
              type="password"
              value={unlockSecret}
              onChange={(e) => setUnlockSecret(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Text body (or use file)
            <textarea value={textBody} onChange={(e) => setTextBody(e.target.value)} rows={3} />
          </label>
          <div className="market__actions">
            <button type="button" disabled={busy} onClick={() => void sell(null)}>
              Seal &amp; list text
            </button>
            <label className="market__file">
              List img / GIF / video
              <input
                type="file"
                accept="image/*,video/*,.gif"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void sell(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </section>

        <section className="market__list" aria-labelledby="market-listings-heading">
          <div className="market__list-head">
            <h2 id="market-listings-heading">
              Listings {total > 0 ? `(${shown} of ${total})` : ''}
            </h2>
            <button type="button" onClick={() => void refresh()} disabled={loading || busy}>
              Refresh
            </button>
          </div>
          <form
            className="market__search"
            onSubmit={(e) => {
              e.preventDefault();
              const next = searchInput.trim().slice(0, 80);
              setActiveQuery(next);
              void refresh(next);
            }}
          >
            <label htmlFor="market-search-q">
              Filter listings
              <input
                id="market-search-q"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Title, seller, id…"
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button type="submit" disabled={loading || busy}>
              Search
            </button>
            {activeQuery ? (
              <button
                type="button"
                disabled={loading || busy}
                onClick={() => {
                  setSearchInput('');
                  setActiveQuery('');
                  void refresh('');
                }}
              >
                Clear
              </button>
            ) : null}
          </form>
          {filterNote && activeQuery ? <p className="field-help">{filterNote}</p> : null}
          {loading ? (
            <p className="field-help" role="status">
              Loading catalog…
            </p>
          ) : null}
          {listError ? (
            <p className="field-help" role="alert">
              {listError}{' '}
              <button type="button" onClick={() => void refresh()}>
                Retry
              </button>
            </p>
          ) : null}
          {!loading && listings.length === 0 && !listError ? (
            <div className="market__empty card-panel" role="status">
              <p>
                <strong>
                  {activeQuery
                    ? `No listings match “${activeQuery}” on this node.`
                    : 'No sealed drops yet.'}
                </strong>
              </p>
              <p className="field-help">
                {activeQuery
                  ? 'Filter is a local substring over this host’s store — not a global search index.'
                  : `List a text or media drop above. Buyers will see HTTP 402 terms with your payTo address. Catalog is ${storeMeta?.kind === 'file-local' ? 'file-backed on this node' : 'in-process memory'} — not multi-replica commerce.`}
              </p>
            </div>
          ) : null}
          <ul aria-busy={loading || loadingMore}>
            {listings.map((l) => (
              <li key={l.id}>
                <article className="market-card">
                  <h3>{l.title}</h3>
                  <p>{l.description || '—'}</p>
                  <p className="market-card__meta">
                    {solFromLamports(l.lamports)} SOL · {l.network} · {l.contentType}
                  </p>
                  <p className="market-card__meta">
                    payTo <code title={l.payTo}>{shortAddr(l.payTo)}</code>
                  </p>
                  <button type="button" onClick={() => void openListing(l.id)}>
                    Open / buy
                  </button>
                </article>
              </li>
            ))}
          </ul>
          {hasMore && nextOffset !== null ? (
            <div className="market__actions">
              <button type="button" disabled={loadingMore || loading} onClick={() => void loadMore()}>
                {loadingMore ? 'Loading…' : `Load more (offset ${nextOffset})`}
              </button>
            </div>
          ) : null}
          {!loading && listings.length > 0 && !hasMore && total > PAGE_SIZE ? (
            <p className="field-help" role="status">
              End of catalog · {total} listing{total === 1 ? '' : 's'}.
            </p>
          ) : null}
        </section>

        {activeId ? (
          <section className="market__buy card-panel" aria-labelledby="unlock-title">
            <h2 id="unlock-title">Unlock {activeId}</h2>
            <ol className="market__steps">
              <li data-done={unlockStep !== 'idle' ? 'true' : 'false'}>Open listing → 402 terms</li>
              <li data-done={unlockStep === 'claiming' || unlockStep === 'done' ? 'true' : 'false'}>
                Pay exact SOL to payTo (copy address)
              </li>
              <li data-done={unlockStep === 'done' ? 'true' : 'false'}>
                Paste tx signature → server verifies → decrypt on device
              </li>
            </ol>
            {accepts ? (
              <>
                <p>
                  Pay <strong>{solFromLamports(accepts.maxAmountRequired)} SOL</strong> (
                  <code>{accepts.maxAmountRequired}</code> lamports) to{' '}
                  <code className="market__payto">{accepts.payTo}</code>
                </p>
                <div className="market__actions" role="group" aria-label="Copy payment details">
                  <button type="button" onClick={() => void copyPayTo()}>
                    {copyFlash === 'payTo' ? 'Copied payTo' : 'Copy payTo'}
                  </button>
                  <button type="button" onClick={() => void copyAmountLamports()}>
                    {copyFlash === 'lamports' ? 'Copied amount' : 'Copy lamports'}
                  </button>
                  <button type="button" onClick={() => void copyPayLine()}>
                    {copyFlash === 'pay line' ? 'Copied line' : 'Copy pay line'}
                  </button>
                </div>
                <p className="field-help">
                  Network: {accepts.network}. Unverified payments never unlock (fail-closed
                  {!rpcReady ? ' — RPC not configured' : ''}).
                </p>
                {failReason ? (
                  <p className="field-help" role="alert">
                    <strong>Fail-closed reason:</strong> <code>{failReason}</code> —{' '}
                    {describePaymentFailureReason(failReason)}
                  </p>
                ) : null}
                <label>
                  Solana tx signature
                  <input
                    value={txSig}
                    onChange={(e) => setTxSig(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={failReason === 'invalid_signature' ? true : undefined}
                  />
                </label>
                <div className="market__actions">
                  <button type="button" disabled={busy} onClick={() => void claimWithPayment()}>
                    {busy && unlockStep === 'claiming' ? 'Verifying…' : 'Verify payment & unlock'}
                  </button>
                  {txSig.trim() ? (
                    <button type="button" onClick={() => void copyTxSig()}>
                      {copyFlash === 'signature' ? 'Copied sig' : 'Copy signature'}
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="field-help">Select a listing to load payment requirements.</p>
            )}
            {unlockReceipt ? (
              <div className="market__receipt" role="status">
                <p>
                  <StatusBadge tone={receiptTone(unlockReceipt.verification).tone}>
                    {receiptTone(unlockReceipt.verification).label}
                  </StatusBadge>{' '}
                  <span className="field-help">settlementAuthoritative: false</span>
                </p>
                <ul className="field-help">
                  <li>
                    sig <code>{shortAddr(unlockReceipt.signature)}</code>
                  </li>
                  <li>
                    payTo <code>{shortAddr(unlockReceipt.payTo)}</code> · {unlockReceipt.lamports}{' '}
                    lamports · {unlockReceipt.network}
                  </li>
                  <li>verifiedAt {unlockReceipt.verifiedAt}</li>
                  {unlockReceipt.slot !== undefined ? <li>slot {unlockReceipt.slot}</li> : null}
                  <li>{unlockReceipt.note}</li>
                </ul>
              </div>
            ) : null}
            <UnlockAttemptHistory log={attemptLog} listingId={activeId} />
            {unlocked?.text ? <pre className="market__plain">{unlocked.text}</pre> : null}
            {unlocked?.mediaUrl && unlocked.contentType?.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={unlocked.mediaUrl} alt="" className="market__media" />
            ) : null}
            {unlocked?.mediaUrl && unlocked.contentType?.startsWith('video/') ? (
              <video src={unlocked.mediaUrl} controls className="market__media" />
            ) : null}
          </section>
        ) : null}

        {status ? (
          <p className="market__status" role="status">
            {status}
          </p>
        ) : null}

        <p className="field-help">
          RPC: <code>WETDROOL_SOLANA_RPC_URL</code>. Local durable store:{' '}
          <code>WETDROOL_MARKETPLACE_DATA_PATH</code> + <code>WETDROOL_MARKETPLACE_GATE_SECRET</code>{' '}
          (≥16). Dev without RPC: <code>WETDROOL_X402_DEV_ACCEPT=1</code> (non-production only).{' '}
          Never claim revenue readiness without durable multi-replica proof.{' '}
          <Link href="/rooms/lobby">Free E2EE rooms</Link>
        </p>
      </div>
    </AgeGatePanel>
  );
}

'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
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
  MarketSortMode,
  MarketUnlockAttempt,
  MarketUnlockReceiptDto,
} from '@/lib/product-client';

type PublicListing = MarketListingDto;

const PAGE_SIZE = 12;

const MARKET_SORTS: readonly { id: MarketSortMode; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'price_asc', label: 'Price ↑' },
  { id: 'price_desc', label: 'Price ↓' },
];

/** Matches server marketSortLabel without pulling node:fs store into the client. */
function activeMarketSortLabel(sort: MarketSortMode): string {
  switch (sort) {
    case 'price_asc':
      return 'Price ↑ (lamports)';
    case 'price_desc':
      return 'Price ↓ (lamports)';
    case 'newest':
    default:
      return 'Newest';
  }
}

interface StoreMeta {
  readonly kind: 'memory-ephemeral' | 'file-local';
  readonly durableAcrossRestart?: boolean;
  /** API always sends false; null store still treated as unsafe in UI. */
  readonly multiReplicaSafe: false;
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
  onClear,
}: {
  readonly log: readonly MarketUnlockAttempt[];
  readonly listingId: string | null;
  readonly onClear: () => void;
}) {
  const forListing = listingId
    ? log.filter((a) => a.listingId === listingId)
    : [];
  const filteredActive = Boolean(listingId && forListing.length > 0);
  const visible = (filteredActive ? forListing : log).slice(0, 12);
  const totalCount = log.length;
  const shownCount = visible.length;
  const listingCount = listingId ? forListing.length : 0;

  const downloadJson = () => {
    void (async () => {
      const { exportUnlockAttemptsJson } = await import('@/lib/product-client');
      const body = exportUnlockAttemptsJson(log);
      const blob = new Blob([body], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wetdrool-market-unlock-attempts-${new Date().toISOString().slice(0, 10)}.json`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    })();
  };

  if (totalCount === 0) {
    return (
      <div className="market__attempts" role="status" aria-label="Unlock attempt history empty">
        <h3 className="market__attempts-title">
          Unlock attempts (this browser){' '}
          <span className="market__attempt-count" aria-label="0 unlock attempts logged">
            0
          </span>
        </h3>
        <p className="field-help">
          No attempts yet. Failures and successes are logged locally (listing id, time, status) —
          never secrets or full payment payloads. Host store remains replica-unsafe.
        </p>
      </div>
    );
  }

  return (
    <div
      className="market__attempts"
      role="region"
      aria-label={`Unlock attempt history, ${totalCount} total`}
    >
      <h3 className="market__attempts-title">
        Unlock attempts (this browser){' '}
        <span
          className="market__attempt-count"
          aria-label={`${totalCount} unlock attempt${totalCount === 1 ? '' : 's'} logged`}
        >
          {totalCount}
        </span>
        {filteredActive ? (
          <span
            className="market__attempt-count market__attempt-count--listing"
            aria-label={`${listingCount} attempt${listingCount === 1 ? '' : 's'} for active listing`}
          >
            {listingCount} this listing
          </span>
        ) : null}
      </h3>
      <p className="field-help" id="market-unlock-attempts-help">
        Local-only log (localStorage). Success here does not prove multi-replica settlement.
        {filteredActive
          ? ` Showing ${shownCount} of ${listingCount} for this listing (${totalCount} overall).`
          : ` Showing ${shownCount} most recent of ${totalCount}.`}
      </p>
      <div className="market__attempt-toolbar" role="group" aria-label="Unlock attempt log actions">
        <button
          type="button"
          className="button-secondary"
          onClick={downloadJson}
          aria-label="Export unlock attempt log as JSON"
        >
          Export JSON
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={onClear}
          aria-label="Clear unlock attempt history from this browser"
        >
          Clear history
        </button>
      </div>
      <ul
        className="market__attempt-list"
        aria-describedby="market-unlock-attempts-help"
        aria-label={
          filteredActive
            ? `Unlock attempts for listing ${listingId}`
            : 'Recent unlock attempts'
        }
      >
        {visible.map((a) => (
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
  /** Empty string = all networks; otherwise solana:devnet | solana:mainnet. */
  const [networkInput, setNetworkInput] = useState('');
  const [activeNetwork, setActiveNetwork] = useState('');
  const [activeSort, setActiveSort] = useState<MarketSortMode>('newest');
  const [filterNote, setFilterNote] = useState<string | null>(null);
  const sortChipRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  const refresh = useCallback(async (
    qOverride?: string,
    networkOverride?: string,
    sortOverride?: MarketSortMode,
  ) => {
    setLoading(true);
    setListError(null);
    const q = (qOverride !== undefined ? qOverride : activeQuery).trim();
    const network =
      networkOverride !== undefined ? networkOverride.trim() : activeNetwork.trim();
    const sort = sortOverride ?? activeSort;
    try {
      const { fetchMarket } = await import('@/lib/product-client');
      const result = await fetchMarket({
        limit: PAGE_SIZE,
        offset: 0,
        q: q || null,
        network: network || null,
        sort,
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
  }, [activeQuery, activeNetwork, activeSort, applyPage]);

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
        network: activeNetwork.trim() || null,
        sort: activeSort,
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
  }, [activeQuery, activeNetwork, activeSort, applyPage, loadingMore, nextOffset]);

  const selectSort = useCallback(
    (sort: MarketSortMode) => {
      setActiveSort(sort);
      void refresh(activeQuery, activeNetwork, sort);
    },
    [activeQuery, activeNetwork, refresh],
  );

  /** q / network narrow the catalog; sort only reorders — all reset together. */
  const hasActiveFilters = Boolean(activeQuery || activeNetwork || activeSort !== 'newest');
  /** Only q/network can yield an empty filtered result set. */
  const hasNarrowingFilters = Boolean(activeQuery || activeNetwork);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    setActiveQuery('');
    setNetworkInput('');
    setActiveNetwork('');
    setActiveSort('newest');
    void refresh('', '', 'newest');
  }, [refresh]);

  const onSortKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (loading || busy) return;
    const ids = MARKET_SORTS.map((s) => s.id);
    const current = ids.indexOf(activeSort);
    const i = current < 0 ? 0 : current;
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (i + 1) % ids.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (i - 1 + ids.length) % ids.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = ids.length - 1;
    } else if (event.key === ' ' || event.key === 'Enter') {
      // Buttons already activate on Space/Enter; keep focus on selected chip.
      return;
    }
    if (next === null) return;
    event.preventDefault();
    const id = ids[next]!;
    selectSort(id);
    sortChipRefs.current[next]?.focus();
  };

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
        ? 'file · single-node · replica-unsafe'
        : 'file · gate ephemeral · replica-unsafe'
      : 'memory · ephemeral · replica-unsafe';

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
          <div className="market__badges" role="group" aria-label="Market honesty badges">
            <StatusBadge tone={rpcReady ? 'verified' : 'pending'}>
              {rpcReady ? 'RPC verify on' : 'HTTP 402 · RPC unset'}
            </StatusBadge>
            <StatusBadge tone={storeMeta?.kind === 'file-local' ? 'pending' : 'degraded'}>
              {storeMeta?.label ?? storeLabel}
            </StatusBadge>
            <StatusBadge tone="degraded">multiReplicaSafe: false</StatusBadge>
            <StatusBadge tone="degraded">revenueReady: false</StatusBadge>
            <StatusBadge tone="degraded">single-node store</StatusBadge>
          </div>
        </header>
        <aside
          className="card-panel market__honesty"
          role="note"
          aria-label="Marketplace multi-replica honesty"
        >
          <p>
            <strong>multiReplicaSafe: false</strong>
            {' · '}
            <strong>single-node store only</strong>
          </p>
          <p className="field-help">
            {storeMeta?.note ??
              'Catalog and host unlock receipts live in this process (memory) or an optional local file path — never a multi-replica commerce backend. Do not scale this market API across instances and expect shared listings or purchases.'}
          </p>
          <p className="field-help">
            Kind: <code>{storeMeta?.kind ?? 'unknown'}</code>
            {storeMeta?.durableAcrossRestart != null
              ? ` · durableAcrossRestart: ${String(storeMeta.durableAcrossRestart)}`
              : null}
            {storeMeta?.gate ? ` · gate: ${storeMeta.gate}` : null}
            {' · '}
            revenueReady: false
          </p>
        </aside>
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
            <div className="market__list-head-meta" role="group" aria-label="Catalog sort and store honesty">
              <StatusBadge tone="pending">{activeMarketSortLabel(activeSort)}</StatusBadge>
              <StatusBadge tone="degraded">multiReplicaSafe: false</StatusBadge>
              <button type="button" onClick={() => void refresh()} disabled={loading || busy}>
                Refresh
              </button>
            </div>
          </div>
          <form
            className="market__search"
            role="search"
            aria-label="Filter marketplace listings"
            onSubmit={(e) => {
              e.preventDefault();
              const next = searchInput.trim().slice(0, 80);
              const nextNetwork = networkInput.trim();
              setActiveQuery(next);
              setActiveNetwork(nextNetwork);
              void refresh(next, nextNetwork);
            }}
          >
            <label htmlFor="market-search-q">
              Filter listings
              <input
                id="market-search-q"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Title, seller, id…"
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="market-search-help"
              />
            </label>
            <div
              className="market__network-chips"
              role="group"
              aria-label="Filter by listing network"
              aria-describedby="market-search-help"
            >
              <span className="field-help" id="market-network-chips-label">
                Network
              </span>
              {(
                [
                  { value: '', label: 'All networks' },
                  { value: 'solana:devnet', label: 'solana:devnet' },
                  { value: 'solana:mainnet', label: 'solana:mainnet' },
                ] as const
              ).map((chip) => {
                const selected = networkInput === chip.value;
                return (
                  <button
                    key={chip.value || 'all'}
                    type="button"
                    className="button-secondary"
                    aria-pressed={selected}
                    disabled={loading || busy}
                    onClick={() => {
                      setNetworkInput(chip.value);
                      setActiveNetwork(chip.value);
                      void refresh(activeQuery, chip.value);
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>

            <div
              className="market__network-chips"
              id="market-sort-chips"
              role="radiogroup"
              aria-labelledby="market-sort-chips-label"
              aria-describedby="market-search-help market-sort-active"
              onKeyDown={onSortKeyDown}
            >
              <span className="field-help" id="market-sort-chips-label">
                Sort
              </span>
              {MARKET_SORTS.map((chip, index) => {
                const selected = activeSort === chip.id;
                return (
                  <button
                    key={chip.id}
                    ref={(el) => {
                      sortChipRefs.current[index] = el;
                    }}
                    type="button"
                    role="radio"
                    className="button-secondary"
                    aria-checked={selected}
                    aria-label={`Sort by ${activeMarketSortLabel(chip.id)}`}
                    tabIndex={selected ? 0 : -1}
                    disabled={loading || busy}
                    onClick={() => selectSort(chip.id)}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
            <p className="field-help" id="market-sort-active" role="status">
              Active sort:{' '}
              <StatusBadge tone="pending">{activeMarketSortLabel(activeSort)}</StatusBadge>
              {' · '}
              <StatusBadge tone="degraded">multiReplicaSafe: false</StatusBadge>
            </p>
            <button type="submit" disabled={loading || busy}>
              Search
            </button>
            {hasActiveFilters ? (
              <button
                type="button"
                disabled={loading || busy}
                onClick={clearFilters}
                aria-label="Clear text, network, and sort filters"
              >
                Clear filters
              </button>
            ) : null}
          </form>
          <p className="field-help" id="market-search-help">
            Local host catalog only. Network filter matches listing.network exactly (x402
            solana:devnet / solana:mainnet). Sort uses createdAt (newest) or listing.lamports
            (price). Not a global index.
          </p>
          {filterNote ? (
            <p className="field-help">{filterNote}</p>
          ) : null}
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
            hasNarrowingFilters ? (
              <div
                className="market__empty market__empty--filtered card-panel"
                role="status"
                aria-live="polite"
                aria-label="No listings match the current filters"
              >
                <p>
                  <strong>
                    {[
                      activeQuery ? `No listings match “${activeQuery}”` : 'No listings match filters',
                      activeNetwork ? `on ${activeNetwork}` : 'on this node',
                    ].join(' ')
                      + '.'}
                  </strong>
                </p>
                <p className="field-help">
                  Active: text {activeQuery ? `“${activeQuery}”` : '(none)'} · network{' '}
                  {activeNetwork || 'all'} · sort {activeMarketSortLabel(activeSort)} ({activeSort}).
                </p>
                <p className="field-help">
                  Text filter is a local substring; network is an exact match on listing.network.
                  Sort only reorders (newest / price). Neither is a global search index.
                </p>
                <div className="market__actions" role="group" aria-label="Empty filter actions">
                  <button
                    type="button"
                    disabled={loading || busy}
                    onClick={clearFilters}
                    aria-label="Clear text, network, and sort filters"
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            ) : (
              <div className="market__empty card-panel" role="status">
                <p>
                  <strong>No sealed drops yet.</strong>
                </p>
                <p className="field-help">
                  Sort: {activeMarketSortLabel(activeSort)} ({activeSort}). multiReplicaSafe: false —
                  single-node host catalog only.
                </p>
                <p className="field-help">
                  {`List a text or media drop above. Buyers will see HTTP 402 terms with your payTo address. Catalog is ${storeMeta?.kind === 'file-local' ? 'file-backed on this node' : 'in-process memory'} — not multi-replica commerce.`}
                </p>
                {hasActiveFilters ? (
                  <div className="market__actions" role="group" aria-label="Empty catalog filter actions">
                    <button
                      type="button"
                      disabled={loading || busy}
                      onClick={clearFilters}
                      aria-label="Reset sort to newest"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : null}
              </div>
            )
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
            <UnlockAttemptHistory
              log={attemptLog}
              listingId={activeId}
              onClear={() => {
                void (async () => {
                  const { clearUnlockAttemptLog } = await import('@/lib/product-client');
                  setAttemptLog(clearUnlockAttemptLog());
                })();
              }}
            />
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

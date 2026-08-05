'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import { AgeGatePanel } from '@/components/age-gate-panel';
import { sealBytes, sealText, openText, openEnvelope } from '@/lib/e2ee-seal';
import {
  encodePaymentHeader,
  isValidSolanaAddress,
  isValidTxSignature,
  solFromLamports,
  type X402PaymentRequirements,
} from '@/lib/x402';

interface PublicListing {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly seller: string;
  readonly payTo: string;
  readonly lamports: string;
  readonly network: string;
  readonly contentType: string;
  readonly createdAt: string;
}

interface MarketMeta {
  readonly paymentVerify?: {
    readonly rpcConfigured: boolean;
    readonly network: string;
    readonly note?: string;
  };
}

export function Marketplace() {
  const [listings, setListings] = useState<readonly PublicListing[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentMeta, setPaymentMeta] = useState<MarketMeta['paymentVerify'] | null>(null);

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

  const refresh = useCallback(async () => {
    const res = await fetch('/api/v1/market', { cache: 'no-store' });
    const body = (await res.json()) as {
      listings?: PublicListing[];
      paymentVerify?: MarketMeta['paymentVerify'];
    };
    setListings(body.listings ?? []);
    setPaymentMeta(body.paymentVerify ?? null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sell = async (file?: File | null) => {
    setBusy(true);
    setStatus(null);
    try {
      if (!isValidSolanaAddress(payTo)) {
        setStatus('Invalid Solana payTo address.');
        return;
      }
      if (unlockSecret.length < 8) {
        setStatus('Unlock secret must be ≥ 8 characters (buyers need it after pay).');
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
      const body = (await res.json()) as { ok?: boolean; error?: { message?: string }; listing?: PublicListing };
      if (!res.ok) {
        setStatus(body.error?.message || 'List failed');
        return;
      }
      setStatus(`Listed ${body.listing?.id}`);
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
    setTxSig('');
    setAccepts(null);
    setStatus(null);
    const res = await fetch(`/api/v1/market/${id}`, { cache: 'no-store' });
    const body = (await res.json()) as {
      accepts?: X402PaymentRequirements[];
      listing?: PublicListing;
      error?: { message?: string };
    };
    if (res.status === 402) {
      setAccepts(body.accepts?.[0] ?? null);
      setStatus('Payment required (HTTP 402). Pay SOL then paste tx signature.');
      return;
    }
    setStatus(body.error?.message || `Unexpected ${res.status}`);
  };

  const claimWithPayment = async () => {
    if (!activeId || !txSig.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      if (!isValidTxSignature(txSig.trim())) {
        setStatus('Invalid Solana signature format.');
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
        error?: { message?: string; reason?: string };
        devAccepted?: boolean;
      };
      if (!res.ok || !body.ok || !body.envelope || !body.unlockSecret) {
        setStatus(
          body.error?.message ||
            `Unlock failed (${res.status}${body.error?.reason ? `: ${body.error.reason}` : ''})`,
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
      setStatus(body.devAccepted ? 'Unlocked (dev accept — configure RPC for real verify).' : 'Unlocked.');
    } catch {
      setStatus('Claim failed.');
    } finally {
      setBusy(false);
    }
  };

  const rpcReady = paymentMeta?.rpcConfigured === true;

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
        <StatusBadge tone={rpcReady ? 'verified' : 'pending'}>
          {rpcReady ? 'RPC verify on' : 'HTTP 402 · RPC unset'}
        </StatusBadge>
      </header>
      <p className="market__lede">
        List content sealed client-side (middle-out + AES). Buyers hit <strong>402 Payment Required</strong>,
        pay your Solana address, then unlock with the tx signature. Host never holds plaintext.
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
          Unlock secret (≥8 chars — buyer gets this after pay)
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

      <section className="market__list">
        <h2>Listings</h2>
        <ul>
          {listings.length === 0 ? <li className="muted">No listings yet.</li> : null}
          {listings.map((l) => (
            <li key={l.id}>
              <article className="market-card">
                <h3>{l.title}</h3>
                <p>{l.description || '—'}</p>
                <p className="market-card__meta">
                  {solFromLamports(l.lamports)} SOL · {l.network} · {l.contentType}
                </p>
                <p className="market-card__meta">payTo {l.payTo.slice(0, 4)}…{l.payTo.slice(-4)}</p>
                <button type="button" onClick={() => void openListing(l.id)}>
                  Open / buy
                </button>
              </article>
            </li>
          ))}
        </ul>
      </section>

      {activeId ? (
        <section className="market__buy card-panel">
          <h2>Unlock {activeId}</h2>
          {accepts ? (
            <>
              <p>
                Pay <strong>{solFromLamports(accepts.maxAmountRequired)} SOL</strong> to{' '}
                <code>{accepts.payTo}</code> then paste the transaction signature.
              </p>
              <label>
                Solana tx signature
                <input value={txSig} onChange={(e) => setTxSig(e.target.value)} spellCheck={false} />
              </label>
              <button type="button" disabled={busy} onClick={() => void claimWithPayment()}>
                Verify payment &amp; unlock
              </button>
            </>
          ) : null}
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
        Set <code>WETDROOL_SOLANA_RPC_URL</code> for real tx verification. Dev without RPC: set{' '}
        <code>WETDROOL_X402_DEV_ACCEPT=1</code> (non-production only).{' '}
        <Link href="/rooms/lobby">Free E2EE rooms</Link>
      </p>
    </div>
    </AgeGatePanel>
  );
}

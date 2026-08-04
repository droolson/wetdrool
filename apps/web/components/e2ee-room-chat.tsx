'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import {
  openEnvelope,
  openText,
  sealBytes,
  sealText,
  type SealedEnvelope,
} from '@/lib/e2ee-seal';

type FeedFilter = 'all' | 'media' | 'chat';

interface Decoded {
  readonly id: string;
  readonly at: string;
  readonly contentType: string;
  readonly kind: 'text' | 'image' | 'gif' | 'video' | 'locked' | 'error';
  readonly text?: string;
  readonly mediaUrl?: string;
  readonly error?: string;
}

const MAX_MEDIA_BYTES = 4_000_000;

function mediaKind(contentType: string): 'image' | 'gif' | 'video' | 'text' {
  const c = contentType.toLowerCase();
  if (c.includes('gif')) return 'gif';
  if (c.startsWith('video/')) return 'video';
  if (c.startsWith('image/')) return 'image';
  return 'text';
}

export function E2eeRoomChat({ roomId }: { readonly roomId: string }) {
  const [passphrase, setPassphrase] = useState('');
  const [draft, setDraft] = useState('');
  const [envelopes, setEnvelopes] = useState<readonly SealedEnvelope[]>([]);
  const [decoded, setDecoded] = useState<readonly Decoded[]>([]);
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const objectUrls = useRef<string[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, {
      cache: 'no-store',
    });
    const body = (await res.json()) as { messages?: SealedEnvelope[] };
    setEnvelopes(body.messages ?? []);
  }, [roomId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3500);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // revoke previous blob URLs
      for (const u of objectUrls.current) URL.revokeObjectURL(u);
      objectUrls.current = [];

      if (!passphrase) {
        setDecoded(
          envelopes.map((e) => ({
            id: e.messageId,
            at: e.createdAt,
            contentType: e.contentType,
            kind: 'locked' as const,
            text: 'Locked — enter room passphrase to decrypt',
          })),
        );
        return;
      }

      const out: Decoded[] = [];
      // newest first for RedGIFs energy
      const ordered = [...envelopes].reverse();
      for (const e of ordered) {
        try {
          if (e.contentType.startsWith('text/')) {
            const text = await openText(passphrase, e);
            out.push({
              id: e.messageId,
              at: e.createdAt,
              contentType: e.contentType,
              kind: 'text',
              text,
            });
          } else {
            const { bytes, contentType } = await openEnvelope(passphrase, e);
            const copy = new Uint8Array(bytes.byteLength);
            copy.set(bytes);
            const blob = new Blob([copy], { type: contentType });
            const mediaUrl = URL.createObjectURL(blob);
            objectUrls.current.push(mediaUrl);
            out.push({
              id: e.messageId,
              at: e.createdAt,
              contentType,
              kind: mediaKind(contentType),
              mediaUrl,
            });
          }
        } catch {
          out.push({
            id: e.messageId,
            at: e.createdAt,
            contentType: e.contentType,
            kind: 'error',
            error: 'Decrypt failed (wrong passphrase or corrupt envelope)',
          });
        }
      }
      if (!cancelled) setDecoded(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [envelopes, passphrase]);

  useEffect(
    () => () => {
      for (const u of objectUrls.current) URL.revokeObjectURL(u);
    },
    [],
  );

  const visible = useMemo(() => {
    if (filter === 'media') {
      return decoded.filter((d) => d.kind === 'image' || d.kind === 'gif' || d.kind === 'video');
    }
    if (filter === 'chat') return decoded.filter((d) => d.kind === 'text');
    return decoded;
  }, [decoded, filter]);

  const postEnvelope = async (envelope: SealedEnvelope) => {
    const res = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) throw new Error('post failed');
    await load();
  };

  const sendText = async () => {
    if (!passphrase || !draft.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const envelope = await sealText(roomId, passphrase, draft.trim());
      await postEnvelope(envelope);
      setDraft('');
      setStatus('Sealed text posted.');
    } catch {
      setStatus('Send failed.');
    } finally {
      setBusy(false);
    }
  };

  const sendFile = async (file: File, caption?: string) => {
    if (!passphrase) {
      setStatus('Unlock with passphrase first.');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const type = file.type || 'application/octet-stream';
      if (!type.startsWith('image/') && !type.startsWith('video/')) {
        setStatus('Only image, GIF, or video.');
        return;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.length > MAX_MEDIA_BYTES) {
        setStatus(`File too large (max ${Math.floor(MAX_MEDIA_BYTES / 1e6)}MB alpha).`);
        return;
      }
      // optional caption as preceding sealed text
      if (caption?.trim()) {
        await postEnvelope(await sealText(roomId, passphrase, caption.trim()));
      }
      const envelope = await sealBytes(roomId, passphrase, buf, type, 'media-passthrough');
      await postEnvelope(envelope);
      setStatus(`Sealed ${mediaKind(type)} shared.`);
    } catch {
      setStatus('Media seal/upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void sendFile(file, draft);
        return;
      }
    }
  };

  return (
    <div
      className={`e2ee-room e2ee-room--redgifs${dragOver ? ' is-drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void sendFile(f, draft);
      }}
    >
      <header className="e2ee-room__header">
        <div>
          <p className="section-kicker">E2EE · RedGIFs-class media · middle-out</p>
          <h1>#{roomId}</h1>
        </div>
        <StatusBadge tone="pending">host sees ciphertext only</StatusBadge>
      </header>

      <p className="e2ee-room__lede">
        Share <strong>img / GIF / video</strong> like a private RedGIFs room: sealed client-side
        (middle-out passthrough keeps codec quality), then posted as envelopes. Drop or paste media.
        Passphrase never leaves this browser.
      </p>

      <div className="e2ee-room__rooms">
        <Link href="/rooms/lobby">lobby</Link>
        <Link href="/rooms/shorts">shorts</Link>
        <Link href="/rooms/pride">pride</Link>
        <Link href="/rooms/afterdark">afterdark</Link>
      </div>

      <label className="e2ee-room__field">
        Room passphrase
        <input
          type="password"
          autoComplete="off"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="shared secret — out of band"
        />
      </label>

      <div className="e2ee-room__filters" role="tablist" aria-label="Feed filter">
        {(
          [
            ['all', 'All'],
            ['media', 'Media'],
            ['chat', 'Chat'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={filter === id ? 'is-active' : undefined}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="e2ee-room__feed" aria-live="polite">
        {visible.length === 0 ? (
          <li className="e2ee-room__empty">
            {passphrase
              ? 'No posts yet — drop a GIF or video to start the feed.'
              : 'Enter the room passphrase to decrypt the feed.'}
          </li>
        ) : null}
        {visible.map((m) => (
          <li key={m.id} className="e2ee-card" data-kind={m.kind}>
            <div className="e2ee-card__meta">
              <span className="e2ee-card__kind">{m.kind}</span>
              <time dateTime={m.at}>{new Date(m.at).toLocaleString()}</time>
            </div>
            {m.error ? <p className="e2ee-room__err">{m.error}</p> : null}
            {m.text ? <p className="e2ee-card__text">{m.text}</p> : null}
            {m.mediaUrl && (m.kind === 'image' || m.kind === 'gif') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.mediaUrl} alt="" className="e2ee-card__media" loading="lazy" />
            ) : null}
            {m.mediaUrl && m.kind === 'video' ? (
              <video
                src={m.mediaUrl}
                className="e2ee-card__media"
                controls
                playsInline
                loop
                muted
                autoPlay
              />
            ) : null}
          </li>
        ))}
      </ul>

      <div className="e2ee-room__compose" onPaste={onPaste}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Caption or chat (encrypted) — paste images here"
          disabled={!passphrase || busy}
        />
        <div className="e2ee-room__actions">
          <button
            type="button"
            disabled={!passphrase || busy || !draft.trim()}
            onClick={() => void sendText()}
          >
            Send chat
          </button>
          <label className="e2ee-room__file">
            <span>Drop / pick GIF · img · video</span>
            <input
              type="file"
              accept="image/*,video/*,image/gif,.gif"
              disabled={!passphrase || busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void sendFile(f, draft);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {status ? (
          <p role="status" className="e2ee-room__status">
            {status}
          </p>
        ) : null}
        {dragOver ? <p className="e2ee-room__drop">Drop to seal & share</p> : null}
      </div>
    </div>
  );
}

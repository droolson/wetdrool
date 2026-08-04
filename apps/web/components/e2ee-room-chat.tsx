'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import {
  openText,
  sealBytes,
  sealText,
  type SealedEnvelope,
} from '@/lib/e2ee-seal';

interface Decoded {
  readonly id: string;
  readonly at: string;
  readonly contentType: string;
  readonly text?: string;
  readonly mediaUrl?: string;
  readonly error?: string;
}

export function E2eeRoomChat({ roomId }: { readonly roomId: string }) {
  const [passphrase, setPassphrase] = useState('');
  const [draft, setDraft] = useState('');
  const [envelopes, setEnvelopes] = useState<readonly SealedEnvelope[]>([]);
  const [decoded, setDecoded] = useState<readonly Decoded[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, {
      cache: 'no-store',
    });
    const body = (await res.json()) as { messages?: SealedEnvelope[] };
    setEnvelopes(body.messages ?? []);
  }, [roomId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!passphrase) {
        setDecoded(
          envelopes.map((e) => ({
            id: e.messageId,
            at: e.createdAt,
            contentType: e.contentType,
            text: '[locked — enter room passphrase]',
          })),
        );
        return;
      }
      const out: Decoded[] = [];
      for (const e of envelopes) {
        try {
          if (e.contentType.startsWith('text/')) {
            const text = await openText(passphrase, e);
            out.push({ id: e.messageId, at: e.createdAt, contentType: e.contentType, text });
          } else {
            const { openEnvelope } = await import('@/lib/e2ee-seal');
            const { bytes, contentType } = await openEnvelope(passphrase, e);
            const blob = new Blob([bytes.buffer as ArrayBuffer], { type: contentType });
            const mediaUrl = URL.createObjectURL(blob);
            out.push({ id: e.messageId, at: e.createdAt, contentType, mediaUrl });
          }
        } catch {
          out.push({
            id: e.messageId,
            at: e.createdAt,
            contentType: e.contentType,
            error: 'decrypt failed',
          });
        }
      }
      if (!cancelled) setDecoded(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [envelopes, passphrase]);

  const sendText = async () => {
    if (!passphrase || !draft.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const envelope = await sealText(roomId, passphrase, draft.trim());
      const res = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      if (!res.ok) throw new Error('post failed');
      setDraft('');
      await load();
    } catch {
      setStatus('Send failed.');
    } finally {
      setBusy(false);
    }
  };

  const sendFile = async (file: File) => {
    if (!passphrase) return;
    setBusy(true);
    setStatus(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.length > 1_500_000) {
        setStatus('File too large for alpha (1.5MB).');
        return;
      }
      const envelope = await sealBytes(
        roomId,
        passphrase,
        buf,
        file.type || 'application/octet-stream',
        'media-passthrough',
      );
      const res = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      if (!res.ok) throw new Error('upload failed');
      await load();
    } catch {
      setStatus('Media send failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="e2ee-room">
      <header className="e2ee-room__header">
        <div>
          <p className="section-kicker">E2EE room · middle-out</p>
          <h1>#{roomId}</h1>
        </div>
        <StatusBadge tone="pending">ciphertext only · xAI-free path</StatusBadge>
      </header>
      <p className="e2ee-room__lede">
        Messages are compressed with <strong>WokeNet middle-out lite</strong> (CDC + content IDs;
        media passthrough for high-quality gif/img/video bytes) then sealed with AES-256-GCM. The
        host never sees your passphrase. Share the room passphrase out-of-band.
      </p>

      <label className="e2ee-room__field">
        Room passphrase
        <input
          type="password"
          autoComplete="off"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="shared secret"
        />
      </label>

      <ul className="e2ee-room__log" aria-live="polite">
        {decoded.map((m) => (
          <li key={m.id}>
            <time dateTime={m.at}>{new Date(m.at).toLocaleString()}</time>
            {m.error ? <p className="e2ee-room__err">{m.error}</p> : null}
            {m.text ? <p>{m.text}</p> : null}
            {m.mediaUrl && m.contentType.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.mediaUrl} alt="" className="e2ee-room__media" />
            ) : null}
            {m.mediaUrl && m.contentType.startsWith('video/') ? (
              <video src={m.mediaUrl} controls className="e2ee-room__media" />
            ) : null}
          </li>
        ))}
      </ul>

      <div className="e2ee-room__compose">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Message (encrypted client-side)"
          disabled={!passphrase || busy}
        />
        <div className="e2ee-room__actions">
          <button type="button" disabled={!passphrase || busy || !draft.trim()} onClick={() => void sendText()}>
            Send sealed
          </button>
          <label className="e2ee-room__file">
            Img / GIF / Video
            <input
              type="file"
              accept="image/*,video/*,.gif"
              disabled={!passphrase || busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void sendFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {status ? <p role="status">{status}</p> : null}
      </div>
    </div>
  );
}

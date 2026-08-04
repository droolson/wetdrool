'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import {
  normalizeUsername,
  openEnvelope,
  openText,
  sealBytes,
  sealText,
  type SealedEnvelope,
} from '@/lib/e2ee-seal';

type FeedFilter = 'all' | 'media' | 'chat';

interface Session {
  readonly username: string;
  readonly password: string;
}

interface Decoded {
  readonly id: string;
  readonly at: string;
  readonly from: string;
  readonly contentType: string;
  readonly kind: 'text' | 'image' | 'gif' | 'video' | 'locked' | 'error';
  readonly text?: string;
  readonly mediaUrl?: string;
  readonly error?: string;
}

const MAX_MEDIA_BYTES = 4_000_000;
const SESSION_PREFIX = 'wetdrool.room.session.v1:';

function mediaKind(contentType: string): 'image' | 'gif' | 'video' | 'text' {
  const c = contentType.toLowerCase();
  if (c.includes('gif')) return 'gif';
  if (c.startsWith('video/')) return 'video';
  if (c.startsWith('image/')) return 'image';
  return 'text';
}

function loadSession(roomId: string): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + roomId);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Session>;
    if (typeof p.username !== 'string' || typeof p.password !== 'string') return null;
    if (p.password.length < 1) return null;
    return { username: normalizeUsername(p.username), password: p.password };
  } catch {
    return null;
  }
}

function saveSession(roomId: string, session: Session): void {
  sessionStorage.setItem(SESSION_PREFIX + roomId, JSON.stringify(session));
}

function clearSession(roomId: string): void {
  sessionStorage.removeItem(SESSION_PREFIX + roomId);
}

export function E2eeRoomChat({ roomId }: { readonly roomId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [gateUser, setGateUser] = useState('');
  const [gatePass, setGatePass] = useState('');
  const [draft, setDraft] = useState('');
  const [envelopes, setEnvelopes] = useState<readonly SealedEnvelope[]>([]);
  const [decoded, setDecoded] = useState<readonly Decoded[]>([]);
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    setSession(loadSession(roomId));
  }, [roomId]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, {
      cache: 'no-store',
    });
    const body = (await res.json()) as { messages?: SealedEnvelope[] };
    setEnvelopes(body.messages ?? []);
  }, [roomId]);

  useEffect(() => {
    if (!session) return;
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load, session]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const u of objectUrls.current) URL.revokeObjectURL(u);
      objectUrls.current = [];

      if (!session) {
        setDecoded([]);
        return;
      }

      const out: Decoded[] = [];
      const ordered = [...envelopes].reverse();
      for (const e of ordered) {
        const from = e.from ? normalizeUsername(e.from) : 'anon';
        try {
          if (e.contentType.startsWith('text/')) {
            const text = await openText(session.password, e);
            out.push({
              id: e.messageId,
              at: e.createdAt,
              from,
              contentType: e.contentType,
              kind: 'text',
              text,
            });
          } else {
            const { bytes, contentType } = await openEnvelope(session.password, e);
            const copy = new Uint8Array(bytes.byteLength);
            copy.set(bytes);
            const mediaUrl = URL.createObjectURL(new Blob([copy], { type: contentType }));
            objectUrls.current.push(mediaUrl);
            out.push({
              id: e.messageId,
              at: e.createdAt,
              from,
              contentType,
              kind: mediaKind(contentType),
              mediaUrl,
            });
          }
        } catch {
          out.push({
            id: e.messageId,
            at: e.createdAt,
            from,
            contentType: e.contentType,
            kind: 'error',
            error: 'Wrong password or corrupt message',
          });
        }
      }
      if (!cancelled) setDecoded(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [envelopes, session]);

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

  const enter = (e: React.FormEvent) => {
    e.preventDefault();
    const username = normalizeUsername(gateUser);
    const password = gatePass;
    if (password.length < 1) {
      setStatus('Password required (room key).');
      return;
    }
    const next = { username, password };
    saveSession(roomId, next);
    setSession(next);
    setGatePass('');
    setStatus(null);
  };

  const leave = () => {
    clearSession(roomId);
    setSession(null);
    setEnvelopes([]);
    setDecoded([]);
    setDraft('');
  };

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
    if (!session || !draft.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      await postEnvelope(
        await sealText(roomId, session.password, draft.trim(), session.username),
      );
      setDraft('');
    } catch {
      setStatus('Send failed.');
    } finally {
      setBusy(false);
    }
  };

  const sendFile = async (file: File, caption?: string) => {
    if (!session) return;
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
        setStatus('Max 4MB media in alpha.');
        return;
      }
      if (caption?.trim()) {
        await postEnvelope(
          await sealText(roomId, session.password, caption.trim(), session.username),
        );
      }
      await postEnvelope(
        await sealBytes(roomId, session.password, buf, type, 'media-passthrough', session.username),
      );
      setDraft('');
      setStatus('Media sealed & shared.');
    } catch {
      setStatus('Media failed.');
    } finally {
      setBusy(false);
    }
  };

  // —— Gate: no signup, username + password one-time ——
  if (!session) {
    return (
      <div className="anon-gate">
        <header className="anon-gate__header">
          <p className="section-kicker">Anon E2EE chatroom</p>
          <h1>#{roomId}</h1>
          <StatusBadge tone="pending">no signup · no accounts</StatusBadge>
        </header>
        <p className="anon-gate__lede">
          One-time entry: pick a <strong>username</strong> (public in the room) and a{' '}
          <strong>password</strong> (room key — shared with people you invite). Nothing is
          registered. Close the tab and the session ends.
        </p>
        <form className="anon-gate__form" onSubmit={enter}>
          <label>
            Username
            <input
              value={gateUser}
              onChange={(e) => setGateUser(e.target.value)}
              maxLength={32}
              placeholder="anon"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password (room key)
            <input
              type="password"
              value={gatePass}
              onChange={(e) => setGatePass(e.target.value)}
              placeholder="shared secret"
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit">Enter chatroom</button>
        </form>
        {status ? <p className="e2ee-room__status">{status}</p> : null}
        <p className="field-help">
          Same password as others in this room or messages won&apos;t decrypt. Host stores
          ciphertext only.{' '}
          <Link href="/chat">Secret entrance</Link> · <Link href="/rooms/lobby">lobby</Link>
        </p>
      </div>
    );
  }

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
          <p className="section-kicker">Anon · E2EE · img/gif/video</p>
          <h1>
            #{roomId}{' '}
            <span className="e2ee-room__you">as {session.username}</span>
          </h1>
        </div>
        <div className="e2ee-room__header-actions">
          <StatusBadge tone="pending">no account</StatusBadge>
          <button type="button" className="e2ee-room__leave" onClick={leave}>
            Leave
          </button>
        </div>
      </header>

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
          <li className="e2ee-room__empty">No messages — say hi or drop a GIF.</li>
        ) : null}
        {visible.map((m) => (
          <li key={m.id} className="e2ee-card" data-kind={m.kind}>
            <div className="e2ee-card__meta">
              <span className="e2ee-card__from">{m.from}</span>
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

      <div
        className="e2ee-room__compose"
        onPaste={(e) => {
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
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Message (E2EE) — paste images OK"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendText();
            }
          }}
        />
        <div className="e2ee-room__actions">
          <button type="button" disabled={busy || !draft.trim()} onClick={() => void sendText()}>
            Send
          </button>
          <label className="e2ee-room__file">
            <span>Img · GIF · Video</span>
            <input
              type="file"
              accept="image/*,video/*,image/gif,.gif"
              disabled={busy}
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
        {dragOver ? <p className="e2ee-room__drop">Drop to seal &amp; share</p> : null}
      </div>
    </div>
  );
}

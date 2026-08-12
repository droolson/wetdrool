'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import {
  describeOpenError,
  normalizeUsername,
  openEnvelope,
  openText,
  sealBytes,
  sealText,
  type SealedEnvelope,
} from '@/lib/e2ee-seal';

import { buildRoomShareUrl, formatNewMessagesAnnouncement } from '@/lib/room-client';

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
  readonly errorCode?: string;
}

const MAX_MEDIA_BYTES = 4_000_000;
const SESSION_PREFIX = 'wetdrool.room.session.v1:';
const POLL_BASE_MS = 3000;
const POLL_MAX_MS = 30_000;
const PAGE_LIMIT = 50;

function mediaKind(contentType: string): 'image' | 'gif' | 'video' | 'text' {
  const c = contentType.toLowerCase();
  if (c.includes('gif')) return 'gif';
  if (c.startsWith('video/')) return 'video';
  if (c.startsWith('image/')) return 'image';
  return 'text';
}

function passphraseHint(password: string): string {
  if (password.length === 0) return 'Required shared room key';
  if (password.length < 8) return 'Short key — easy to guess; 12+ recommended';
  if (password.length < 12) return 'OK for casual rooms; longer is stronger';
  return 'Stronger room key';
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

function mergeEnvelopes(
  prev: readonly SealedEnvelope[],
  incoming: readonly SealedEnvelope[],
  mode: 'append' | 'prepend' | 'replace',
): SealedEnvelope[] {
  if (mode === 'replace') return [...incoming].slice(-200);
  const seen = new Set(prev.map((m) => m.messageId));
  if (mode === 'append') {
    const merged = [...prev];
    for (const m of incoming) {
      if (!seen.has(m.messageId)) {
        seen.add(m.messageId);
        merged.push(m);
      }
    }
    return merged.slice(-200);
  }
  // prepend older history (keep chronological order: older first)
  const older: SealedEnvelope[] = [];
  for (const m of incoming) {
    if (!seen.has(m.messageId)) {
      seen.add(m.messageId);
      older.push(m);
    }
  }
  return [...older, ...prev].slice(-200);
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
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storeNote, setStoreNote] = useState<string | null>(null);
  const [storeKind, setStoreKind] = useState<string | null>(null);
  const [storeDurable, setStoreDurable] = useState<boolean | null>(null);
  const [maxMessagesPerRoom, setMaxMessagesPerRoom] = useState<number | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [totalServer, setTotalServer] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [arrivalAnnouncement, setArrivalAnnouncement] = useState('');
  const [rekeyOpen, setRekeyOpen] = useState(false);
  const [rekeyPass, setRekeyPass] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const objectUrls = useRef<string[]>([]);
  const lastIdRef = useRef<string | null>(null);
  const oldestIdRef = useRef<string | null>(null);
  const pollFailRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const visibleRef = useRef(true);

  useEffect(() => {
    setSession(loadSession(roomId));
    lastIdRef.current = null;
    oldestIdRef.current = null;
    setEnvelopes([]);
    setHasMoreOlder(false);
    setTotalServer(null);
    setMaxMessagesPerRoom(null);
    setLoadError(null);
    setArrivalAnnouncement('');
    setRekeyOpen(false);
  }, [roomId]);

  const applyStoreMeta = useCallback(
    (
      store:
        | {
            kind?: string;
            note?: string;
            durableAcrossRestart?: boolean;
            label?: string;
            maxMessagesPerRoom?: number;
          }
        | undefined,
    ) => {
      if (!store) return;
      if (store.kind) setStoreKind(store.kind);
      if (typeof store.durableAcrossRestart === 'boolean') {
        setStoreDurable(store.durableAcrossRestart);
      }
      if (
        typeof store.maxMessagesPerRoom === 'number' &&
        Number.isFinite(store.maxMessagesPerRoom) &&
        store.maxMessagesPerRoom > 0
      ) {
        setMaxMessagesPerRoom(Math.floor(store.maxMessagesPerRoom));
      }
      if (store.note) {
        const durable =
          store.durableAcrossRestart === true
            ? ' · durable across restart (single node)'
            : ' · ephemeral (lost on cold start)';
        setStoreNote(`${store.note}${durable}`);
      } else if (store.label) {
        setStoreNote(store.label);
      }
    },
    [],
  );

  const load = useCallback(
    async (mode: 'full' | 'poll' | 'older' = 'full') => {
      if (mode === 'poll' && inFlightRef.current) return;
      if (mode === 'poll' && !visibleRef.current) return;
      if (mode === 'full') setLoading(true);
      if (mode === 'older') setLoadingOlder(true);
      if (mode !== 'poll') setLoadError(null);
      inFlightRef.current = true;
      try {
        const after = mode === 'poll' && lastIdRef.current ? lastIdRef.current : undefined;
        const before = mode === 'older' && oldestIdRef.current ? oldestIdRef.current : undefined;
        const q = new URLSearchParams();
        q.set('limit', String(PAGE_LIMIT));
        if (after) q.set('after', after);
        if (before) q.set('before', before);
        const res = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/messages?${q}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          const message = body?.error?.message || `Load failed (${res.status})`;
          if (mode === 'poll') {
            pollFailRef.current += 1;
          } else {
            setLoadError(message);
          }
          return;
        }
        const data = (await res.json()) as {
          messages?: readonly SealedEnvelope[];
          total?: number;
          hasMore?: boolean;
          hasMoreOlder?: boolean;
          store?: {
            kind?: string;
            note?: string;
            durableAcrossRestart?: boolean;
            label?: string;
            maxMessagesPerRoom?: number;
          };
        };
        pollFailRef.current = 0;
        applyStoreMeta(data.store);
        if (typeof data.total === 'number') setTotalServer(data.total);

        const incoming = data.messages ?? [];
        const moreOlder =
          typeof data.hasMoreOlder === 'boolean'
            ? data.hasMoreOlder
            : Boolean(data.hasMore && mode !== 'poll');

        if (mode === 'poll' && after) {
          if (incoming.length === 0) return;
          setEnvelopes((prev) => mergeEnvelopes(prev, incoming, 'append'));
          const last = incoming[incoming.length - 1]?.messageId;
          if (last) lastIdRef.current = last;
          const announcement = formatNewMessagesAnnouncement(incoming.length);
          if (announcement) setArrivalAnnouncement(announcement);
        } else if (mode === 'older' && before) {
          setEnvelopes((prev) => mergeEnvelopes(prev, incoming, 'prepend'));
          setHasMoreOlder(moreOlder && incoming.length > 0);
          const first = incoming[0]?.messageId;
          if (first) oldestIdRef.current = first;
          if (incoming.length === 0) setHasMoreOlder(false);
        } else {
          setEnvelopes(mergeEnvelopes([], incoming, 'replace'));
          setHasMoreOlder(moreOlder);
          const last = incoming[incoming.length - 1]?.messageId ?? null;
          const first = incoming[0]?.messageId ?? null;
          lastIdRef.current = last;
          oldestIdRef.current = first;
        }
      } catch {
        if (mode === 'poll') {
          pollFailRef.current += 1;
        } else {
          setLoadError('Network error loading messages.');
        }
      } finally {
        inFlightRef.current = false;
        if (mode === 'full') setLoading(false);
        if (mode === 'older') setLoadingOlder(false);
      }
    },
    [applyStoreMeta, roomId],
  );

  // Session presence only — rekey must NOT reset poll cursor (`after` / lastIdRef).
  const hasSession = session !== null;

  // Visibility-aware poll with exponential backoff on failures.
  useEffect(() => {
    if (!hasSession) return;

    const onVis = () => {
      visibleRef.current = document.visibilityState === 'visible';
      if (visibleRef.current) void load('poll');
    };
    visibleRef.current =
      typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
    document.addEventListener('visibilitychange', onVis);

    void load('full');

    const schedule = () => {
      const fails = pollFailRef.current;
      const delay = Math.min(POLL_MAX_MS, POLL_BASE_MS * 2 ** Math.min(fails, 4));
      pollTimerRef.current = setTimeout(() => {
        void load('poll').finally(schedule);
      }, delay);
    };
    schedule();

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [load, hasSession]);

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
        } catch (err) {
          const desc = describeOpenError(err);
          out.push({
            id: e.messageId,
            at: e.createdAt,
            from,
            contentType: e.contentType,
            kind: 'error',
            error: desc.message,
            errorCode: desc.code,
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

  const wrongKeyCount = useMemo(
    () => decoded.filter((d) => d.errorCode === 'wrong_key' || d.kind === 'error').length,
    [decoded],
  );
  const wrongKeyOnly = useMemo(
    () => decoded.filter((d) => d.errorCode === 'wrong_key').length,
    [decoded],
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

  const applyRekey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || rekeyPass.length < 1) {
      setStatus('Enter the correct shared room key.');
      return;
    }
    // Password-only update: keep envelopes + poll cursor (lastIdRef / after) stable.
    const next = { username: session.username, password: rekeyPass };
    saveSession(roomId, next);
    setSession(next);
    setRekeyPass('');
    setRekeyOpen(false);
    setStatus('Room key updated — re-decrypting sealed messages…');
  };

  const leave = () => {
    clearSession(roomId);
    setSession(null);
    setEnvelopes([]);
    setDecoded([]);
    setDraft('');
    lastIdRef.current = null;
    oldestIdRef.current = null;
    setLoadError(null);
    setRekeyOpen(false);
  };

  const postEnvelope = async (envelope: SealedEnvelope) => {
    const res = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message || `post failed (${res.status})`);
    }
    await load('full');
  };

  const sendText = async () => {
    if (!session || !draft.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      await postEnvelope(await sealText(roomId, session.password, draft.trim(), session.username));
      setDraft('');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Send failed.');
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
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Media failed.');
    } finally {
      setBusy(false);
    }
  };

  const onFilterKeyDown = (e: React.KeyboardEvent, ids: readonly FeedFilter[]) => {
    const idx = ids.indexOf(filter);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      setFilter(ids[(idx + 1) % ids.length]!);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      setFilter(ids[(idx - 1 + ids.length) % ids.length]!);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFilter(ids[0]!);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFilter(ids[ids.length - 1]!);
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
          registered. Close the tab and the session ends. Server stores ciphertext only.
        </p>
        <form className="anon-gate__form" onSubmit={enter} aria-labelledby="gate-title">
          <h2 id="gate-title" className="visually-hidden">
            Enter room {roomId}
          </h2>
          <label htmlFor="room-gate-user">
            Username
            <input
              id="room-gate-user"
              value={gateUser}
              onChange={(e) => setGateUser(e.target.value)}
              maxLength={32}
              placeholder="anon"
              autoComplete="username"
              required
              aria-describedby="room-gate-user-help"
            />
          </label>
          <p id="room-gate-user-help" className="field-help">
            Display name only — not a login or recovery identity.
          </p>
          <label htmlFor="room-gate-pass">
            Password (room key)
            <input
              id="room-gate-pass"
              type="password"
              value={gatePass}
              onChange={(e) => setGatePass(e.target.value)}
              placeholder="shared secret"
              autoComplete="current-password"
              required
              aria-describedby="room-gate-pass-help"
            />
          </label>
          <p id="room-gate-pass-help" className="field-help">
            {passphraseHint(gatePass)}. Same key for everyone or messages won&apos;t decrypt.
          </p>
          <button type="submit">Enter chatroom</button>
        </form>
        {status ? (
          <p className="e2ee-room__status" role="alert">
            {status}
          </p>
        ) : null}
        <p className="field-help">
          Host never sees plaintext. <Link href="/rooms">All rooms</Link> ·{' '}
          <Link href="/chat">Secret entrance</Link> · <Link href="/rooms/lobby">lobby</Link>
        </p>
      </div>
    );
  }

  const filterIds = ['all', 'media', 'chat'] as const;

  const copyRoomLink = useCallback(async () => {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : null;
      await navigator.clipboard.writeText(buildRoomShareUrl(roomId, origin));
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(false);
    }
  }, [roomId]);

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
            #{roomId} <span className="e2ee-room__you">as {session.username}</span>
          </h1>
        </div>
        <div className="e2ee-room__header-actions">
          <StatusBadge tone={storeDurable ? 'verified' : 'pending'}>
            {storeKind === 'file-local' ? 'file store' : 'memory store'}
          </StatusBadge>
          {maxMessagesPerRoom !== null ? (
            <StatusBadge
              tone={
                totalServer !== null && totalServer >= maxMessagesPerRoom ? 'pending' : 'neutral'
              }
            >
              {totalServer !== null
                ? `${totalServer}/${maxMessagesPerRoom} msgs`
                : `max ${maxMessagesPerRoom} msgs`}
            </StatusBadge>
          ) : null}
          <StatusBadge tone="neutral">no account</StatusBadge>
          <button
            type="button"
            className="e2ee-room__leave"
            onClick={() => void copyRoomLink()}
            aria-label={`Copy share link for room ${roomId}`}
          >
            {copiedLink ? 'Copied link' : 'Copy link'}
          </button>
          <button type="button" className="e2ee-room__leave" onClick={leave}>
            Leave
          </button>
        </div>
      </header>

      {storeNote ? (
        <p className="field-help" role="note" id="room-store-note">
          {storeNote}
          {totalServer !== null
            ? maxMessagesPerRoom !== null
              ? ` · ${totalServer}/${maxMessagesPerRoom} sealed on server (oldest dropped past cap).`
              : ` · ${totalServer} sealed on server (cap applies).`
            : maxMessagesPerRoom !== null
              ? ` · max ${maxMessagesPerRoom} sealed messages per room.`
              : null}
          {totalServer !== null && maxMessagesPerRoom !== null && totalServer >= maxMessagesPerRoom
            ? ' At limit — new sends keep the newest; older ciphertext may already be gone on this node.'
            : null}
        </p>
      ) : null}

      {wrongKeyCount > 0 ? (
        <div className="field-help" role="alert" aria-live="assertive">
          <p>
            {wrongKeyOnly > 0
              ? `${wrongKeyOnly} message${wrongKeyOnly === 1 ? '' : 's'} failed with wrong room key.`
              : `${wrongKeyCount} message${wrongKeyCount === 1 ? '' : 's'} failed to decrypt.`}{' '}
            Update the key if you joined with the wrong passphrase — leave only if you want a new
            display name.
          </p>
          {!rekeyOpen ? (
            <button type="button" onClick={() => setRekeyOpen(true)}>
              Update room key
            </button>
          ) : (
            <form onSubmit={applyRekey} aria-label="Update room key">
              <label htmlFor="room-rekey-pass">
                Correct room key
                <input
                  id="room-rekey-pass"
                  type="password"
                  value={rekeyPass}
                  onChange={(e) => setRekeyPass(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button type="submit">Re-decrypt</button>
              <button type="button" onClick={() => setRekeyOpen(false)}>
                Cancel
              </button>
            </form>
          )}
        </div>
      ) : null}

      {loadError ? (
        <p className="field-help" role="alert">
          {loadError}{' '}
          <button type="button" onClick={() => void load('full')}>
            Retry
          </button>
        </p>
      ) : null}
      {loading ? (
        <p className="field-help" role="status" aria-live="polite">
          Loading sealed messages…
        </p>
      ) : null}

      <div
        className="e2ee-room__filters"
        role="tablist"
        aria-label="Feed filter"
        onKeyDown={(e) => onFilterKeyDown(e, filterIds)}
      >
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
            id={`room-filter-${id}`}
            tabIndex={filter === id ? 0 : -1}
            aria-selected={filter === id}
            aria-controls="room-message-feed"
            className={filter === id ? 'is-active' : undefined}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {hasMoreOlder ? (
        <div className="e2ee-room__pagination">
          <button
            type="button"
            disabled={loadingOlder}
            onClick={() => void load('older')}
            aria-describedby="room-store-note"
          >
            {loadingOlder ? 'Loading older…' : 'Load older messages'}
          </button>
        </div>
      ) : null}

      <div
        id="room-arrival-live"
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {arrivalAnnouncement}
      </div>

      <ul
        id="room-message-feed"
        className="e2ee-room__feed"
        role="tabpanel"
        aria-labelledby={`room-filter-${filter}`}
        aria-busy={loading || loadingOlder}
        aria-label={`Messages in ${roomId}`}
      >
        {!loading && visible.length === 0 ? (
          <li className="e2ee-room__empty">No messages — say hi or drop a GIF.</li>
        ) : null}
        {visible.map((m) => (
          <li
            key={m.id}
            className="e2ee-card"
            data-kind={m.kind}
            aria-label={`Message from ${m.from}, ${m.kind}`}
          >
            <div className="e2ee-card__meta">
              <span className="e2ee-card__from">{m.from}</span>
              <span className="e2ee-card__kind">{m.kind}</span>
              <time dateTime={m.at}>{new Date(m.at).toLocaleString()}</time>
            </div>
            {m.error ? (
              <p className="e2ee-room__err" role="status">
                {m.error}
              </p>
            ) : null}
            {m.text ? <p className="e2ee-card__text">{m.text}</p> : null}
            {m.mediaUrl && (m.kind === 'image' || m.kind === 'gif') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.mediaUrl}
                alt={m.kind === 'gif' ? `GIF from ${m.from}` : `Image from ${m.from}`}
                className="e2ee-card__media"
                loading="lazy"
              />
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
                aria-label={`Video from ${m.from}`}
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
        <label htmlFor="room-compose-draft" className="visually-hidden">
          Message
        </label>
        <textarea
          id="room-compose-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Message (E2EE) — paste images OK"
          disabled={busy}
          aria-keyshortcuts="Enter"
          aria-describedby="room-compose-help"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendText();
            }
          }}
        />
        <p id="room-compose-help" className="visually-hidden">
          Enter to send. Shift+Enter for newline. Attachments seal with the room key.
        </p>
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
              aria-label="Attach image, GIF, or video"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void sendFile(f, draft);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {status ? (
          <p role="status" className="e2ee-room__status" aria-live="polite">
            {status}
          </p>
        ) : null}
        {dragOver ? (
          <p className="e2ee-room__drop" role="status">
            Drop to seal &amp; share
          </p>
        ) : null}
      </div>
    </div>
  );
}

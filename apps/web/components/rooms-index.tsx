'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import {
  buildRoomShareUrl,
  exportRoomsIndexJson,
  normalizeRoomId,
  summarizeRoomIndex,
} from '@/lib/room-client';

interface RoomRow {
  readonly roomId: string;
  readonly messageCount: number;
  readonly lastActivityAt?: string | null;
}

interface StoreMeta {
  readonly kind?: string;
  readonly multiReplicaSafe?: boolean;
  readonly durableAcrossRestart?: boolean;
  readonly label?: string;
  readonly note?: string;
  readonly maxMessagesPerRoom?: number;
}

interface E2eeMeta {
  readonly roomSealProtocol: string;
  readonly passphraseRooms: string;
  readonly pairwise: string;
  readonly serverReadableFallback: false;
  readonly privateByDefault: true;
  readonly ciphertextOnly: boolean;
  readonly hostReadsPlaintext: boolean;
  readonly durability: string;
  readonly note?: string;
}

type SortMode = 'activity' | 'name';

function formatActivity(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function sortRooms(rooms: readonly RoomRow[], mode: SortMode): RoomRow[] {
  const list = [...rooms];
  if (mode === 'name') {
    return list.sort((a, b) => a.roomId.localeCompare(b.roomId));
  }
  return list.sort((a, b) => {
    const at = a.lastActivityAt ?? '';
    const bt = b.lastActivityAt ?? '';
    if (at === bt) return a.roomId.localeCompare(b.roomId);
    if (!at) return 1;
    if (!bt) return -1;
    return bt.localeCompare(at);
  });
}

export function RoomsIndexClient() {
  const router = useRouter();
  const [rooms, setRooms] = useState<readonly RoomRow[]>([]);
  const [store, setStore] = useState<StoreMeta | null>(null);
  const [e2ee, setE2ee] = useState<E2eeMeta | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState('');
  const [jumpError, setJumpError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('activity');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchRoomsIndex, fetchE2eeStatus } = await import('@/lib/product-client');
      const [roomsResult, e2eeResult] = await Promise.all([fetchRoomsIndex(), fetchE2eeStatus()]);

      if (roomsResult.kind !== 'ok') {
        setError(roomsResult.message);
        setRooms([]);
        setStore(null);
      } else {
        const data = roomsResult.data;
        setRooms(data.rooms ?? []);
        setStore(data.store ?? null);
        setNote(data.store?.note ?? data.note ?? null);
      }

      if (e2eeResult.kind === 'ok') {
        const report = e2eeResult.data;
        setE2ee({
          roomSealProtocol: report.e2ee.roomSealProtocol,
          passphraseRooms: report.e2ee.passphraseRooms,
          pairwise: report.e2ee.pairwise,
          serverReadableFallback: report.e2ee.serverReadableFallback,
          privateByDefault: report.e2ee.privateByDefault,
          ciphertextOnly: report.rooms.ciphertextOnly,
          hostReadsPlaintext: report.rooms.hostReadsPlaintext,
          durability: report.rooms.durability,
          note: report.note,
        });
        // Prefer e2ee store meta when rooms index failed or omitted store.
        if (roomsResult.kind !== 'ok' || !roomsResult.data.store) {
          setStore(report.rooms.store ?? null);
        }
        if (roomsResult.kind === 'ok' && !roomsResult.data.store?.note && !roomsResult.data.note) {
          setNote(report.note ?? report.rooms.store?.note ?? null);
        }
      } else {
        setE2ee(null);
      }
    } catch {
      setError('Could not load room index.');
      setRooms([]);
      setStore(null);
      setE2ee(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedRooms = useMemo(() => sortRooms(rooms, sortMode), [rooms, sortMode]);
  const totals = useMemo(() => summarizeRoomIndex(rooms), [rooms]);

  const flashCopied = useCallback((key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((cur) => (cur === key ? null : cur));
    }, 2000);
  }, []);

  const copyRoomId = useCallback(
    async (roomId: string) => {
      try {
        await navigator.clipboard.writeText(roomId);
        flashCopied(`id:${roomId}`);
      } catch {
        setCopiedKey(null);
      }
    },
    [flashCopied],
  );

  const copyRoomUrl = useCallback(
    async (roomId: string) => {
      try {
        const origin = typeof window !== 'undefined' ? window.location.origin : null;
        const url = buildRoomShareUrl(roomId, origin);
        await navigator.clipboard.writeText(url);
        flashCopied(`url:${roomId}`);
      } catch {
        setCopiedKey(null);
      }
    },
    [flashCopied],
  );

  const downloadIndexJson = useCallback(() => {
    const body = exportRoomsIndexJson(rooms);
    const blob = new Blob([body], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wetdrool-rooms-index-${new Date().toISOString().slice(0, 10)}.json`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [rooms]);

  const durable = store?.durableAcrossRestart === true;
  const badgeLabel =
    store?.label ??
    (store?.kind === 'file-local'
      ? 'file · restart-durable · single node'
      : store?.kind === 'memory-ephemeral'
        ? 'memory · ephemeral · not multi-replica'
        : 'store unknown');
  const sealedTotal = rooms.reduce((sum, r) => sum + (r.messageCount || 0), 0);
  const roomCount = rooms.length;

  return (
    <div className="rooms-index">
      <div className="rooms-index__meta" aria-live="polite">
        <StatusBadge tone="neutral">
          {roomCount} room{roomCount === 1 ? '' : 's'} · {sealedTotal} sealed
        </StatusBadge>
        <StatusBadge tone={durable ? 'verified' : 'pending'}>
          {durable ? 'durable (single node)' : 'ephemeral'}
        </StatusBadge>
        <StatusBadge tone="neutral">{badgeLabel}</StatusBadge>
        {store?.multiReplicaSafe === false ? (
          <StatusBadge tone="pending">not multi-replica</StatusBadge>
        ) : null}
        {typeof store?.maxMessagesPerRoom === 'number' && store.maxMessagesPerRoom > 0 ? (
          <StatusBadge tone="neutral">max {store.maxMessagesPerRoom} msgs/room</StatusBadge>
        ) : null}
        {e2ee ? (
          <>
            <StatusBadge tone="verified">seal {e2ee.roomSealProtocol}</StatusBadge>
            <StatusBadge tone="pending">{e2ee.passphraseRooms}</StatusBadge>
            {e2ee.ciphertextOnly && !e2ee.hostReadsPlaintext ? (
              <StatusBadge tone="verified">ciphertext-only</StatusBadge>
            ) : (
              <StatusBadge tone="pending">plaintext risk</StatusBadge>
            )}
            <StatusBadge tone="neutral">pairwise {e2ee.pairwise}</StatusBadge>
          </>
        ) : null}
      </div>

      {e2ee ? (
        <p className="field-help" role="note" id="rooms-e2ee-status">
          Protocol <code>{e2ee.roomSealProtocol}</code>
          {e2ee.privateByDefault ? ' · private by default' : null}
          {e2ee.serverReadableFallback === false ? ' · no server plaintext fallback' : null}
          {' · '}
          {e2ee.durability}
          {e2ee.note ? ` · ${e2ee.note}` : null}
        </p>
      ) : null}

      {note && note !== e2ee?.note ? (
        <p className="field-help" role="note">
          {note}
        </p>
      ) : null}

      <form
        className="anon-entrance__jump"
        aria-label="Open a custom E2EE room"
        onSubmit={(e) => {
          e.preventDefault();
          const id = normalizeRoomId(jump);
          if (!id) {
            setJumpError('Room id: start with a letter/number, then a–z 0–9 _ - (2–63 chars).');
            return;
          }
          setJumpError(null);
          router.push(`/rooms/${id}`);
        }}
      >
        <label htmlFor="rooms-index-jump">
          Open room
          <input
            id="rooms-index-jump"
            value={jump}
            onChange={(e) => {
              setJump(e.target.value);
              setJumpError(null);
            }}
            placeholder="my-secret-room"
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-invalid={jumpError ? true : undefined}
            aria-describedby={
              jumpError ? 'rooms-index-jump-help rooms-index-jump-error' : 'rooms-index-jump-help'
            }
          />
        </label>
        <p id="rooms-index-jump-help" className="field-help">
          Share room URL + passphrase out of band. Wrong key → ciphertext stays sealed until you
          update the key in-room. Copy link never includes the room key.
        </p>
        {jumpError ? (
          <p id="rooms-index-jump-error" className="field-help" role="alert">
            {jumpError}
          </p>
        ) : null}
        <button type="submit">Go</button>
      </form>

      <nav aria-label="Featured rooms">
        <ul className="anon-entrance__rooms">
          {(
            [
              ['lobby', 'lobby'],
              ['shorts', 'shorts'],
              ['pride', 'pride'],
              ['afterdark', 'afterdark'],
            ] as const
          ).map(([id, label]) => (
            <li key={id}>
              <Link href={`/rooms/${id}`}>#{label}</Link>{' '}
              <button
                type="button"
                className="rooms-index__copy"
                onClick={() => void copyRoomUrl(id)}
                aria-label={`Copy link for room ${id}`}
              >
                {copiedKey === `url:${id}` ? 'Copied' : 'Copy link'}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="rooms-index-heading">
        <div className="rooms-index__heading-row">
          <div className="rooms-index__heading-title">
            <h2 id="rooms-index-heading">Known rooms</h2>
            {!loading && !error ? (
              <p
                id="rooms-index-totals"
                className="field-help rooms-index__totals"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {totals.roomCount === 0
                  ? '0 rooms · 0 sealed messages on this node'
                  : `${totals.roomCount} room${totals.roomCount === 1 ? '' : 's'} · ${totals.sealedMessageCount} sealed message${totals.sealedMessageCount === 1 ? '' : 's'} on this node`}
              </p>
            ) : null}
          </div>
          <div className="rooms-index__heading-actions">
            <div className="rooms-index__sort" role="group" aria-label="Sort rooms">
              <button
                type="button"
                aria-pressed={sortMode === 'activity'}
                className={sortMode === 'activity' ? 'is-active' : undefined}
                onClick={() => setSortMode('activity')}
              >
                Activity
              </button>
              <button
                type="button"
                aria-pressed={sortMode === 'name'}
                className={sortMode === 'name' ? 'is-active' : undefined}
                onClick={() => setSortMode('name')}
              >
                Name
              </button>
            </div>
            <button
              type="button"
              onClick={downloadIndexJson}
              disabled={loading || rooms.length === 0}
              aria-label="Export rooms index metadata as JSON (room id, counts, last activity only)"
            >
              Export index JSON
            </button>
            <button type="button" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="field-help" role="status" aria-live="polite">
            Loading room index…
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

        {!loading && !error && rooms.length === 0 ? (
          <p className="field-help" role="status">
            No sealed messages on this node yet. Open a room above and post ciphertext — it will
            appear here with a count and last activity.{' '}
            <Link href="/chat">Start from secret entrance</Link>
          </p>
        ) : null}

        {sortedRooms.length > 0 ? (
          <ul
            className="rooms-index__list"
            aria-label="Local room index"
            aria-describedby="rooms-index-totals"
            aria-busy={loading}
          >
            {sortedRooms.map((r) => (
              <li key={r.roomId} className="rooms-index__item">
                <Link href={`/rooms/${encodeURIComponent(r.roomId)}`}>#{r.roomId}</Link>
                <button
                  type="button"
                  className="rooms-index__copy"
                  onClick={() => void copyRoomUrl(r.roomId)}
                  aria-label={`Copy link for room ${r.roomId}`}
                >
                  {copiedKey === `url:${r.roomId}` ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  className="rooms-index__copy"
                  onClick={() => void copyRoomId(r.roomId)}
                  aria-label={`Copy room id ${r.roomId}`}
                >
                  {copiedKey === `id:${r.roomId}` ? 'Copied' : 'Copy id'}
                </button>
                <span className="field-help">
                  {' '}
                  · {r.messageCount} sealed
                  {r.lastActivityAt ? (
                    <>
                      {' '}
                      · last activity{' '}
                      <time dateTime={r.lastActivityAt}>{formatActivity(r.lastActivityAt)}</time>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <p className="field-help">
        <Link href="/chat">Secret entrance</Link> · host never receives your passphrase.
      </p>
    </div>
  );
}

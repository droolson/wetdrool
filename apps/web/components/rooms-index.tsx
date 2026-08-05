'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import { normalizeRoomId } from '@/lib/room-store';

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
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState('');
  const [jumpError, setJumpError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('activity');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchRoomsIndex } = await import('@/lib/product-client');
      const result = await fetchRoomsIndex();
      if (result.kind !== 'ok') {
        setError(result.message);
        setRooms([]);
        setStore(null);
        return;
      }
      const data = result.data;
      setRooms(data.rooms ?? []);
      setStore(data.store ?? null);
      setNote(data.store?.note ?? data.note ?? null);
    } catch {
      setError('Could not load room index.');
      setRooms([]);
      setStore(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedRooms = useMemo(() => sortRooms(rooms, sortMode), [rooms, sortMode]);

  const copyRoomId = useCallback(async (roomId: string) => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopiedId(roomId);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === roomId ? null : cur));
      }, 2000);
    } catch {
      // Clipboard may be blocked; leave UI quiet (no secrets).
      setCopiedId(null);
    }
  }, []);

  const durable = store?.durableAcrossRestart === true;
  const badgeLabel =
    store?.label ??
    (store?.kind === 'file-local'
      ? 'file · restart-durable · single node'
      : store?.kind === 'memory-ephemeral'
        ? 'memory · ephemeral · not multi-replica'
        : 'store unknown');

  return (
    <div className="rooms-index">
      <div className="rooms-index__meta" aria-live="polite">
        <StatusBadge tone={durable ? 'verified' : 'pending'}>
          {durable ? 'durable (single node)' : 'ephemeral'}
        </StatusBadge>
        <StatusBadge tone="neutral">{badgeLabel}</StatusBadge>
        {store?.multiReplicaSafe === false ? (
          <StatusBadge tone="pending">not multi-replica</StatusBadge>
        ) : null}
      </div>

      {note ? (
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
          Share room id + passphrase out of band. Wrong key → ciphertext stays sealed until you
          update the key in-room.
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
          <li>
            <Link href="/rooms/lobby">#lobby</Link>
          </li>
          <li>
            <Link href="/rooms/shorts">#shorts</Link>
          </li>
          <li>
            <Link href="/rooms/pride">#pride</Link>
          </li>
          <li>
            <Link href="/rooms/afterdark">#afterdark</Link>
          </li>
        </ul>
      </nav>

      <section aria-labelledby="rooms-index-heading">
        <div className="rooms-index__heading-row">
          <h2 id="rooms-index-heading">Known rooms</h2>
          <div className="rooms-index__heading-actions">
            <div
              className="rooms-index__sort"
              role="group"
              aria-label="Sort rooms"
            >
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
            appear here with a count and last activity.
          </p>
        ) : null}

        {sortedRooms.length > 0 ? (
          <ul className="rooms-index__list" aria-label="Local room index" aria-busy={loading}>
            {sortedRooms.map((r) => (
              <li key={r.roomId} className="rooms-index__item">
                <Link href={`/rooms/${encodeURIComponent(r.roomId)}`}>#{r.roomId}</Link>
                <button
                  type="button"
                  className="rooms-index__copy"
                  onClick={() => void copyRoomId(r.roomId)}
                  aria-label={`Copy room id ${r.roomId}`}
                >
                  {copiedId === r.roomId ? 'Copied' : 'Copy id'}
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

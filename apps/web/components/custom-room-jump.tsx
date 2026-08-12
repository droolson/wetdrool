'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import { normalizeRoomId } from '@/lib/room-client';

export function CustomRoomJumpClient() {
  const router = useRouter();
  const [room, setRoom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<
    readonly { roomId: string; messageCount: number; lastActivityAt?: string | null }[]
  >([]);
  const [indexLoading, setIndexLoading] = useState(true);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [storeNote, setStoreNote] = useState<string | null>(null);
  const [storeDurable, setStoreDurable] = useState<boolean | null>(null);
  const [storeLabel, setStoreLabel] = useState<string | null>(null);

  const loadIndex = useCallback(async () => {
    setIndexLoading(true);
    setIndexError(null);
    try {
      const { fetchRoomsIndex } = await import('@/lib/product-client');
      const result = await fetchRoomsIndex();
      if (result.kind !== 'ok') {
        setIndexError(result.message);
        setRecent([]);
        return;
      }
      setRecent(result.data.rooms ?? []);
      setStoreNote(result.data.store?.note ?? result.data.note ?? null);
      setStoreDurable(
        typeof result.data.store?.durableAcrossRestart === 'boolean'
          ? result.data.store.durableAcrossRestart
          : null,
      );
      setStoreLabel(result.data.store?.label ?? null);
    } catch {
      setIndexError('Could not load room index.');
      setRecent([]);
    } finally {
      setIndexLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  return (
    <div className="anon-entrance__jump-wrap">
      <form
        className="anon-entrance__jump"
        aria-label="Open a custom E2EE room"
        onSubmit={(e) => {
          e.preventDefault();
          const id = normalizeRoomId(room);
          if (!id) {
            setError('Room id: start with a letter/number, then a–z 0–9 _ - (2–63 chars).');
            return;
          }
          setError(null);
          router.push(`/rooms/${id}`);
        }}
      >
        <label htmlFor="custom-room-id">
          Custom room
          <input
            id="custom-room-id"
            value={room}
            onChange={(e) => {
              setRoom(e.target.value);
              setError(null);
            }}
            placeholder="my-secret-room"
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'custom-room-help custom-room-error' : 'custom-room-help'}
          />
        </label>
        <p id="custom-room-help" className="field-help">
          Ciphertext-only room. Share the id + passphrase out of band. Wrong key → messages stay
          sealed until you update the key in-room.
        </p>
        {error ? (
          <p id="custom-room-error" className="field-help" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit">Go</button>
      </form>

      <div className="anon-entrance__recent" aria-live="polite">
        <p className="field-help">
          Rooms with ciphertext on this node
          {indexLoading ? ' · loading…' : null} <Link href="/rooms">Full index</Link>
        </p>
        {storeDurable !== null ? (
          <StatusBadge tone={storeDurable ? 'verified' : 'pending'}>
            {storeDurable ? 'durable (single node)' : 'ephemeral'}
          </StatusBadge>
        ) : null}
        {storeLabel ? <span className="field-help"> {storeLabel}</span> : null}
        {indexError ? (
          <p className="field-help" role="status">
            {indexError}{' '}
            <button type="button" onClick={() => void loadIndex()}>
              Retry
            </button>
          </p>
        ) : null}
        {storeNote ? <p className="field-help">{storeNote}</p> : null}
        {!indexLoading && !indexError && recent.length === 0 ? (
          <p className="field-help">No sealed messages stored here yet.</p>
        ) : null}
        {recent.length > 0 ? (
          <ul aria-label="Local room index">
            {recent.map((r) => (
              <li key={r.roomId}>
                <Link href={`/rooms/${encodeURIComponent(r.roomId)}`}>{r.roomId}</Link>
                <span className="field-help">
                  {' '}
                  · {r.messageCount} sealed
                  {r.lastActivityAt ? (
                    <>
                      {' '}
                      ·{' '}
                      <time dateTime={r.lastActivityAt}>
                        {new Date(r.lastActivityAt).toLocaleString()}
                      </time>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

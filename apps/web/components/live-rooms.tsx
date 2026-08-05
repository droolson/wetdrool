'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import { readAgeGate, readContentMode } from '@/lib/nsfw-mode';
import { LIVE_ROOMS, filterLiveRooms, type LiveRoom } from '@/lib/live-catalog';

const PAGE_SIZE = 2;

export function LiveRooms() {
  const [nsfw, setNsfw] = useState(false);
  const [rooms, setRooms] = useState<readonly LiveRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [synthetic, setSynthetic] = useState(true);

  useEffect(() => {
    const age = readAgeGate(window.localStorage).confirmed;
    const mode = readContentMode(window.localStorage);
    setNsfw(age && mode === 'nsfw');
  }, []);

  const loadPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const { fetchLiveRooms } = await import('@/lib/product-client');
        const result = await fetchLiveRooms({
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        if (result.kind === 'ok' && Array.isArray(result.data.rooms)) {
          setRooms((prev) => (append ? [...prev, ...result.data.rooms] : result.data.rooms));
          setSource('api');
          setNote(typeof result.data.note === 'string' ? result.data.note : null);
          setHasMore(Boolean(result.data.hasMore));
          setOffset(nextOffset + result.data.rooms.length);
          setSynthetic(result.data.synthetic !== false);
          if (!append && result.data.rooms.length === 0) {
            setRooms(LIVE_ROOMS);
            setSource('local');
            setHasMore(false);
            setError('Live catalog empty — showing local fixtures.');
            setNote('Offline/local catalog fallback. Join remains disabled.');
          }
        } else {
          if (!append) {
            setRooms(LIVE_ROOMS);
            setSource('local');
            setHasMore(false);
            setError(
              result.kind === 'error'
                ? result.message
                : 'Live catalog empty — showing local fixtures.',
            );
            setNote('Offline/local catalog fallback. Join remains disabled.');
          } else {
            setError(result.kind === 'error' ? result.message : 'Load more failed.');
          }
        }
      } catch {
        if (!append) {
          setRooms(LIVE_ROOMS);
          setSource('local');
          setHasMore(false);
          setError('Network error loading live catalog.');
          setNote('Offline/local catalog fallback. Join remains disabled.');
        } else {
          setError('Network error loading more rooms.');
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  const visible = filterLiveRooms(rooms, { nsfwAllowed: nsfw });

  return (
    <div className="live-app">
      <header className="live-app__header">
        <div>
          <p className="section-kicker">Live · 18+ Twitch energy</p>
          <h1>Rooms with receipts.</h1>
        </div>
        <StatusBadge tone={source === 'api' ? 'pending' : 'degraded'}>
          {loading
            ? 'loading'
            : source === 'api'
              ? synthetic
                ? 'api · synthetic'
                : 'api catalog'
              : 'local fallback'}
        </StatusBadge>
      </header>
      <p className="live-app__lede">
        Livestream cards for chat, reactions, and tips. No fake viewer counts. Media ingress and
        SFU wiring stay off until a reviewed pipeline exists. NSFW rooms require the global 18+
        toggle.
      </p>
      {error ? (
        <p className="field-help" role="status">
          {error}
        </p>
      ) : null}
      {note && source === 'api' ? <p className="field-help">{note}</p> : null}
      {!nsfw ? (
        <p className="field-help">
          SFW filter on — enable <strong>NSFW 18+</strong> in the header to list adult rooms.
        </p>
      ) : null}
      {loading ? (
        <p className="field-help" role="status">
          Loading live catalog…
        </p>
      ) : null}
      {!loading && visible.length === 0 ? (
        <p className="field-help" role="status">
          No rooms match your filters.
        </p>
      ) : null}
      <ul className="live-grid" aria-label="Live rooms" aria-busy={loading}>
        {visible.map((room) => (
          <li key={room.id}>
            <article className="live-room-card" data-nsfw={room.nsfw ? 'true' : 'false'}>
              <div className="live-room-card__preview" aria-hidden="true">
                <span className="live-room-card__dot" /> LIVE
              </div>
              <h2>{room.title}</h2>
              <p>
                <Link href={`/creator/${encodeURIComponent(room.host.replace(/^@/, ''))}`}>
                  {room.host}
                </Link>
              </p>
              <ul className="live-room-card__tags">
                {room.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p className="field-help">Viewers: {room.viewersHint} · tips staged · chat staged</p>
              <button type="button" disabled>
                Join (coming online)
              </button>
            </article>
          </li>
        ))}
      </ul>
      {source === 'api' && hasMore ? (
        <p>
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadPage(offset, true)}
          >
            {loadingMore ? 'Loading…' : 'Load more rooms'}
          </button>
        </p>
      ) : null}
      <p className="field-help">
        Private gifts and whisper chat target E2EE pairwise messaging when the web adapter is
        wired. Operator seat: Swiss foundation (planned). Catalog:{' '}
        <code>/api/v1/live</code>.
      </p>
    </div>
  );
}

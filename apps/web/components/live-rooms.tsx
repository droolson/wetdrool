'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import { readAgeGate, readContentMode } from '@/lib/nsfw-mode';
import { LIVE_ROOMS, filterLiveRooms, type LiveRoom } from '@/lib/live-catalog';

export function LiveRooms() {
  const [nsfw, setNsfw] = useState(false);
  const [rooms, setRooms] = useState<readonly LiveRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const age = readAgeGate(window.localStorage).confirmed;
    const mode = readContentMode(window.localStorage);
    setNsfw(age && mode === 'nsfw');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const { fetchLiveRooms } = await import('@/lib/product-client');
      const result = await fetchLiveRooms();
      if (cancelled) return;
      if (result.kind === 'ok' && Array.isArray(result.data.rooms) && result.data.rooms.length > 0) {
        setRooms(result.data.rooms);
        setSource('api');
        setNote(typeof result.data.note === 'string' ? result.data.note : null);
      } else {
        setRooms(LIVE_ROOMS);
        setSource('local');
        setError(
          result.kind === 'error'
            ? result.message
            : 'Live catalog empty — showing local fixtures.',
        );
        setNote('Offline/local catalog fallback. Join remains disabled.');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = filterLiveRooms(rooms, { nsfwAllowed: nsfw });

  return (
    <div className="live-app">
      <header className="live-app__header">
        <div>
          <p className="section-kicker">Live · 18+ Twitch energy</p>
          <h1>Rooms with receipts.</h1>
        </div>
        <StatusBadge tone={source === 'api' ? 'pending' : 'degraded'}>
          {loading ? 'loading' : source === 'api' ? 'api catalog' : 'local fallback'}
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
      <p className="field-help">
        Private gifts and whisper chat target E2EE pairwise messaging when the web adapter is
        wired. Operator seat: Swiss foundation (planned). Catalog:{' '}
        <code>/api/v1/live</code>.
      </p>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import { readAgeGate, readContentMode } from '@/lib/nsfw-mode';

interface LiveRoom {
  readonly id: string;
  readonly title: string;
  readonly host: string;
  readonly nsfw: boolean;
  readonly tags: readonly string[];
  readonly viewersHint: string;
  readonly status: 'staged';
}

const ROOMS: readonly LiveRoom[] = [
  {
    id: 'room-pride-desk',
    title: 'Pride desk · soft stream',
    host: '@violetwave',
    nsfw: true,
    tags: ['pride', 'trans', 'chat'],
    viewersHint: 'staged',
    status: 'staged',
  },
  {
    id: 'room-femboy-lofi',
    title: 'Femboy lofi hours',
    host: '@neonangel',
    nsfw: true,
    tags: ['femboy', 'lofi', 'tips'],
    viewersHint: 'staged',
    status: 'staged',
  },
  {
    id: 'room-sfw-dev',
    title: 'Build-in-public (SFW)',
    host: '@droolhouse',
    nsfw: false,
    tags: ['sfw', 'dev', 'mesh'],
    viewersHint: 'staged',
    status: 'staged',
  },
  {
    id: 'room-straight-after',
    title: 'After dark lounge',
    host: '@nightshift',
    nsfw: true,
    tags: ['straight', 'lounge'],
    viewersHint: 'staged',
    status: 'staged',
  },
];

export function LiveRooms() {
  const [nsfw, setNsfw] = useState(false);

  useEffect(() => {
    const age = readAgeGate(window.localStorage).confirmed;
    const mode = readContentMode(window.localStorage);
    setNsfw(age && mode === 'nsfw');
  }, []);

  const visible = ROOMS.filter((r) => (nsfw ? true : !r.nsfw));

  return (
    <div className="live-app">
      <header className="live-app__header">
        <div>
          <p className="section-kicker">Live · 18+ Twitch energy</p>
          <h1>Rooms with receipts.</h1>
        </div>
        <StatusBadge tone="degraded">streams staged</StatusBadge>
      </header>
      <p className="live-app__lede">
        Livestream cards for chat, reactions, and tips. No fake viewer counts. Media ingress and
        SFU wiring stay off until a reviewed pipeline exists. NSFW rooms require the global 18+
        toggle.
      </p>
      {!nsfw ? (
        <p className="field-help">
          SFW filter on — enable <strong>NSFW 18+</strong> in the header to list adult rooms.
        </p>
      ) : null}
      <ul className="live-grid" aria-label="Live rooms">
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
        wired. Operator seat: Swiss foundation (planned).
      </p>
    </div>
  );
}

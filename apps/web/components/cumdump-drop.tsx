'use client';

import Link from 'next/link';

import { AgeGatePanel } from '@/components/age-gate-panel';
import { CUMDUMP_MEDIA_SRC } from '@/lib/short-feed';

/**
 * Founder-owned CUMDUMP music-video surface, gated by 18+ self-attest.
 */
export function CumdumpDrop() {
  return (
    <AgeGatePanel
      kicker="WetDrool · secret entrance · founder media"
      title="CUMDUMP · 18+"
      confirmLabel="I am 18+ · enter CUMDUMP"
      help={
        <p>
          Operator-owned artistic adult media. HAIL SATAN · <strong>EVIL</strong>. Not scraped.
        </p>
      }
    >
      <main className="evil-drop" data-theme="evil">
        <div className="evil-drop__veil" aria-hidden="true" />
        <header className="evil-drop__header">
          <p className="evil-drop__kicker">WetDrool · secret entrance · founder media</p>
          <h1 className="evil-drop__title">
            <span className="evil-drop__hail">HAIL SATAN</span>
            <span className="evil-drop__sep" aria-hidden="true">
              ·
            </span>
            <span className="evil-drop__evil">EVIL</span>
          </h1>
          <p className="evil-drop__sub">
            <strong>CUMDUMP</strong> — slut-energy music video. Operator-owned. Not scraped. Not a
            third-party tube mirror.
          </p>
        </header>

        <section className="evil-drop__stage" aria-labelledby="cumdump-player-label">
          <h2 id="cumdump-player-label" className="visually-hidden">
            CUMDUMP player
          </h2>
          <div className="evil-drop__frame">
            <video
              className="evil-drop__video"
              src={CUMDUMP_MEDIA_SRC}
              controls
              playsInline
              preload="metadata"
              poster=""
            >
              Your browser does not support WebM playback.
            </video>
          </div>
          <p className="evil-drop__meta">
            Format WebM · path <code>{CUMDUMP_MEDIA_SRC}</code> · 18+ self-attest · illegal content
            banned
          </p>
        </section>

        <section className="evil-drop__copy" aria-label="Drop notes">
          <ul>
            <li>
              <strong>HAIL SATAN · EVIL</strong> — product aesthetic, not a third-party creed claim.
            </li>
            <li>Rights: founder / operator owned media for WetDrool product surface.</li>
            <li>
              Third-party adult media still requires consent + licensing pipeline before it ships.
            </li>
            <li>
              Pre-release: local/static delivery only — not a CDN, not a mint, not $DROOL (does not
              exist).
            </li>
          </ul>
        </section>

        <nav className="evil-drop__nav" aria-label="Related surfaces">
          <Link href="/feeds">← Shorts feed</Link>
          <Link href="/hub">Hub</Link>
          <Link href="/rooms/lobby">E2EE rooms</Link>
          <Link href="/market">Marketplace</Link>
          <Link href="/video">Video surface</Link>
        </nav>
      </main>
    </AgeGatePanel>
  );
}

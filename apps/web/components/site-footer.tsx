import Link from 'next/link';
import { BrandMark } from '@wetdrool/ui';

/** Compact app footer — not a marketing sitemap. */
export function SiteFooter() {
  return (
    <footer className="site-footer site-footer--app">
      <div className="site-footer__inner">
        <div className="site-footer__statement">
          <BrandMark compact />
          <p>18+ product app · portable identity · fail-closed honesty</p>
        </div>
        <nav aria-label="App footer">
          <Link href="/hub">Hub</Link>
          <Link href="/feeds">Shorts</Link>
          <Link href="/live">Live</Link>
          <Link href="/home">Social</Link>
          <Link href="/compose">Compose</Link>
          <Link href="/token">Economy</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/safety">Safety</Link>
          <Link href="/settings">Settings</Link>
        </nav>
      </div>
      <div className="site-footer__fine-print">
        <p>
          Synthetic media fixtures until licensed pipelines land. No WetDrool token exists. Mesh is
          not production. CSAM banned.
        </p>
        <p>© {new Date().getUTCFullYear()} WetDrool</p>
      </div>
    </footer>
  );
}

import Link from 'next/link';
import { BrandMark } from '@wokesocial/ui';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__statement">
          <BrandMark />
          <p>
            A social network designed for portable identity, safer conversation, and algorithms you
            can question.
          </p>
        </div>
        <nav aria-label="Footer navigation">
          <div>
            <h2>Understand</h2>
            <Link href="/about">Principles</Link>
            <Link href="/protocol">Protocol</Link>
            <Link href="/safety">Safety</Link>
          </div>
          <div>
            <h2>Operate</h2>
            <Link href="/settings/providers">Providers</Link>
            <Link href="/home">Network feed</Link>
            <Link href="/compose">Local composer</Link>
          </div>
          <div>
            <h2>Participate</h2>
            <Link href="/explore">Explore</Link>
            <Link href="/feeds">Feeds</Link>
            <Link href="/communities">Communities</Link>
            <Link href="/signin">Sign in</Link>
          </div>
          <div>
            <h2>Build</h2>
            <Link href="/developers">Developers</Link>
            <Link href="/status">Status</Link>
            <Link href="/settings/export">Export</Link>
          </div>
        </nav>
      </div>
      <div className="site-footer__fine-print">
        <p>
          Foundation preview. Protocol publishing, wallet actions, and production claims remain
          disabled until their verification gates pass.
        </p>
        <p>© {new Date().getUTCFullYear()} WokeSocial</p>
      </div>
    </footer>
  );
}

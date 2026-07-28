import Link from 'next/link';
import { BrandMark, ButtonLink } from '@socially-woke/ui';

import { ThemePicker } from './theme-picker';

const PRIMARY_LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/explore', label: 'Explore' },
  { href: '/feeds', label: 'Feeds' },
  { href: '/communities', label: 'Communities' },
  { href: '/search', label: 'Search' },
] as const;

const MOBILE_LINKS = [
  ...PRIMARY_LINKS,
  { href: '/notifications', label: 'Notifications' },
  { href: '/messages', label: 'Messages' },
  { href: '/stories', label: 'Stories' },
  { href: '/video', label: 'Video' },
  { href: '/events', label: 'Events' },
  { href: '/settings', label: 'Settings' },
  { href: '/recovery', label: 'Recovery' },
  { href: '/developers', label: 'Developers' },
  { href: '/status', label: 'Status' },
  { href: '/about', label: 'About' },
  { href: '/protocol', label: 'Protocol' },
  { href: '/safety', label: 'Safety' },
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="site-header__brand" href="/" aria-label="Socially Woke home">
          <BrandMark />
        </Link>

        <nav className="desktop-nav" aria-label="Primary navigation">
          <ul>
            {PRIMARY_LINKS.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-header__actions">
          <div className="site-header__theme">
            <ThemePicker />
          </div>
          <ButtonLink href="/signin" variant="quiet">
            Sign in
          </ButtonLink>
          <ButtonLink href="/compose">Compose</ButtonLink>
        </div>

        <details className="mobile-menu">
          <summary aria-label="Open navigation">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </summary>
          <nav aria-label="Mobile navigation">
            <ul>
              {MOBILE_LINKS.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
            <div className="mobile-menu__footer">
              <ThemePicker />
              <ButtonLink href="/signin" variant="secondary">
                Sign in
              </ButtonLink>
            </div>
          </nav>
        </details>
      </div>
    </header>
  );
}

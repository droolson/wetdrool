import Link from 'next/link';
import { BrandMark, ButtonLink } from '@wetdrool/ui';

import { NsfwModeToggle } from './nsfw-mode-toggle';
import { ThemePicker } from './theme-picker';

const PRIMARY_LINKS = [
  { href: '/hub', label: 'Hub' },
  { href: '/feeds', label: 'Shorts' },
  { href: '/live', label: 'Live' },
  { href: '/home', label: 'Social' },
  { href: '/creators', label: 'Creators' },
  { href: '/messages', label: 'Private' },
  { href: '/rooms/lobby', label: 'E2EE' },
  { href: '/market', label: 'Market' },
  { href: '/token', label: 'Economy' },
  { href: '/fame', label: 'Fame' },
  { href: '/docs', label: 'Docs' },
] as const;

const MOBILE_LINKS = [
  ...PRIMARY_LINKS,
  { href: '/home', label: 'Network feed' },
  { href: '/companions', label: 'Companions' },
  { href: '/vanity', label: 'Vanity .drool' },
  { href: '/settings', label: 'Settings' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/mesh', label: 'Mesh' },
  { href: '/safety', label: 'Safety' },
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="site-header__brand" href="/" aria-label="WetDrool home">
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
          <NsfwModeToggle />
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

import Link from 'next/link';

const DOCK_LINKS = [
  { glyph: 'H', href: '/home', label: 'Home' },
  { glyph: 'E', href: '/explore', label: 'Explore' },
  { glyph: '+', href: '/compose', label: 'Compose', primary: true },
  { glyph: 'N', href: '/notifications', label: 'Notifications' },
  { glyph: 'M', href: '/messages', label: 'Messages' },
] as const;

export function MobileDock() {
  return (
    <nav className="mobile-dock" aria-label="Mobile app navigation">
      <ul>
        {DOCK_LINKS.map((item) => (
          <li key={item.href}>
            <Link
              className={'primary' in item && item.primary ? 'mobile-dock__primary' : undefined}
              href={item.href}
            >
              <span aria-hidden="true">{item.glyph}</span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

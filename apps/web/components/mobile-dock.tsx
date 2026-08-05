import Link from 'next/link';

const DOCK_LINKS = [
  { glyph: '▣', href: '/hub', label: 'Hub' },
  { glyph: '▶', href: '/feeds', label: 'Shorts' },
  { glyph: '+', href: '/compose', label: 'Post', primary: true },
  { glyph: '◉', href: '/live', label: 'Live' },
  { glyph: '◆', href: '/creators', label: 'Creators' },
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

import Link from 'next/link';

const SETTINGS_LINKS = [
  { href: '/settings', label: 'Overview' },
  { href: '/settings/privacy', label: 'Privacy' },
  { href: '/settings/safety', label: 'Safety' },
  { href: '/settings/blocks', label: 'Local blocks' },
  { href: '/settings/reports', label: 'Reports' },
  { href: '/settings/devices', label: 'Devices' },
  { href: '/settings/delegations', label: 'Delegations' },
  { href: '/settings/wallet', label: 'Wallet' },
  { href: '/settings/storage', label: 'Storage' },
  { href: '/settings/providers', label: 'Providers' },
  { href: '/settings/export', label: 'Export' },
  { href: '/settings/migration', label: 'Migration' },
  { href: '/settings/delete', label: 'Delete' },
] as const;

export function SettingsNav() {
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      <ul>
        {SETTINGS_LINKS.map((item) => (
          <li key={item.href}>
            <Link href={item.href}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

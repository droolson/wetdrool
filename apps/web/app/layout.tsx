import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@wetdrool/ui/styles.css';

import { ConnectivityNotice } from '@/components/connectivity-notice';
import { GrokChatDock } from '@/components/grok-chat-dock';
import { MobileDock } from '@/components/mobile-dock';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { CANONICAL_ORIGIN } from '@/lib/canonical-host';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_ORIGIN),
  title: {
    default: 'WetDrool — Get freaky. Own your keys.',
    template: '%s · WetDrool',
  },
  description:
    '18+ creator-owned social platform with portable identity, passkey accounts, livestream discovery, private rooms, AI companions, and fail-closed commerce.',
  openGraph: {
    description:
      'Euphoric 18+ social. Portable identity. AI companions. Points that never outrun ads.',
    siteName: 'WetDrool',
    title: 'WetDrool — Get freaky. Own your keys.',
    type: 'website',
  },
  robots: {
    follow: true,
    index: true,
  },
};

export const viewport: Viewport = {
  colorScheme: 'dark light',
  themeColor: [
    { color: '#0a0a0b', media: '(prefers-color-scheme: dark)' },
    { color: '#0a0a0b', media: '(prefers-color-scheme: light)' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="anytype-shell">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <SiteHeader />
        <ConnectivityNotice />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <MobileDock />
        <GrokChatDock />
        <SiteFooter />
      </body>
    </html>
  );
}

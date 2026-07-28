import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@wokesocial/ui/styles.css';

import { ConnectivityNotice } from '@/components/connectivity-notice';
import { MobileDock } from '@/components/mobile-dock';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { CANONICAL_ORIGIN } from '@/lib/canonical-host';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_ORIGIN),
  title: {
    default: 'WokeSocial — Own your voice',
    template: '%s · WokeSocial',
  },
  description:
    'A social network designed for portable identity, safer conversation, and algorithms people can question.',
  openGraph: {
    description: 'Portable identity. Safer conversation. Algorithms people can question.',
    siteName: 'WokeSocial',
    title: 'WokeSocial — Own your voice',
    type: 'website',
  },
  robots: {
    follow: true,
    index: true,
  },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { color: '#f8f5ef', media: '(prefers-color-scheme: light)' },
    { color: '#151019', media: '(prefers-color-scheme: dark)' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <SiteHeader />
        <ConnectivityNotice />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <MobileDock />
        <SiteFooter />
      </body>
    </html>
  );
}

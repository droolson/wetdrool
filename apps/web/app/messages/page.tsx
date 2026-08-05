import type { Metadata } from 'next';

import { AppPageHeader } from '@/components/app-page-header';

import { MessagesE2eePanel } from './messages-e2ee-panel';

export const metadata: Metadata = {
  title: 'Messages',
  description: 'Private pairwise E2EE status from the product API — no simulated inbox.',
};

export default function MessagesPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader eyebrow="Private messages" title="Private by construction.">
        <p>
          Capability comes from <code className="inline-identifier">GET /api/v1/e2ee</code>. Pairwise
          DMs stay locked while the web client is not wired; passphrase rooms (alpha) live under{' '}
          <code className="inline-identifier">/rooms</code>. This page never invents an unread
          inbox.
        </p>
      </AppPageHeader>

      <MessagesE2eePanel />
    </div>
  );
}

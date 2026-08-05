import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { MeshStatusPanel } from '@/components/mesh-status-panel';

export const metadata: Metadata = {
  title: 'Mesh',
  description: 'Anytype/any-sync local-first mesh foundation status for WetDrool.',
};

export default function MeshPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">production mesh false</StatusBadge>}
        eyebrow="P2P plane"
        title="Local-first mesh · any-sync foundation"
      >
        <p>
          Content sync targets{' '}
          <a href="https://github.com/anyproto/any-sync" rel="noopener noreferrer">
            anyproto/any-sync
          </a>{' '}
          (Anytype stack). Contracts live in <code>@wetdrool/mesh</code>. Cloudflare + Vercel only
          host the HTTP shell — not peer state. Live product honesty is loaded from{' '}
          <code>/api/v1/mesh</code> below — never invented in the client.
        </p>
      </AppPageHeader>

      <MeshStatusPanel />

      <ul>
        <li>Local-first E2EE spaces (capability claim, not a deployed mesh)</li>
        <li>Fail-closed unconfigured transport</li>
        <li>Solana / DroolNet = identity + settlement, not private media</li>
        <li>18+ and CSAM ban still apply to mesh objects</li>
      </ul>
      <p>
        <Link href="/hub">Hub</Link> · <Link href="/messages">Private E2EE status</Link> ·{' '}
        <Link href="/status">System status</Link> · <Link href="/docs">Docs</Link>
      </p>
    </div>
  );
}

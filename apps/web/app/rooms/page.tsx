import type { Metadata } from 'next';

import { RoomsIndexClient } from '@/components/rooms-index';

export const metadata: Metadata = {
  title: 'E2EE rooms',
  description:
    'Ciphertext-only room index on this node. Shared passphrase E2EE — host never sees plaintext.',
  robots: { index: false, follow: false },
};

export default function RoomsIndexPage() {
  return (
    <div className="page-shell anon-entrance">
      <p className="section-kicker">Anon · E2EE</p>
      <h1>Rooms on this node</h1>
      <p>
        Local ciphertext bags only — room ids and sealed counts. Decrypt happens in your browser
        with the shared room key. Not a global directory; not multi-replica safe.
      </p>
      <RoomsIndexClient />
    </div>
  );
}

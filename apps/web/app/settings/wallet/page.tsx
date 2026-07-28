import type { Metadata } from 'next';

import { BoundarySurface } from '@/components/boundary-surface';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Wallet settings',
  description: 'Wallet connection boundaries without opening or simulating a wallet.',
};

export default function WalletSettingsPage() {
  return (
    <BoundarySurface
      cards={[
        {
          copy: 'Public profiles show chosen identity details, not a raw wallet address by default.',
          eyebrow: 'Presentation',
          footer: 'Keys stay backstage',
          title: 'A wallet is not a personality',
          tone: 'plum',
        },
        {
          copy: 'Every signature request displays the exact network, program, instruction, account changes, and fees.',
          eyebrow: 'Consent',
          footer: 'Human-readable review',
          title: 'Know what is being signed',
          tone: 'coral',
        },
        {
          copy: 'A transaction is successful only after finality and state re-read, not after a wallet popup closes.',
          eyebrow: 'Verification',
          footer: 'Receipts over animation',
          title: 'Confirmation is not finality',
          tone: 'sky',
        },
      ]}
      detail="No wallet adapter is loaded, no connection request is made, and no address is stored. Wallet controls remain absent until simulation and transaction verification are integrated."
      eyebrow="Wallet"
      intro="Wallets may prove authority or pay a compatible rail, but they should appear only when a decision genuinely needs them."
      navigation={<SettingsNav />}
      requirements={[
        { label: 'Wallet adapter', state: 'Not loaded' },
        { label: 'Transaction simulation', state: 'Not connected' },
        { label: 'Finalized state re-read', state: 'Not connected' },
      ]}
      stateTitle="No wallet was connected or prompted."
      title="Bring out the wallet only when it matters."
    />
  );
}

import type { Metadata } from 'next';

import { CumdumpDrop } from '@/components/cumdump-drop';

export const metadata: Metadata = {
  title: 'CUMDUMP · HAIL SATAN · EVIL',
  description:
    'Founder-owned WetDrool music-video drop. 18+ artistic adult surface — HAIL SATAN · EVIL.',
  robots: { index: false, follow: false },
};

/**
 * Dedicated music-video surface for the founder-owned CUMDUMP.webm drop.
 * 18+ self-attest gate required before player loads.
 */
export default function CumdumpDropPage() {
  return <CumdumpDrop />;
}

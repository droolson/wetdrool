import type { Metadata } from 'next';

import { E2eeRoomChat } from '@/components/e2ee-room-chat';

export const metadata: Metadata = {
  title: 'E2EE media room',
  description:
    'Private RedGIFs-class img/GIF/video + chat — middle-out sealed, host sees ciphertext only.',
};

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const safe = roomId.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64) || 'lobby';
  return (
    <div className="page-shell">
      <E2eeRoomChat roomId={safe} />
    </div>
  );
}

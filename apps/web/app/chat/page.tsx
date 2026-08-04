import type { Metadata } from 'next';
import Link from 'next/link';

import { CustomRoomJumpClient } from '@/components/custom-room-jump';

export const metadata: Metadata = {
  title: 'Secret entrance',
  description: 'Anon E2EE chatroom — username + password, no signup.',
  robots: { index: false, follow: false },
};

/** Secret entrance: username + password rooms without accounts. */
export default function SecretChatEntrancePage() {
  return (
    <div className="page-shell anon-entrance">
      <p className="section-kicker">Secret entrance</p>
      <h1>Anon E2EE chatroom</h1>
      <p>
        No signup. No email. Open a room, enter a <strong>username</strong> +{' '}
        <strong>password</strong> once. Password is the shared E2EE key. Img / GIF / video supported.
      </p>
      <ul className="anon-entrance__rooms">
        <li>
          <Link href="/rooms/lobby">#lobby</Link>
        </li>
        <li>
          <Link href="/rooms/shorts">#shorts</Link>
        </li>
        <li>
          <Link href="/rooms/pride">#pride</Link>
        </li>
        <li>
          <Link href="/rooms/afterdark">#afterdark</Link>
        </li>
      </ul>
      <CustomRoomJumpClient />
      <p className="field-help">
        Session is tab-only (<code>sessionStorage</code>). Close tab = leave. Host never gets your
        password.
      </p>
    </div>
  );
}

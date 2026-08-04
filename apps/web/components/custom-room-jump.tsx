'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CustomRoomJumpClient() {
  const router = useRouter();
  const [room, setRoom] = useState('');

  return (
    <form
      className="anon-entrance__jump"
      onSubmit={(e) => {
        e.preventDefault();
        const id = room
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '')
          .slice(0, 64);
        if (id) router.push(`/rooms/${id}`);
      }}
    >
      <label>
        Custom room
        <input
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="my-secret-room"
          maxLength={64}
          autoComplete="off"
        />
      </label>
      <button type="submit">Go</button>
    </form>
  );
}

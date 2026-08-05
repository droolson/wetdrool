'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { normalizeRoomId } from '@/lib/room-store';

export function CustomRoomJumpClient() {
  const router = useRouter();
  const [room, setRoom] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="anon-entrance__jump"
      onSubmit={(e) => {
        e.preventDefault();
        const id = normalizeRoomId(room);
        if (!id) {
          setError('Room id: start with a letter/number, then a–z 0–9 _ - (2–63 chars).');
          return;
        }
        setError(null);
        router.push(`/rooms/${id}`);
      }}
    >
      <label htmlFor="custom-room-id">
        Custom room
        <input
          id="custom-room-id"
          value={room}
          onChange={(e) => {
            setRoom(e.target.value);
            setError(null);
          }}
          placeholder="my-secret-room"
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'custom-room-error' : 'custom-room-help'}
        />
      </label>
      <p id="custom-room-help" className="field-help">
        Ciphertext-only room. Share the id + passphrase out of band.
      </p>
      {error ? (
        <p id="custom-room-error" className="field-help" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit">Go</button>
    </form>
  );
}

/** In-process ciphertext store (Vercel lambda memory). Prefer durable KV later. */

const g = globalThis;

function bag() {
  if (!g.__wetdroolOnionRooms) g.__wetdroolOnionRooms = new Map();
  return g.__wetdroolOnionRooms;
}

const MAX = 150;

export function listMessages(roomId) {
  return bag().get(roomId) || [];
}

export function appendMessage(roomId, envelope) {
  const prev = bag().get(roomId) || [];
  const next = [...prev, envelope].slice(-MAX);
  bag().set(roomId, next);
  return next.length;
}

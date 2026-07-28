'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

export function ClientReady({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const ready = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  return ready ? children : fallback;
}

function subscribe() {
  return () => undefined;
}

function getClientSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

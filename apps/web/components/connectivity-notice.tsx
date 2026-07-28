'use client';

import { useEffect, useState } from 'react';

export function ConnectivityNotice() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const update = () => setIsOnline(window.navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (isOnline !== false) {
    return null;
  }

  return (
    <aside className="connectivity-notice" role="status" aria-live="assertive">
      <span className="connectivity-notice__signal" aria-hidden="true" />
      <div>
        <strong>You’re offline.</strong>{' '}
        <span>
          This page stays readable, but live verification and publishing are paused until your
          connection returns.
        </span>
      </div>
    </aside>
  );
}

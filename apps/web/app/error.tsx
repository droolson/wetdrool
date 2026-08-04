'use client';

import { StatePanel } from '@wetdrool/ui';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page-shell narrow-shell">
      <StatePanel
        action={
          <button className="native-action" onClick={reset} type="button">
            Try this page again
          </button>
        }
        eyebrow="Page error"
        headingLevel={1}
        title="This view did not finish loading."
        tone="error"
      >
        <p>
          Your account and network data were not changed. Retry the view, or return later if the
          service remains unavailable.
        </p>
      </StatePanel>
    </div>
  );
}

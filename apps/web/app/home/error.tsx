'use client';

import { ButtonLink, StatePanel } from '@socially-woke/ui';

export default function HomeError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page-shell narrow-shell">
      <StatePanel
        action={
          <div className="state-actions">
            <button className="native-action" onClick={reset} type="button">
              Retry the feed
            </button>
            <ButtonLink href="/settings/providers" variant="secondary">
              Review providers
            </ButtonLink>
          </div>
        }
        eyebrow="Feed error"
        headingLevel={1}
        title="No network data was accepted."
        tone="error"
      >
        <p>
          The page failed before it could present a validated response. No transaction or account
          change was attempted.
        </p>
      </StatePanel>
    </div>
  );
}

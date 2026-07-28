import { StatePanel } from '@socially-woke/ui';

export default function HomeLoading() {
  return (
    <div className="home-page page-shell">
      <header className="app-page-header">
        <div>
          <p className="section-kicker">Your network</p>
          <h1>Checking the feed contract.</h1>
        </div>
      </header>
      <div className="home-layout">
        <div className="feed-column">
          <div className="skeleton-composer" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <StatePanel eyebrow="Indexer request" title="Waiting for a typed response" tone="loading">
            <p>
              No post is shown until the configured endpoint returns data that passes runtime
              validation.
            </p>
          </StatePanel>
        </div>
      </div>
    </div>
  );
}

import { StatePanel } from '@wetdrool/ui';

export default function Loading() {
  return (
    <div className="page-shell narrow-shell">
      <StatePanel
        eyebrow="Loading"
        headingLevel={1}
        title="Preparing a careful view"
        tone="loading"
      >
        <p>We’re assembling this page without inventing network state while you wait.</p>
      </StatePanel>
    </div>
  );
}

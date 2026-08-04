import { StatePanel } from '@wetdrool/ui';

export default function PostLoading() {
  return (
    <div className="page-shell narrow-shell">
      <StatePanel
        eyebrow="Post detail"
        headingLevel={1}
        title="Checking the indexer response"
        tone="loading"
      >
        <p>The post will appear only after its response matches the typed contract.</p>
      </StatePanel>
    </div>
  );
}

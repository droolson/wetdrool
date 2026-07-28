import { ButtonLink, StatePanel } from '@socially-woke/ui';

export default function NotFound() {
  return (
    <div className="page-shell narrow-shell">
      <StatePanel
        action={
          <ButtonLink href="/" variant="secondary">
            Return to Socially Woke
          </ButtonLink>
        }
        eyebrow="404"
        headingLevel={1}
        title="This page isn’t part of the conversation."
        tone="empty"
      >
        <p>
          The address may be incomplete, the content may have moved, or a compliant indexer may be
          honoring a deletion tombstone.
        </p>
      </StatePanel>
    </div>
  );
}

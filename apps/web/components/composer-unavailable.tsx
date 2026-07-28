import { ButtonLink } from '@wokesocial/ui';

export function ComposerUnavailable() {
  return (
    <section
      className="composer"
      aria-describedby="composer-explanation"
      aria-labelledby="composer-title"
    >
      <div className="composer__heading">
        <div>
          <p className="section-kicker">Create</p>
          <h2 id="composer-title">Say what matters.</h2>
        </div>
        <span className="foundation-label">SDK wiring pending</span>
      </div>

      <div className="composer__invitation">
        <p>
          Draft plain text, a content warning, media accessibility metadata, audience, permissions,
          and storage preference locally. Publication remains locked until every adapter can return
          a real receipt.
        </p>
        <ButtonLink href="/compose" variant="secondary">
          Open the local composer
        </ButtonLink>
      </div>

      <p className="composer__explanation" id="composer-explanation">
        The composer will not simulate an upload, signature, storage receipt, or transaction before
        the SDK and protocol path are verified.
      </p>
    </section>
  );
}

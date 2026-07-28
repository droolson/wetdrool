'use client';

import { useState } from 'react';
import { StatusBadge } from '@socially-woke/ui';

import { loadComposerDraft } from '@/lib/composer-draft';
import { createLocalDeviceExport, serializeLocalDeviceExport } from '@/lib/local-export';
import { loadDevicePreferences } from '@/lib/local-preferences';

import { ClientReady } from './client-ready';

export function LocalExportPanel() {
  return (
    <ClientReady
      fallback={
        <div className="local-settings-loading" role="status">
          Preparing the local export surface…
        </div>
      }
    >
      <HydratedLocalExport />
    </ClientReady>
  );
}

function HydratedLocalExport() {
  const [summary, setSummary] = useState(
    'No file has been prepared. Exporting does not contact an account or network service.',
  );

  function download() {
    const preferences = loadDevicePreferences(window.localStorage);
    const draft = loadComposerDraft(window.localStorage);
    const payload = serializeLocalDeviceExport(createLocalDeviceExport(preferences, draft));
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.download = 'socially-woke-device-export.json';
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    setSummary(
      `Downloaded local preferences${draft ? ' and one composer draft' : ''}. No identity, post history, relationships, messages, or protocol keys were included.`,
    );
  }

  return (
    <section className="local-export-panel" aria-labelledby="local-export-title">
      <div className="local-settings-panel__heading">
        <div>
          <p className="section-kicker">Available now</p>
          <h2 id="local-export-title">Export this browser’s small footprint.</h2>
        </div>
        <StatusBadge tone="neutral">JSON · local only</StatusBadge>
      </div>
      <p>
        The file contains versioned device preferences and the local composer draft, if one exists.
        It deliberately excludes anything this browser cannot substantiate.
      </p>
      <button className="native-action" onClick={download} type="button">
        Download local device export
      </button>
      <p aria-live="polite" className="local-settings-panel__status">
        {summary}
      </p>
    </section>
  );
}

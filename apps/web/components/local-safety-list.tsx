'use client';

import { useState, type FormEvent } from 'react';
import { StatusBadge } from '@wokesocial/ui';

import {
  addLocalSafetyEntry,
  loadDevicePreferences,
  removeLocalSafetyEntry,
  saveDevicePreferences,
  type LocalSafetyEntry,
  type LocalSafetyMode,
} from '@/lib/local-preferences';

import { ClientReady } from './client-ready';

export function LocalSafetyList() {
  return (
    <ClientReady
      fallback={
        <div className="local-settings-loading" role="status">
          Reading the local safety list…
        </div>
      }
    >
      <HydratedSafetyList />
    </ClientReady>
  );
}

function HydratedSafetyList() {
  const [preferences, setPreferences] = useState(() => loadDevicePreferences(window.localStorage));
  const [identifier, setIdentifier] = useState('');
  const [mode, setMode] = useState<LocalSafetyMode>('hide-from-feeds');
  const [message, setMessage] = useState(
    'Only exact public identity identifiers belong here. This list never contacts a service.',
  );

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = addLocalSafetyEntry(preferences, { identifier, mode });
    if (!next) {
      setMessage(
        'Enter a 3–180 character identity identifier without spaces or control characters.',
      );
      return;
    }
    if (!saveDevicePreferences(window.localStorage, next)) {
      setMessage('Browser storage is unavailable. No local safety entry was saved.');
      return;
    }
    setPreferences(next);
    setIdentifier('');
    setMessage(
      mode === 'hide-from-feeds'
        ? 'Saved locally. Matching identities are hidden from the connected home feed on this device.'
        : 'Saved locally. Live-signal muting will apply only after a compatible relay client is connected.',
    );
  }

  function remove(entry: LocalSafetyEntry) {
    const next = removeLocalSafetyEntry(preferences, entry);
    if (!saveDevicePreferences(window.localStorage, next)) {
      setMessage('Browser storage is unavailable. The local entry was not removed.');
      return;
    }
    setPreferences(next);
    setMessage('Removed from this device.');
  }

  return (
    <section className="local-safety-panel" aria-labelledby="local-safety-title">
      <div className="local-settings-panel__heading">
        <div>
          <p className="section-kicker">Local safety list</p>
          <h2 id="local-safety-title">A reversible boundary on this device.</h2>
        </div>
        <StatusBadge tone="neutral">Not a protocol block</StatusBadge>
      </div>

      <form onSubmit={add}>
        <div className="field-stack">
          <label htmlFor="safety-identity">Public identity identifier</label>
          <input
            autoComplete="off"
            id="safety-identity"
            maxLength={180}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="Exact identity ID"
            value={identifier}
          />
        </div>
        <div className="field-stack">
          <label htmlFor="safety-mode">Local action</label>
          <select
            id="safety-mode"
            onChange={(event) => setMode(event.target.value as LocalSafetyMode)}
            value={mode}
          >
            <option value="hide-from-feeds">Hide from local feeds</option>
            <option value="mute-live-signals">Mute future live signals</option>
          </select>
        </div>
        <button className="native-action" type="submit">
          Add local boundary
        </button>
      </form>

      <p aria-live="polite" className="local-settings-panel__status">
        {message}
      </p>

      {preferences.hiddenIdentifiers.length === 0 ? (
        <div className="local-safety-empty">
          <p>No identities are on this device’s local safety list.</p>
        </div>
      ) : (
        <ul className="local-safety-entries" aria-label="Saved local safety entries">
          {preferences.hiddenIdentifiers.map((entry) => (
            <li key={`${entry.mode}:${entry.identifier}`}>
              <div>
                <code>{entry.identifier}</code>
                <span>
                  {entry.mode === 'hide-from-feeds'
                    ? 'Hidden from local feeds'
                    : 'Future live signals muted'}
                </span>
              </div>
              <button onClick={() => remove(entry)} type="button">
                Remove
                <span className="visually-hidden"> {entry.identifier}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

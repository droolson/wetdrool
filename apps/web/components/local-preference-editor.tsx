'use client';

import { useState } from 'react';
import { StatusBadge } from '@wokesocial/ui';

import {
  createDefaultDevicePreferences,
  loadDevicePreferences,
  saveDevicePreferences,
  type DevicePreferences,
} from '@/lib/local-preferences';

import { ClientReady } from './client-ready';

type PreferenceKind = 'privacy' | 'safety';
type PrivacyKey = keyof DevicePreferences['privacy'];
type SafetyKey = keyof DevicePreferences['safety'];

const PRIVACY_FIELDS: readonly {
  copy: string;
  key: PrivacyKey;
  label: string;
}[] = [
  {
    copy: 'Keep live presence hidden when a compatible relay is eventually connected.',
    key: 'hidePresence',
    label: 'Hide my presence by default',
  },
  {
    copy: 'Do not send read receipts unless a future conversation explicitly opts in.',
    key: 'disableReadReceipts',
    label: 'Disable read receipts by default',
  },
  {
    copy: 'Ask discovery providers not to use this device for profile suggestions.',
    key: 'limitDiscovery',
    label: 'Limit discovery personalization',
  },
];

const SAFETY_FIELDS: readonly {
  copy: string;
  key: SafetyKey;
  label: string;
}[] = [
  {
    copy: 'Cover media carrying a compatible sensitive-content label until it is intentionally revealed.',
    key: 'blurSensitiveMedia',
    label: 'Blur labeled sensitive media',
  },
  {
    copy: 'Fold replies from identities outside the chosen graph behind a disclosure control.',
    key: 'collapseUnknownReplies',
    label: 'Collapse unknown replies',
  },
  {
    copy: 'Request still previews from live and short-form media providers on this device.',
    key: 'reduceLiveMotion',
    label: 'Reduce live media motion',
  },
];

export function LocalPreferenceEditor({ kind }: { kind: PreferenceKind }) {
  return (
    <ClientReady
      fallback={
        <div className="local-settings-loading" role="status">
          Reading this device’s preferences…
        </div>
      }
    >
      <HydratedPreferenceEditor kind={kind} />
    </ClientReady>
  );
}

function HydratedPreferenceEditor({ kind }: { kind: PreferenceKind }) {
  const [preferences, setPreferences] = useState(() => loadDevicePreferences(window.localStorage));
  const [status, setStatus] = useState<'changed' | 'error' | 'idle' | 'saved'>('idle');
  const fields = kind === 'privacy' ? PRIVACY_FIELDS : SAFETY_FIELDS;

  function update(key: PrivacyKey | SafetyKey, checked: boolean) {
    setPreferences((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        [key]: checked,
      },
    }));
    setStatus('changed');
  }

  function save() {
    setStatus(saveDevicePreferences(window.localStorage, preferences) ? 'saved' : 'error');
  }

  function restoreDefaults() {
    const defaults = createDefaultDevicePreferences();
    setPreferences((current) => ({ ...current, [kind]: defaults[kind] }));
    setStatus('changed');
  }

  return (
    <section className="local-settings-panel" aria-labelledby={`${kind}-local-title`}>
      <div className="local-settings-panel__heading">
        <div>
          <p className="section-kicker">Device-local controls</p>
          <h2 id={`${kind}-local-title`}>
            {kind === 'privacy' ? 'Private until you decide otherwise.' : 'Safer defaults, nearby.'}
          </h2>
        </div>
        <StatusBadge tone={status === 'saved' ? 'verified' : 'neutral'}>
          {status === 'saved' ? 'Saved locally' : 'This device only'}
        </StatusBadge>
      </div>

      <fieldset>
        <legend className="visually-hidden">
          {kind === 'privacy' ? 'Privacy preferences' : 'Safety preferences'}
        </legend>
        {fields.map((field) => {
          const checked =
            kind === 'privacy'
              ? preferences.privacy[field.key as PrivacyKey]
              : preferences.safety[field.key as SafetyKey];
          return (
            <label className="preference-toggle" key={field.key}>
              <input
                checked={checked}
                onChange={(event) => update(field.key, event.target.checked)}
                type="checkbox"
              />
              <span aria-hidden="true" />
              <span>
                <strong>{field.label}</strong>
                <small>{field.copy}</small>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="local-settings-panel__actions">
        <button className="native-action" onClick={save} type="button">
          Save on this device
        </button>
        <button className="text-action" onClick={restoreDefaults} type="button">
          Restore recommended defaults
        </button>
      </div>
      <p aria-live="polite" className="local-settings-panel__status">
        {status === 'saved'
          ? 'These preferences were saved in this browser.'
          : status === 'error'
            ? 'Browser storage is unavailable; the changes will last only while this page remains open.'
            : status === 'changed'
              ? 'Unsaved local changes.'
              : 'These settings are client preferences, not signed account state.'}
      </p>
    </section>
  );
}

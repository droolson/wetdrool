'use client';

import { ButtonLink } from '@wokesocial/ui';
import { useEffect, useMemo, useState } from 'react';

import { BrowserAuthClient, type BrowserAuthClientOptions } from '@/lib/auth/browser-auth-client';
import type { AuthSessionView, PasskeyCredentialView } from '@/lib/auth/auth-api';
import { BrowserAuthError } from '@/lib/auth/errors';

interface PasskeyAccessManagerProps {
  readonly authServiceUrl: string;
}

export function PasskeyAccessManager({ authServiceUrl }: PasskeyAccessManagerProps) {
  const [client, setClient] = useState<BrowserAuthClient>();
  const [session, setSession] = useState<AuthSessionView>();
  const [credentials, setCredentials] = useState<readonly PasskeyCredentialView[]>([]);
  const [confirming, setConfirming] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const activeCredentials = useMemo(
    () => credentials.filter((credential) => credential.revokedAt === undefined),
    [credentials],
  );

  useEffect(() => {
    let current = true;
    void initialize();
    return () => {
      current = false;
    };

    async function initialize() {
      setLoading(true);
      setError(undefined);
      setNotice(undefined);
      setCredentials([]);
      setConfirming(undefined);
      let next: BrowserAuthClient;
      try {
        const options: BrowserAuthClientOptions = { baseUrl: authServiceUrl };
        next = new BrowserAuthClient(options);
      } catch (caught) {
        if (current) {
          setError(safeAuthMessage(caught));
          setLoading(false);
        }
        return;
      }
      setClient(next);
      try {
        const activeSession = await next.session();
        if (!current) return;
        setSession(activeSession);
        if (activeSession !== undefined) {
          setCredentials(await next.listPasskeys());
        }
      } catch (caught) {
        if (current) setError(safeAuthMessage(caught));
      } finally {
        if (current) setLoading(false);
      }
    }
  }, [authServiceUrl]);

  const addPasskey = async () => {
    if (client === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setConfirming(undefined);
    try {
      const added = await client.addPasskeyForExistingRoot();
      setCredentials(await client.listPasskeys());
      setNotice(
        `Passkey ${abbreviate(added.credentialId)} was added with a new encrypted wrapper for the same local account root.`,
      );
    } catch (caught) {
      setError(safeAuthMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const revokePasskey = async (credentialId: string) => {
    if (client === undefined || busy || confirming !== credentialId) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await client.revokePasskey(credentialId);
      setCredentials([]);
      setSession(undefined);
      setConfirming(undefined);
      setNotice(
        'The passkey and its encrypted wrapper were revoked. The authentication service also ended every service session for this account.',
      );
    } catch (caught) {
      setError(safeAuthMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p className="passkey-auth__status" role="status">
        Checking the authentication service…
      </p>
    );
  }

  if (session === undefined) {
    return (
      <div className="passkey-access__empty">
        <p>
          No active authentication-service session is available in this browser. Sign in before
          listing or changing passkeys.
        </p>
        <ButtonLink href="/signin" variant="primary">
          Sign in with a passkey
        </ButtonLink>
        {notice === undefined ? null : (
          <p className="passkey-auth__status" role="status">
            {notice}
          </p>
        )}
        {error === undefined ? null : (
          <p className="passkey-auth__error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="passkey-access" aria-busy={busy}>
      <div className="passkey-access__heading">
        <div>
          <p className="section-kicker">Authentication-service provenance</p>
          <h2>Passkeys for this service account</h2>
          <p className="passkey-auth__status">
            Account <span className="inline-identifier">{session.accountId}</span>. Activity dates
            below come only from the configured authentication service.
          </p>
        </div>
        <button
          className="passkey-auth__primary"
          disabled={client === undefined || busy}
          onClick={addPasskey}
          type="button"
        >
          {busy ? 'Waiting for passkey…' : 'Add another passkey'}
        </button>
      </div>

      {credentials.length === 0 ? (
        <p className="passkey-auth__status">
          The service returned no credential records for this account.
        </p>
      ) : (
        <ul className="passkey-access__list" aria-label="Authentication-service passkeys">
          {credentials.map((credential, index) => {
            const active = credential.revokedAt === undefined;
            const isConfirming = confirming === credential.credentialId;
            const lastActive = active && activeCredentials.length <= 1;
            return (
              <li key={credential.credentialId}>
                <div className="passkey-access__credential">
                  <div>
                    <span className="passkey-access__ordinal" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <strong>{credentialLabel(credential)}</strong>
                      <span className="inline-identifier">
                        {abbreviate(credential.credentialId)}
                      </span>
                    </div>
                  </div>
                  <dl>
                    <div>
                      <dt>Created</dt>
                      <dd>{formatDate(credential.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Last verified</dt>
                      <dd>
                        {credential.lastUsedAt === undefined
                          ? 'Not reported'
                          : formatDate(credential.lastUsedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{active ? 'Active' : `Revoked ${formatDate(credential.revokedAt)}`}</dd>
                    </div>
                  </dl>
                </div>

                {!active ? null : isConfirming ? (
                  <div className="passkey-access__confirmation">
                    <p>
                      Confirm after a fresh passkey check. This revokes the selected credential and
                      ends every authentication-service session for the account.
                    </p>
                    <div>
                      <button
                        className="passkey-auth__secondary"
                        disabled={busy}
                        onClick={() => setConfirming(undefined)}
                        type="button"
                      >
                        Keep passkey
                      </button>
                      <button
                        className="passkey-access__danger"
                        disabled={busy}
                        onClick={() => void revokePasskey(credential.credentialId)}
                        type="button"
                      >
                        {busy ? 'Verifying…' : 'Verify and revoke'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="passkey-auth__secondary"
                    disabled={busy || lastActive}
                    onClick={() => setConfirming(credential.credentialId)}
                    title={
                      lastActive
                        ? 'The final passkey cannot be revoked until a reviewed recovery path exists.'
                        : undefined
                    }
                    type="button"
                  >
                    {lastActive ? 'Last passkey protected' : 'Revoke passkey'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {notice === undefined ? null : (
        <p className="passkey-auth__status" role="status">
          {notice}
        </p>
      )}
      {error === undefined ? null : (
        <p className="passkey-auth__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function credentialLabel(credential: PasskeyCredentialView): string {
  const location = credential.deviceType === 'multiDevice' ? 'Synced passkey' : 'Device passkey';
  return credential.backedUp ? `${location} · backed up` : location;
}

function safeAuthMessage(error: unknown): string {
  if (error instanceof BrowserAuthError) return error.message;
  return 'The passkey operation stopped safely before the requested change was completed.';
}

function abbreviate(value: string): string {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

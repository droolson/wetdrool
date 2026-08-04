'use client';

import { deriveRandomWokeName } from '@wetdrool/protocol';
import { ButtonLink } from '@wetdrool/ui';
import bs58 from 'bs58';
import { useEffect, useState } from 'react';

import {
  BrowserAuthClient,
  type BrowserAuthFlowResult,
  type EmbeddedKeyFallbackReason,
} from '@/lib/auth/browser-auth-client';
import type { AuthSessionView } from '@/lib/auth/auth-api';
import { decodeBase64Url } from '@/lib/auth/passkey-codec';
import { BrowserAuthError } from '@/lib/auth/errors';

interface PasskeyAuthPanelProps {
  readonly authServiceUrl: string;
  readonly mode: 'register' | 'signin';
}

interface VisibleSession {
  readonly accountId: string;
  readonly expiresAt?: string;
}

export function PasskeyAuthPanel({ authServiceUrl, mode }: PasskeyAuthPanelProps) {
  const [client, setClient] = useState<BrowserAuthClient>();
  const [checkingSession, setCheckingSession] = useState(true);
  const [session, setSession] = useState<VisibleSession>();
  const [result, setResult] = useState<BrowserAuthFlowResult>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    void initialize();

    return () => {
      current = false;
    };

    async function initialize() {
      await Promise.resolve();
      if (!current) return;
      setClient(undefined);
      setCheckingSession(true);
      setSession(undefined);
      setResult(undefined);
      setNotice(undefined);
      setError(undefined);

      let next: BrowserAuthClient;
      try {
        next = new BrowserAuthClient({ baseUrl: authServiceUrl });
      } catch (caught) {
        setError(safeAuthMessage(caught));
        setCheckingSession(false);
        return;
      }

      setClient(next);
      try {
        const activeSession = await next.session();
        if (!current) return;
        setSession(toVisibleSession(activeSession));
        setNotice(
          activeSession === undefined
            ? 'No active authentication-service session was found in this browser.'
            : 'An authentication-service session is active in this browser.',
        );
      } catch (caught) {
        if (current) setError(safeAuthMessage(caught));
      } finally {
        if (current) setCheckingSession(false);
      }
    }
  }, [authServiceUrl]);

  const authenticate = async () => {
    if (client === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setResult(undefined);
    try {
      const completed = mode === 'register' ? await client.register() : await client.signIn();
      setResult(completed);
      setSession({ accountId: completed.accountId });
      setNotice(
        completed.key.status === 'ready'
          ? mode === 'register'
            ? 'The passkey credential and ciphertext-only key wrapper were committed together.'
            : 'Passkey authentication completed and the synchronized key was checked locally.'
          : 'Passkey authentication completed, but embedded signing remains unavailable.',
      );
      void refreshSession(client, setSession);
    } catch (caught) {
      setError(safeAuthMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (client === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await client.logout();
      setSession(undefined);
      setResult(undefined);
      setNotice('The authentication-service session was closed in this browser.');
    } catch (caught) {
      setError(safeAuthMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const hasSession = session !== undefined;
  const registrationBlocked = mode === 'register' && hasSession;
  const primaryLabel =
    mode === 'register'
      ? 'Create a passkey account'
      : hasSession
        ? 'Verify passkey and open local key'
        : 'Sign in with a passkey';
  const descriptionId = `passkey-${mode}-description`;

  return (
    <div className="passkey-auth" aria-busy={busy}>
      <div className="passkey-auth__method">
        <span aria-hidden="true">01</span>
        <div>
          <strong>{mode === 'register' ? 'User-verifying passkey' : 'Discoverable passkey'}</strong>
          <p id={descriptionId}>
            A user-verifying WebAuthn ceremony authenticates the service account. Any PRF output is
            used only inside this browser and is removed from the response sent to the service.
          </p>
        </div>
      </div>

      {checkingSession ? (
        <p className="passkey-auth__status" role="status">
          Checking for an existing service session…
        </p>
      ) : null}

      {session === undefined ? null : (
        <dl className="passkey-auth__session">
          <div>
            <dt>Service account</dt>
            <dd className="inline-identifier">{session.accountId}</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>
              {session.expiresAt === undefined
                ? 'Active'
                : `Active until ${formatDate(session.expiresAt)}`}
            </dd>
          </div>
          <div>
            <dt>Protocol identity</dt>
            <dd>Not created</dd>
          </div>
        </dl>
      )}

      {registrationBlocked ? (
        <p className="passkey-auth__status">
          Sign out before creating a different authentication-service account.
        </p>
      ) : (
        <button
          aria-describedby={descriptionId}
          className="passkey-auth__primary"
          disabled={client === undefined || busy}
          onClick={authenticate}
          type="button"
        >
          {busy ? 'Waiting for passkey…' : primaryLabel}
        </button>
      )}

      {hasSession ? (
        <button
          className="passkey-auth__secondary"
          disabled={client === undefined || busy}
          onClick={logout}
          type="button"
        >
          Sign out of service session
        </button>
      ) : null}

      {notice === undefined ? null : (
        <p aria-live="polite" className="passkey-auth__status" role="status">
          {notice}
        </p>
      )}
      {error === undefined ? null : (
        <p className="passkey-auth__error" role="alert">
          {error}
        </p>
      )}

      {result === undefined ? null : <KeyOutcome result={result} />}

      <p className="auth-panel__note">
        This flow creates or resumes an authentication-service session only. It never submits a
        transaction or claims that an onchain identity exists.
      </p>
    </div>
  );
}

function KeyOutcome({ result }: { readonly result: BrowserAuthFlowResult }) {
  if (result.key.status === 'ready') {
    const anonymousIdentity = deriveAnonymousIdentity(result.key.publicKey);
    return (
      <section className="passkey-auth__outcome passkey-auth__outcome--ready">
        <p className="section-kicker">Local key ready</p>
        <h3>Embedded signing material passed its local check.</h3>
        <p>
          The Ed25519 seed was wrapped or unwrapped in this browser, the public key was checked, and
          working buffers were cleared on a best-effort basis. Only ciphertext and a public key are
          synchronized.
        </p>
        <dl>
          <div>
            <dt>Public key</dt>
            <dd className="inline-identifier">{abbreviate(result.key.publicKey)}</dd>
          </div>
          <div>
            <dt>Protocol identity</dt>
            <dd>Not created</dd>
          </div>
          {anonymousIdentity === undefined ? null : (
            <>
              <div>
                <dt>Anonymous .drool candidate</dt>
                <dd className="inline-identifier">{anonymousIdentity.name}</dd>
              </div>
              <div>
                <dt>Exact Solana destination</dt>
                <dd className="inline-identifier">{anonymousIdentity.rootAuthority}</dd>
              </div>
              <div>
                <dt>Name status</dt>
                <dd>Deterministically derived; not claimed onchain yet</dd>
              </div>
            </>
          )}
        </dl>
        {anonymousIdentity === undefined ? null : (
          <p>
            This collision-resistant candidate contains no email or legal identity. It becomes a
            portable DroolNet name only after the matching identity and handle claim finalize on
            Solana; it is never a native Solana address.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="passkey-auth__outcome passkey-auth__outcome--fallback">
      <p className="section-kicker">Fail-closed fallback</p>
      <h3>{fallbackHeading(result.key.reason)}</h3>
      <p>
        The service account is authenticated, but this browser will not be treated as holding an
        embedded signing key. Use an external wallet or a separately reviewed encrypted recovery kit
        when one of those paths is actually available. Never paste a seed phrase here.
      </p>
      <div className="passkey-auth__links">
        <ButtonLink href="/settings/wallet" variant="secondary">
          Review wallet boundary
        </ButtonLink>
        <ButtonLink href="/recovery" variant="quiet">
          Review recovery safeguards
        </ButtonLink>
      </div>
    </section>
  );
}

function safeAuthMessage(error: unknown): string {
  if (error instanceof BrowserAuthError) return error.message;
  return 'The passkey flow stopped safely before an identity operation could be claimed.';
}

function toVisibleSession(session: AuthSessionView | undefined): VisibleSession | undefined {
  return session === undefined
    ? undefined
    : { accountId: session.accountId, expiresAt: session.expiresAt };
}

async function refreshSession(
  client: BrowserAuthClient,
  update: (session: VisibleSession | undefined) => void,
): Promise<void> {
  try {
    update(toVisibleSession(await client.session()));
  } catch {
    // Authentication has already completed; a failed status refresh must not
    // replace the explicit key outcome with an unverified claim.
  }
}

function fallbackHeading(reason: EmbeddedKeyFallbackReason): string {
  switch (reason) {
    case 'prf-unsupported':
      return 'This passkey did not provide the required PRF output.';
    case 'bundle-sync-failed':
      return 'The encrypted key wrapper could not be synchronized.';
    case 'bundle-missing-or-invalid':
      return 'No single valid encrypted wrapper matched this credential.';
  }
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

function deriveAnonymousIdentity(
  publicKey: string,
): { readonly name: string; readonly rootAuthority: string } | undefined {
  let publicKeyBytes: Uint8Array | undefined;
  try {
    publicKeyBytes = decodeBase64Url(publicKey, 32);
    const rootAuthority = bs58.encode(publicKeyBytes);
    return {
      name: deriveRandomWokeName(rootAuthority).name,
      rootAuthority,
    };
  } catch {
    return undefined;
  } finally {
    publicKeyBytes?.fill(0);
  }
}

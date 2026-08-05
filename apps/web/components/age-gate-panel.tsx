'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { readAgeGate, writeAgeGate } from '@/lib/nsfw-mode';

export interface AgeGatePanelProps {
  readonly title: string;
  readonly kicker?: string;
  readonly children: ReactNode;
  /** CTA label when gate is closed. */
  readonly confirmLabel?: string;
  /** Extra help under the CTA. */
  readonly help?: ReactNode;
  readonly className?: string;
}

/**
 * Shared 18+ self-attest gate for adult product surfaces (market, CUMDUMP, etc.).
 * LocalStorage only — no government ID, fail-closed until confirmed.
 */
export function AgeGatePanel({
  title,
  kicker = '18+ · self-attest',
  children,
  confirmLabel = 'I am 18+ · continue',
  help,
  className,
}: AgeGatePanelProps) {
  const [ready, setReady] = useState(false);
  const [ageOk, setAgeOk] = useState(false);

  useEffect(() => {
    setAgeOk(readAgeGate(window.localStorage).confirmed);
    setReady(true);
  }, []);

  const confirmAge = useCallback(() => {
    writeAgeGate(window.localStorage, true);
    setAgeOk(true);
  }, []);

  if (!ready) {
    return (
      <section
        className={['shorts-gate', className].filter(Boolean).join(' ')}
        aria-busy="true"
        aria-label="Checking age gate"
      >
        <p className="section-kicker">{kicker}</p>
        <p className="muted">Checking local age attestation…</p>
      </section>
    );
  }

  if (!ageOk) {
    return (
      <section
        className={['shorts-gate', className].filter(Boolean).join(' ')}
        aria-labelledby="age-gate-title"
      >
        <p className="section-kicker">{kicker}</p>
        <h1 id="age-gate-title">{title}</h1>
        <p>
          This surface is for adults only. Confirm you are at least{' '}
          <strong>18 years old</strong>. This is a private local self-attestation in this browser —
          WetDrool does not collect government ID by default.
        </p>
        <button type="button" className="shorts-gate__cta" onClick={confirmAge}>
          {confirmLabel}
        </button>
        {help ? <div className="field-help">{help}</div> : null}
        <p className="field-help">Illegal content is banned. CSAM and non-consensual material are never allowed.</p>
      </section>
    );
  }

  return <>{children}</>;
}

'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  readAgeAccessPolicy,
  readAgeGate,
  readContentMode,
  writeAgeGate,
  writeContentMode,
  type ContentMode,
} from '@/lib/nsfw-mode';
import type { AgeAccessDecision } from '@/lib/age-access-policy';

export function NsfwModeToggle() {
  const [mode, setMode] = useState<ContentMode>('sfw');
  const [ageOk, setAgeOk] = useState(false);
  const [promptAge, setPromptAge] = useState(false);
  const [policy, setPolicy] = useState<AgeAccessDecision | null>(null);

  useEffect(() => {
    setAgeOk(readAgeGate(window.localStorage).confirmed);
    setMode(readContentMode(window.localStorage));
    setPolicy(readAgeAccessPolicy(window.localStorage));
    void (async () => {
      try {
        const { fetchAgePolicy } = await import('@/lib/product-client');
        const result = await fetchAgePolicy();
        if (result.kind === 'ok' && result.data.policy) {
          setPolicy(result.data.policy);
        }
      } catch {
        /* keep local snapshot */
      }
    })();
  }, []);

  const applyMode = useCallback((next: ContentMode) => {
    const result = writeContentMode(window.localStorage, next);
    if (!result.ok) {
      setPromptAge(true);
      return;
    }
    setMode(next);
    window.dispatchEvent(new CustomEvent('wetdrool:content-mode', { detail: next }));
  }, []);

  const confirmAge = useCallback(() => {
    writeAgeGate(window.localStorage, true);
    setAgeOk(true);
    setPromptAge(false);
    applyMode('nsfw');
  }, [applyMode]);

  return (
    <div className="nsfw-toggle" data-mode={mode}>
      <div className="nsfw-toggle__control" role="group" aria-label="Content mode">
        <button
          type="button"
          className={mode === 'sfw' ? 'is-active' : undefined}
          aria-pressed={mode === 'sfw'}
          onClick={() => applyMode('sfw')}
        >
          SFW
        </button>
        <button
          type="button"
          className={mode === 'nsfw' ? 'is-active' : undefined}
          aria-pressed={mode === 'nsfw'}
          onClick={() => applyMode('nsfw')}
        >
          NSFW 18+
        </button>
      </div>
      {!ageOk && promptAge ? (
        <div className="nsfw-toggle__age" role="dialog" aria-labelledby="nsfw-age-title">
          <p id="nsfw-age-title">
            <strong>18+ self-attestation required.</strong> Confirm you are at least 18 years
            old. This is a private local self-attestation in this browser — WetDrool does not
            collect government ID photos or numbers by default.
          </p>
          {policy ? (
            <p className="nsfw-toggle__policy">
              Proof method: <code>{policy.defaultProof}</code>. {policy.operator.label}. Wallet
              signatures are not age proof. Illegal content (including CSAM and NCII) is never
              allowed.
            </p>
          ) : null}
          <button type="button" onClick={confirmAge}>
            I am 18 or older
          </button>
          <button type="button" onClick={() => setPromptAge(false)}>
            Stay SFW
          </button>
        </div>
      ) : null}
    </div>
  );
}

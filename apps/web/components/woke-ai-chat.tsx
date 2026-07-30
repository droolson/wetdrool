'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBadge } from '@wokesocial/ui';

import {
  prepareChatRequest,
  WOKE_AI_CHAT_DEFAULT_MODEL,
  WOKE_AI_MODELS,
  type WokeAiModelId,
} from '@/lib/woke-ai';

interface WokeAiChatProps {
  readonly runtime:
    | { readonly detail: string; readonly kind: 'unavailable' }
    | { readonly endpoint: string; readonly kind: 'configured' };
}

interface TranscriptEntry {
  readonly role: 'user' | 'system-notice';
  readonly text: string;
}

const SUGGESTIONS = [
  'Summarize what my communities discussed today',
  'Explain this Solana transaction like I’m new here',
  'Draft a launch post for my project — honest tone',
  'What does my .woke name actually prove?',
] as const;

export function WokeAiChat({ runtime }: WokeAiChatProps) {
  const [model, setModel] = useState<WokeAiModelId>(WOKE_AI_CHAT_DEFAULT_MODEL);
  const [input, setInput] = useState('');
  const [transcript, setTranscript] = useState<readonly TranscriptEntry[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript]);

  const selectedModel = useMemo(
    () => WOKE_AI_MODELS.find((candidate) => candidate.id === model),
    [model],
  );
  const userMessages = useMemo(
    () =>
      transcript
        .filter((entry) => entry.role === 'user')
        .map((entry) => ({ role: 'user' as const, text: entry.text })),
    [transcript],
  );
  const preparedRequest = useMemo(
    () => (userMessages.length === 0 ? null : prepareChatRequest(model, userMessages)),
    [model, userMessages],
  );

  function send(text: string) {
    const trimmed = text.trim();
    if (trimmed === '') return;
    setTranscript((current) => [
      ...current,
      { role: 'user', text: trimmed },
      {
        role: 'system-notice',
        text:
          runtime.kind === 'configured'
            ? 'A runtime endpoint is configured, but chat stays disabled until the Woke AI evaluation gates pass. Your message stayed on this device; the exact prepared request is shown below.'
            : 'No self-hosted Woke AI runtime is connected, so no model reply exists. Your message stayed on this device and was not sent anywhere.',
      },
    ]);
    setInput('');
  }

  return (
    <div className="compose-workspace">
      <section className="compose-form" aria-label="Woke AI chat">
        <div className="compose-form__status">
          <StatusBadge tone={runtime.kind === 'configured' ? 'pending' : 'unavailable'}>
            {runtime.kind === 'configured' ? 'Runtime configured · gated' : 'Runtime not connected'}
          </StatusBadge>
          <p aria-live="polite">
            {selectedModel === undefined
              ? 'Pick a model.'
              : `${selectedModel.label} · ${selectedModel.role} · self-hosted, planned`}
          </p>
        </div>

        <div className="field-stack">
          <label htmlFor="woke-ai-model">Model</label>
          <select
            id="woke-ai-model"
            onChange={(event) => setModel(event.target.value as WokeAiModelId)}
            value={model}
          >
            {WOKE_AI_MODELS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label} — {candidate.role}
              </option>
            ))}
          </select>
          <p className="field-help">
            {selectedModel?.detail ?? ''} Conversations run on WokeSocial’s own models — nothing is
            forwarded to a third-party provider.
          </p>
        </div>

        <div className="woke-ai-transcript" aria-label="Conversation" role="log">
          {transcript.length === 0 ? (
            <p className="field-help">
              Nothing has been sent. Messages stay on this device until the runtime is live.
            </p>
          ) : (
            transcript.map((entry, index) => (
              <p
                className="woke-ai-transcript__entry"
                data-role={entry.role}
                key={`${index}:${entry.role}`}
              >
                <strong>{entry.role === 'user' ? 'You' : 'System'}</strong> {entry.text}
              </p>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>

        <form
          className="field-stack"
          onSubmit={(event) => {
            event.preventDefault();
            send(input);
          }}
        >
          <label htmlFor="woke-ai-input">Ask Woke AI</label>
          <textarea
            id="woke-ai-input"
            maxLength={4_000}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about your feed, a transaction, a launch, or anything on the platform."
            rows={3}
            value={input}
          />
          <div className="compose-actions">
            <button className="publication-action--primary" type="submit">
              Send (stays on this device)
            </button>
          </div>
        </form>

        <div className="compose-actions" role="group" aria-label="Suggested prompts">
          {SUGGESTIONS.map((suggestion) => (
            <button
              className="text-action"
              key={suggestion}
              onClick={() => setInput(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </section>

      <aside className="compose-preview" aria-labelledby="woke-ai-request-title">
        <div className="compose-preview__heading">
          <div>
            <p className="section-kicker">Prepared contract</p>
            <h2 id="woke-ai-request-title">Exactly what the runtime will receive</h2>
          </div>
          <StatusBadge tone="neutral">No inference performed</StatusBadge>
        </div>
        {preparedRequest === null ? (
          <p className="field-help">
            Type a message to see the exact typed request the self-hosted runtime will serve.
          </p>
        ) : (
          <details className="proof-details" open>
            <summary>Prepared chat request</summary>
            <pre className="site-generation-request">
              <code>{JSON.stringify(preparedRequest, null, 2)}</code>
            </pre>
          </details>
        )}
        <p className="publication-panel__note">
          Assistant replies will cite platform data they used, refuse to fabricate on-chain facts,
          and never give financial advice. Those constraints are part of the request contract above,
          not marketing.
        </p>
      </aside>
    </div>
  );
}

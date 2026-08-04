'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import { getGrokChatRuntime, prepareGrokRequest } from '@/lib/grok-chat';
import { MENTAL_HEALTH_RESOURCES, readContentMode } from '@/lib/nsfw-mode';

interface TranscriptEntry {
  readonly role: 'user' | 'assistant' | 'system-notice';
  readonly text: string;
}

const SUGGESTIONS = [
  'Plan a hot but safe first DM',
  'Explain $DROOL tips like I’m new',
  'Suggest kink filters for my feed',
  'I might be spiraling — help me slow down',
] as const;

export function GrokChatDock() {
  const runtime = useMemo(() => getGrokChatRuntime(), []);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [transcript, setTranscript] = useState<readonly TranscriptEntry[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript]);

  function send(text: string) {
    const trimmed = text.trim();
    if (trimmed === '') return;
    const mode = typeof window === 'undefined' ? 'sfw' : readContentMode(window.localStorage);
    const nextUser = [...transcript.filter((t) => t.role === 'user' || t.role === 'assistant'), { role: 'user' as const, text: trimmed }];
    const prepared = prepareGrokRequest(
      nextUser.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text })),
      mode,
      'web-dock',
    );

    const notice =
      runtime.kind === 'frontend-only'
        ? 'Frontend-only mode: your message stayed on this device. Add WETDROOL_GROK_API_KEY to enable live Grok 4.5 replies.'
        : 'API key detected, but the server route is not wired yet — nothing left this device.';

    setTranscript((current) => [
      ...current,
      { role: 'user', text: trimmed },
      { role: 'system-notice', text: notice },
    ]);
    setInput('');
    void prepared;
  }

  if (!open) {
    return (
      <button type="button" className="grok-dock__fab" onClick={() => setOpen(true)} aria-label="Open Drool AI chat">
        Ask Drool
      </button>
    );
  }

  return (
    <div className="grok-dock" role="dialog" aria-label="Drool AI chat">
      <header className="grok-dock__header">
        <div>
          <strong>Drool</strong>
          <span> Grok 4.5 · WetDrool</span>
        </div>
        <StatusBadge tone={runtime.kind === 'configured' ? 'pending' : 'unavailable'}>
          {runtime.kind === 'frontend-only' ? 'Frontend only' : 'Key set · wire backend'}
        </StatusBadge>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close chat">
          Close
        </button>
      </header>
      <p className="field-help">{runtime.detail}</p>
      <div className="grok-dock__transcript" role="log" aria-label="Conversation">
        {transcript.length === 0 ? (
          <ul className="grok-dock__suggestions">
            {SUGGESTIONS.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => send(s)}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          transcript.map((entry, index) => (
            <p key={`${index}:${entry.role}`} data-role={entry.role}>
              <strong>
                {entry.role === 'user' ? 'You' : entry.role === 'assistant' ? 'Drool' : 'System'}
              </strong>{' '}
              {entry.text}
            </p>
          ))
        )}
        <div ref={endRef} />
      </div>
      <form
        className="grok-dock__form"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <label className="visually-hidden" htmlFor="grok-dock-input">
          Message
        </label>
        <input
          id="grok-dock-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Say anything (18+ · illegal stuff still no)"
          autoComplete="off"
        />
        <button type="submit">Send</button>
      </form>
      <footer className="grok-dock__resources">
        <p>Taking it too far? Breathe. Resources:</p>
        <ul>
          {MENTAL_HEALTH_RESOURCES.slice(0, 2).map((r) => (
            <li key={r.id}>
              <a href={r.href} rel="noopener noreferrer" target={r.href.startsWith('http') ? '_blank' : undefined}>
                {r.label}
              </a>
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
}

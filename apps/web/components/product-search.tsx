'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wetdrool/ui';

import type { ProductClientResult, ProductSearchHitDto, SearchApiResponse } from '@/lib/product-client';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accept only well-formed search hits. Never invent rows from partial payloads.
 */
export function normalizeSearchHits(raw: unknown): readonly ProductSearchHitDto[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductSearchHitDto[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    const kind = entry.kind;
    const title = entry.title;
    const href = entry.href;
    const source = entry.source;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof kind !== 'string' || kind.length === 0) continue;
    if (typeof title !== 'string' || title.length === 0) continue;
    if (typeof href !== 'string' || href.length === 0) continue;
    if (typeof source !== 'string' || source.length === 0) continue;
    const hit: ProductSearchHitDto = {
      id,
      kind,
      title,
      href,
      source,
      ...(typeof entry.subtitle === 'string' ? { subtitle: entry.subtitle } : {}),
      ...(Array.isArray(entry.tags)
        ? {
            tags: entry.tags.filter((t): t is string => typeof t === 'string'),
          }
        : {}),
      ...(typeof entry.synthetic === 'boolean' ? { synthetic: entry.synthetic } : {}),
    };
    out.push(hit);
  }
  return out;
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'short':
      return 'Synthetic short';
    case 'creator':
      return 'Synthetic creator';
    case 'live':
      return 'Synthetic live room';
    case 'fame':
      return 'Seed fame board';
    default:
      return kind;
  }
}

export function ProductSearch({
  initialQuery = null,
}: {
  readonly initialQuery?: string | null;
}) {
  const [input, setInput] = useState(initialQuery ?? '');
  const [activeQuery, setActiveQuery] = useState((initialQuery ?? '').trim());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ readonly status: number; readonly message: string } | null>(
    null,
  );
  const [results, setResults] = useState<readonly ProductSearchHitDto[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [echoQ, setEchoQ] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [hasRequested, setHasRequested] = useState(Boolean((initialQuery ?? '').trim()));

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    setHasRequested(true);
    try {
      const { fetchSearch } = await import('@/lib/product-client');
      const result: ProductClientResult<SearchApiResponse> = await fetchSearch({
        q: q.length > 0 ? q : null,
        limit: 24,
      });
      if (result.kind !== 'ok') {
        setError({ status: result.status, message: result.message });
        setResults([]);
        setNote(null);
        setConfigured(null);
        setEchoQ(null);
        return;
      }
      const data = result.data;
      setResults(normalizeSearchHits(data.results));
      setConfigured(data.configured === true);
      setNote(typeof data.note === 'string' ? data.note : null);
      setEchoQ(typeof data.q === 'string' ? data.q : data.q === null ? null : null);
    } catch {
      setError({ status: 0, message: 'Network error talking to product API.' });
      setResults([]);
      setNote(null);
      setConfigured(null);
      setEchoQ(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasRequested && !activeQuery) return;
    void load(activeQuery);
  }, [load, activeQuery, attempt, hasRequested]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = input.trim().slice(0, 64);
    setActiveQuery(next);
    setHasRequested(true);
    // Keep q in the address bar without a full navigation when possible.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set('q', next);
      else url.searchParams.delete('q');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
  };

  const retry = () => setAttempt((n) => n + 1);

  const statusBadge = useMemo(() => {
    if (loading) return { tone: 'pending' as const, label: 'Searching…' };
    if (error) return { tone: 'degraded' as const, label: error.status === 0 ? 'Offline' : `HTTP ${error.status}` };
    if (!hasRequested) return { tone: 'neutral' as const, label: 'Awaiting query' };
    if (configured !== true) {
      if (results.length > 0) return { tone: 'pending' as const, label: 'Synthetic catalog only' };
      return { tone: 'neutral' as const, label: 'Index unconfigured' };
    }
    if (results.length === 0) return { tone: 'pending' as const, label: 'No matches' };
    return { tone: 'verified' as const, label: `${results.length} hit${results.length === 1 ? '' : 's'}` };
  }, [loading, error, hasRequested, configured, results.length]);

  return (
    <div className="product-search" aria-busy={loading}>
      <form className="search-bar" onSubmit={submit} role="search">
        <label htmlFor="product-search-q">Search synthetic catalog (demo)</label>
        <div>
          <input
            autoComplete="off"
            id="product-search-q"
            name="q"
            onChange={(e) => setInput(e.target.value)}
            placeholder="Try a fixture title, @handle, or category"
            type="search"
            value={input}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        <p>
          This product API does not claim a global user or post index. Matches are optional
          in-repo fixtures labeled <code>synthetic-catalog</code>. Empty is honest.
        </p>
      </form>

      <div className="product-search__meta" aria-live="polite">
        <StatusBadge tone={statusBadge.tone}>{statusBadge.label}</StatusBadge>
        {hasRequested ? (
          <button
            type="button"
            className="auth-service-status__retry"
            onClick={retry}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : null}
      </div>

      {note ? (
        <p className="field-help" role="note">
          {note}
        </p>
      ) : null}

      {!hasRequested ? (
        <StatePanel
          eyebrow="No query sent"
          headingLevel={2}
          title="Enter a term to search the synthetic catalog."
          tone="empty"
        >
          <p>
            No sample posts or users are substituted before you search. The global public index is
            not configured on this product surface.
          </p>
          <p className="field-help">
            Try <code>neonangel</code>, <code>studio</code>, or a short title fragment from the hub
            fixtures.
          </p>
        </StatePanel>
      ) : null}

      {error ? (
        <StatePanel
          eyebrow={error.status === 0 ? 'Network error' : 'Search unavailable'}
          headingLevel={2}
          title={
            error.status === 404
              ? 'Search product route is not available yet.'
              : 'Product search failed closed.'
          }
          tone="error"
        >
          <p>
            {error.status === 0
              ? 'A network failure blocked the search request. Retry when connectivity returns.'
              : `The product API returned HTTP ${error.status}. WetDrool will not invent posts or users from a non-ok response.`}
          </p>
          {error.message ? <p className="field-help">{error.message}</p> : null}
          <p className="field-help">
            <ButtonLink href="/settings/providers" variant="quiet">
              Provider settings
            </ButtonLink>
            {' · '}
            <button type="button" className="auth-service-status__retry" onClick={retry}>
              Retry
            </button>
          </p>
        </StatePanel>
      ) : null}

      {!error && hasRequested && !loading && results.length === 0 ? (
        <StatePanel
          action={
            <ButtonLink href="/settings/providers" variant="secondary">
              Review providers
            </ButtonLink>
          }
          eyebrow={configured === true ? 'Empty response' : 'Index unconfigured'}
          headingLevel={2}
          title={
            echoQ
              ? `No synthetic catalog matches for “${echoQ}”.`
              : activeQuery
                ? `No synthetic catalog matches for “${activeQuery}”.`
                : 'No query — empty results.'
          }
          tone="empty"
        >
          <p>
            {configured === true
              ? 'The search provider returned zero hits. Nothing nearby or sponsored was inserted.'
              : 'No global search index is configured. Empty is honest — not a silent “no one exists.” Optional fixture hits appear only when q matches in-repo synthetic titles, creators, or directory handles.'}
          </p>
        </StatePanel>
      ) : null}

      {!error && results.length > 0 ? (
        <section className="search-results" aria-labelledby="product-search-results-title">
          <header>
            <div>
              <p className="section-kicker">Synthetic catalog</p>
              <h2 id="product-search-results-title">
                {results.length} labeled fixture {results.length === 1 ? 'hit' : 'hits'}
                {echoQ || activeQuery ? ` for “${echoQ ?? activeQuery}”` : ''}
              </h2>
            </div>
            <dl>
              <div>
                <dt>Source</dt>
                <dd>
                  <code>synthetic-catalog</code>
                </dd>
              </div>
              <div>
                <dt>Global index</dt>
                <dd>Not configured</dd>
              </div>
              <div>
                <dt>API</dt>
                <dd>
                  <code>/api/v1/search</code>
                </dd>
              </div>
            </dl>
          </header>
          <ol>
            {results.map((hit) => (
              <li key={hit.id}>
                <article className="search-result-card" data-search-source={hit.source}>
                  <div>
                    <StatusBadge tone="neutral">{kindLabel(hit.kind)}</StatusBadge>
                    <h3>{hit.title}</h3>
                    {hit.subtitle ? <p className="search-result-card__handle">{hit.subtitle}</p> : null}
                  </div>
                  <p className="field-help">
                    Source: <code>{hit.source}</code>
                    {hit.tags && hit.tags.length > 0 ? ` · ${hit.tags.slice(0, 4).join(', ')}` : null}
                  </p>
                  <footer>
                    <Link href={hit.href}>Open surface</Link>
                  </footer>
                </article>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <nav className="discovery-directory" aria-label="Browse without search">
        <p>Browse a known surface instead</p>
        <div>
          <Link href="/hub">Hub</Link>
          <Link href="/creators">Creators</Link>
          <Link href="/live">Live</Link>
          <Link href="/video">Video</Link>
          <Link href="/fame">Fame</Link>
          <Link href="/explore">Explore</Link>
        </div>
      </nav>

      <section className="product-card-grid" aria-label="Search honesty">
        <InfoCard eyebrow="Index" title="No invented global search" tone="plum">
          <p>
            <code>configured: false</code> until a real projection search is wired. Empty lists are
            never padded with fake users or posts.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Demo" title="Synthetic catalog optional" tone="coral">
          <p>
            Fixture hits are explicitly labeled <code>source: synthetic-catalog</code> so demos stay
            useful without claiming network-wide coverage.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Scope" title="Public fixtures only" tone="sky">
          <p>Private messages, recovery data, and nonpublic fields never belong in search.</p>
        </InfoCard>
      </section>
    </div>
  );
}

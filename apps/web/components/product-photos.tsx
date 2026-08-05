'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wetdrool/ui';

import type { PhotosApiResponse, ProductClientResult, ProductPhotoDto } from '@/lib/product-client';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accept only well-formed photo rows from the product API.
 * Never invents licensed media, CDN URLs, or upload liveness.
 */
export function normalizeProductPhotos(raw: unknown): readonly ProductPhotoDto[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductPhotoDto[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    const title = entry.title;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof title !== 'string' || title.length === 0) continue;
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
      : undefined;
    const href =
      typeof entry.href === 'string' && entry.href.length > 0 ? entry.href : '/photos';
    const item: ProductPhotoDto = {
      id,
      title,
      creator: typeof entry.creator === 'string' ? entry.creator : 'unknown',
      href,
      source:
        typeof entry.source === 'string' && entry.source.length > 0
          ? entry.source
          : 'synthetic-catalog',
      synthetic: entry.synthetic !== false,
      licensedMedia: false,
      mediaSrc: null,
      uploadLive: false,
      ...(typeof entry.alt === 'string' ? { alt: entry.alt } : {}),
      ...(tags ? { tags } : {}),
      ...(entry.nsfw === true ? { nsfw: true } : {}),
      ...(typeof entry.contentWarning === 'string'
        ? { contentWarning: entry.contentWarning }
        : {}),
      ...(typeof entry.toneA === 'string' ? { toneA: entry.toneA } : {}),
      ...(typeof entry.toneB === 'string' ? { toneB: entry.toneB } : {}),
      ...(typeof entry.category === 'string' ? { category: entry.category } : {}),
    };
    out.push(item);
  }
  return out;
}

/** Prefer `items` (slot A); tolerate lag if the route still returns `photos`. */
export function extractPhotosPayload(data: PhotosApiResponse): unknown {
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.photos)) return data.photos;
  return [];
}

function statusForHttp(status: number): {
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly badge: string;
  readonly tone: 'empty' | 'error';
} {
  if (status === 404) {
    return {
      eyebrow: 'API unconfigured',
      title: 'Photos product route is not available yet.',
      detail:
        'GET /api/v1/photos did not respond successfully. This page will not invent licensed stills, performer media, or a live upload pipeline.',
      badge: 'Route missing',
      tone: 'empty',
    };
  }
  if (status === 0) {
    return {
      eyebrow: 'Network error',
      title: 'Could not reach the product API.',
      detail: 'A network failure blocked the photos request. Retry when connectivity returns.',
      badge: 'Offline / error',
      tone: 'error',
    };
  }
  return {
    eyebrow: 'Photos unavailable',
    title: 'Photo gallery failed closed.',
    detail: `The product API returned HTTP ${status}. WetDrool will not re-fanout local fixtures from a non-ok response.`,
    badge: `HTTP ${status}`,
    tone: 'error',
  };
}

/**
 * Client photo gallery backed by GET /api/v1/photos.
 * Loading / error / empty / synthetic badges only — never invents licensed media.
 * HTTP 404 and other non-ok responses fail closed to an empty catalog (no local re-fanout).
 */
export function ProductPhotos() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ readonly status: number; readonly message: string } | null>(
    null,
  );
  const [items, setItems] = useState<readonly ProductPhotoDto[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [syntheticOnly, setSyntheticOnly] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [mediaPipelineLive, setMediaPipelineLive] = useState(false);
  const [uploadLive, setUploadLive] = useState(false);
  const [total, setTotal] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchPhotos } = await import('@/lib/product-client');
      const result: ProductClientResult<PhotosApiResponse> = await fetchPhotos({
        limit: 24,
        offset: 0,
      });
      if (result.kind !== 'ok') {
        // Fail closed (including 404): empty list, no invented fixtures / re-fanout.
        setError({ status: result.status, message: result.message });
        setItems([]);
        setNote(null);
        setTotal(0);
        setSyntheticOnly(true);
        setConfigured(null);
        setMediaPipelineLive(false);
        setUploadLive(false);
        return;
      }
      const data = result.data;
      const normalized = normalizeProductPhotos(extractPhotosPayload(data));
      setItems(normalized);
      setTotal(typeof data.total === 'number' ? data.total : normalized.length);
      setNote(typeof data.note === 'string' ? data.note : null);
      setSyntheticOnly(data.syntheticOnly !== false && data.synthetic !== false);
      setConfigured(data.configured === true);
      setMediaPipelineLive(data.mediaPipelineLive === true);
      setUploadLive(data.uploadLive === true);
    } catch {
      setError({ status: 0, message: 'Network error talking to product API.' });
      setItems([]);
      setNote(null);
      setTotal(0);
      setSyntheticOnly(true);
      setConfigured(null);
      setMediaPipelineLive(false);
      setUploadLive(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const retry = () => setAttempt((n) => n + 1);

  if (loading && items.length === 0 && !error) {
    return (
      <div className="product-photos" aria-busy="true" role="status">
        <p className="field-help">Loading photos from the product API…</p>
      </div>
    );
  }

  if (error) {
    const panel = statusForHttp(error.status);
    return (
      <div className="product-photos" role="alert">
        <div className="product-events__meta" aria-live="polite">
          <StatusBadge tone={panel.tone === 'error' ? 'degraded' : 'neutral'}>
            {panel.badge}
          </StatusBadge>
          <button type="button" className="auth-service-status__retry" onClick={retry}>
            Retry
          </button>
        </div>
        <StatePanel eyebrow={panel.eyebrow} headingLevel={2} title={panel.title} tone={panel.tone}>
          <p>{panel.detail}</p>
          {error.message ? <p className="field-help">{error.message}</p> : null}
          <p className="field-help">
            Related:{' '}
            <ButtonLink href="/compose" variant="quiet">
              Compose
            </ButtonLink>
            {' · '}
            <ButtonLink href="/feed/media" variant="quiet">
              Media feed
            </ButtonLink>
            {' · '}
            <ButtonLink href="/settings/storage" variant="quiet">
              Storage
            </ButtonLink>
          </p>
        </StatePanel>
        <PhotoCommitments />
      </div>
    );
  }

  const empty = items.length === 0;
  const badgeTone = empty ? 'neutral' : syntheticOnly ? 'pending' : 'verified';
  const badgeLabel = empty
    ? configured === false
      ? 'Empty · unconfigured'
      : 'Empty catalog'
    : syntheticOnly
      ? `Synthetic · ${items.length}`
      : `${items.length} photo${items.length === 1 ? '' : 's'}`;

  return (
    <div className="product-photos" aria-live="polite" aria-busy={loading}>
      <div className="product-events__meta">
        <StatusBadge tone={badgeTone}>{badgeLabel}</StatusBadge>
        {syntheticOnly && !empty ? (
          <StatusBadge tone="pending">Demo fixtures only</StatusBadge>
        ) : null}
        {configured === false ? (
          <StatusBadge tone="neutral">Gallery unconfigured</StatusBadge>
        ) : null}
        <StatusBadge tone="neutral">No licensed media</StatusBadge>
        <StatusBadge tone={mediaPipelineLive ? 'verified' : 'neutral'}>
          {mediaPipelineLive ? 'Media pipeline live' : 'Media pipeline not live'}
        </StatusBadge>
        <StatusBadge tone={uploadLive ? 'verified' : 'neutral'}>
          {uploadLive ? 'Upload live' : 'Upload not live'}
        </StatusBadge>
        <button
          type="button"
          className="auth-service-status__retry"
          onClick={retry}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {note ? (
        <p className="field-help" role="note">
          {note}
        </p>
      ) : null}

      {empty ? (
        <StatePanel
          action={
            <ButtonLink href="/compose" variant="secondary">
              Open composer
            </ButtonLink>
          }
          eyebrow="No photo directory"
          headingLevel={2}
          title="No photos returned."
          tone="empty"
        >
          <p>
            The product API returned an empty list. WetDrool will not invent licensed stills,
            performer media, or CDN image URLs. An empty catalog is authoritative.
          </p>
        </StatePanel>
      ) : (
        <ul className="product-photos__list" aria-label="Product photos">
          {items.map((photo) => {
            const isSynthetic = photo.synthetic !== false || photo.source === 'synthetic-catalog';
            const gradient =
              photo.toneA && photo.toneB
                ? `linear-gradient(135deg, ${photo.toneA}, ${photo.toneB})`
                : undefined;
            return (
              <li
                key={photo.id}
                data-photo-id={photo.id}
                data-synthetic={isSynthetic ? 'true' : 'false'}
              >
                <article className="product-events__card product-photos__card">
                  <div
                    className="product-photos__swatch"
                    aria-hidden="true"
                    style={gradient ? { background: gradient } : undefined}
                  />
                  <div className="product-events__card-head">
                    <p className="section-kicker">
                      {photo.creator}
                      {isSynthetic ? ' · synthetic' : ''}
                      {photo.nsfw ? ' · 18+' : ''}
                    </p>
                    <StatusBadge tone={isSynthetic ? 'pending' : 'verified'}>
                      {isSynthetic ? 'Fixture' : 'Listed'}
                    </StatusBadge>
                  </div>
                  <h3>
                    <Link href={photo.href}>{photo.title}</Link>
                  </h3>
                  {photo.alt ? <p>{photo.alt}</p> : null}
                  {photo.tags && photo.tags.length > 0 ? (
                    <p className="field-help" aria-label="Tags">
                      {photo.tags.join(' · ')}
                    </p>
                  ) : photo.category ? (
                    <p className="field-help">{photo.category}</p>
                  ) : null}
                  <p className="field-help">
                    Licensed media not claimed · upload not live
                    {photo.contentWarning ? ` · ${photo.contentWarning}` : null}
                    {total > items.length ? ` · showing ${items.length} of ${total}` : null}
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <PhotoCommitments />
    </div>
  );
}

function PhotoCommitments() {
  return (
    <section className="product-card-grid" aria-label="Photo pipeline commitments">
      <InfoCard eyebrow="Labels" title="NSFW is explicit state" tone="plum">
        <p>Content warnings and kink tags travel with the object — never inferred from silence.</p>
      </InfoCard>
      <InfoCard eyebrow="Bytes" title="Media stays off-chain" tone="coral">
        <p>DroolNet anchors hashes when verification matters; gallery cards are not CDN claims.</p>
      </InfoCard>
      <InfoCard eyebrow="Integrity" title="Fixtures are not performers" tone="sky">
        <p>Synthetic abstract gradients never stand in for licensed stills or real people.</p>
      </InfoCard>
    </section>
  );
}

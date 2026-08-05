import { describe, expect, it } from 'vitest';

import {
  extractEventsPayload,
  normalizeProductEvents,
} from '../components/product-events';
import type { EventsApiResponse } from '../lib/product-client';

describe('normalizeProductEvents', () => {
  it('returns empty for non-arrays', () => {
    expect(normalizeProductEvents(null)).toEqual([]);
    expect(normalizeProductEvents(undefined)).toEqual([]);
    expect(normalizeProductEvents({})).toEqual([]);
    expect(normalizeProductEvents('x')).toEqual([]);
  });

  it('drops malformed rows and never invents attendance or tickets', () => {
    const items = normalizeProductEvents([
      {
        id: '1',
        title: 'Hello',
        summary: 's',
        startsAt: '2099-01-01T00:00:00.000Z',
        endsAt: '2099-01-01T01:00:00.000Z',
        href: '/events',
        source: 'synthetic-catalog',
        synthetic: true,
        attendanceClaimed: true, // forced closed
        ticketsLive: true, // forced closed
      },
      { id: '', title: 'bad' },
      { title: 'no-id' },
      { id: '2', title: '' },
      null,
      42,
      {
        id: '3',
        title: 'Mesh lab',
        summary: 'fixture',
        startsAt: '2099-02-01T20:00:00.000Z',
        endsAt: '2099-02-01T22:00:00.000Z',
        timezone: 'UTC',
        href: '/events',
        locationLabel: 'online',
        source: 'synthetic-catalog',
        synthetic: true,
        liveAttendance: null,
        rsvpOpen: false,
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: '1',
      title: 'Hello',
      attendanceClaimed: false,
      ticketsLive: false,
      synthetic: true,
    });
    expect(items[1]).toMatchObject({
      id: '3',
      title: 'Mesh lab',
      timezone: 'UTC',
      locationLabel: 'online',
      liveAttendance: null,
      rsvpOpen: false,
      attendanceClaimed: false,
    });
  });

  it('preserves empty catalog without placeholders', () => {
    expect(normalizeProductEvents([])).toEqual([]);
  });
});

describe('extractEventsPayload', () => {
  it('prefers items and falls back to events for lag', () => {
    const withItems = {
      ok: true as const,
      items: [{ id: 'a', title: 'A' }],
      events: [{ id: 'b', title: 'B' }],
    } as unknown as EventsApiResponse;
    expect(extractEventsPayload(withItems)).toEqual([{ id: 'a', title: 'A' }]);

    const withEventsOnly = {
      ok: true as const,
      events: [{ id: 'b', title: 'B' }],
    } as unknown as EventsApiResponse;
    expect(extractEventsPayload(withEventsOnly)).toEqual([{ id: 'b', title: 'B' }]);

    const empty = { ok: true as const } as EventsApiResponse;
    expect(extractEventsPayload(empty)).toEqual([]);
  });
});

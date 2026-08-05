import { describe, expect, it } from 'vitest';

import {
  buildProductEventsResponse,
  pageSyntheticProductEvents,
  SYNTHETIC_PRODUCT_EVENTS,
} from '../lib/product-events';
import { methodNotAllowed } from '../lib/product-api';

describe('product events helpers', () => {
  it('pages tiny synthetic fixtures without inventing attendance', () => {
    expect(SYNTHETIC_PRODUCT_EVENTS.length).toBeGreaterThan(0);
    expect(SYNTHETIC_PRODUCT_EVENTS.length).toBeLessThanOrEqual(4);

    const page = pageSyntheticProductEvents({ limit: 1, offset: 0 });
    expect(page.configured).toBe(false);
    expect(page.syntheticOnly).toBe(true);
    expect(page.globalCalendar).toBe(false);
    expect(page.inventsLiveAttendance).toBe(false);
    expect(page.attendanceProjection).toBe(false);
    expect(page.rsvpLive).toBe(false);
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(SYNTHETIC_PRODUCT_EVENTS.length);
    expect(page.hasMore).toBe(page.total > 1);
    const item = page.items[0]!;
    expect(item.synthetic).toBe(true);
    expect(item.source).toBe('synthetic-catalog');
    expect(item.attendanceClaimed).toBe(false);
    expect(item.liveAttendance).toBeNull();
    expect(item.rsvpOpen).toBe(false);

    const next = pageSyntheticProductEvents({ limit: 1, offset: 1 });
    expect(next.items[0]!.id).not.toBe(item.id);

    const empty = pageSyntheticProductEvents({
      limit: 10,
      offset: SYNTHETIC_PRODUCT_EVENTS.length,
    });
    expect(empty.items).toEqual([]);
    expect(empty.count).toBe(0);
    expect(empty.hasMore).toBe(false);
    expect(empty.configured).toBe(false);
    expect(empty.syntheticOnly).toBe(true);
  });

  it('buildProductEventsResponse is honest and labels fixtures', () => {
    const body = buildProductEventsResponse({ limit: 24, offset: 0 });
    expect(body.ok).toBe(true);
    expect(body.path).toBe('/api/v1/events');
    expect(body.product).toBe('wetdrool');
    expect(body.configured).toBe(false);
    expect(body.syntheticOnly).toBe(true);
    expect(body.globalCalendar).toBe(false);
    expect(body.inventsLiveAttendance).toBe(false);
    expect(body.attendanceProjection).toBe(false);
    expect(body.rsvpLive).toBe(false);
    expect(body.media).toBe('synthetic-fixtures');
    expect(body.items.every((e) => e.synthetic && e.source === 'synthetic-catalog')).toBe(true);
    expect(body.items.every((e) => e.liveAttendance === null && e.attendanceClaimed === false)).toBe(
      true,
    );
    expect(body.note.toLowerCase()).toMatch(/synthetic|not configured|never invent/);
  });

  it('methodNotAllowed documents GET-only events mutations', async () => {
    const res = methodNotAllowed(
      'GET',
      'Use GET for the events calendar. Creating events or RSVPs is not implemented here.',
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    const body = (await res.json()) as {
      ok: false;
      error: { code: string; allow: string[] };
    };
    expect(body.error.code).toBe('method_not_allowed');
    expect(body.error.allow).toEqual(['GET']);
  });
});

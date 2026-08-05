import { describe, expect, it } from 'vitest';

import {
  buildProductEventsResponse,
  pageSyntheticProductEvents,
  SYNTHETIC_PRODUCT_EVENTS,
} from '../lib/product-events';

describe('product-events', () => {
  it('pages synthetic fixtures without inventing attendance', () => {
    const page = pageSyntheticProductEvents({ limit: 10, offset: 0 });
    expect(page.total).toBe(SYNTHETIC_PRODUCT_EVENTS.length);
    expect(page.configured).toBe(false);
    expect(page.syntheticOnly).toBe(true);
    expect(page.globalCalendar).toBe(false);
    expect(page.inventsLiveAttendance).toBe(false);
    expect(page.items.every((e) => e.attendanceClaimed === false)).toBe(true);
    expect(page.items.every((e) => e.liveAttendance === null)).toBe(true);
  });

  it('buildProductEventsResponse is honest envelope', () => {
    const body = buildProductEventsResponse({ limit: 1, offset: 0 });
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.configured).toBe(false);
    expect(body.rsvpLive).toBe(false);
    expect(body.note.toLowerCase()).toMatch(/synthetic|fixture/);
  });

  it('offset beyond catalog yields empty page', () => {
    const page = pageSyntheticProductEvents({ limit: 10, offset: 100 });
    expect(page.items).toHaveLength(0);
    expect(page.hasMore).toBe(false);
  });
});

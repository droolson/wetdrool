import { describe, expect, it } from 'vitest';

import { normalizeNotificationItems } from '../components/notifications-inbox';

describe('normalizeNotificationItems', () => {
  it('returns empty for non-arrays', () => {
    expect(normalizeNotificationItems(null)).toEqual([]);
    expect(normalizeNotificationItems(undefined)).toEqual([]);
    expect(normalizeNotificationItems({})).toEqual([]);
    expect(normalizeNotificationItems('x')).toEqual([]);
  });

  it('drops malformed rows and never invents fields', () => {
    const items = normalizeNotificationItems([
      { id: '1', title: 'Hello', category: 'mentions', body: 'x', read: false },
      { id: '', title: 'bad', category: 'mentions' },
      { title: 'no-id', category: 'mentions' },
      { id: '2', title: '', category: 'system' },
      { id: '3', title: 'ok', category: '' },
      null,
      42,
      { id: '4', title: 'Follow', category: 'follows', actorHandle: 'alice', href: '/u/alice' },
    ]);
    expect(items).toEqual([
      { id: '1', title: 'Hello', category: 'mentions', body: 'x', read: false },
      {
        id: '4',
        title: 'Follow',
        category: 'follows',
        actorHandle: 'alice',
        href: '/u/alice',
      },
    ]);
  });

  it('preserves empty inbox without placeholders', () => {
    expect(normalizeNotificationItems([])).toEqual([]);
  });
});

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { CANONICAL_ORIGIN, legacyHostRedirect } from '../lib/canonical-host';
import { proxy } from '../proxy';

describe('canonical web host', () => {
  it('uses woke.social as the canonical origin', () => {
    expect(CANONICAL_ORIGIN).toBe('https://woke.social');
  });

  it.each(['sociallywoke.com', 'www.sociallywoke.com'])(
    'permanently redirects the exact legacy hostname %s while preserving path and query',
    (hostname) => {
      const request = new NextRequest(
        `http://${hostname}:8080/people/%E2%9C%93?tab=following&empty=`,
      );
      const response = proxy(request);

      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe(
        'https://woke.social/people/%E2%9C%93?tab=following&empty=',
      );
    },
  );

  it('uses the public Host header when the runtime normalizes nextUrl to its bind address', () => {
    const request = new NextRequest('http://127.0.0.1:3000/settings?section=privacy', {
      headers: { host: 'www.sociallywoke.com:443' },
    });
    const response = proxy(request);

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://woke.social/settings?section=privacy');
  });

  it.each([
    'http://localhost:3000/onboarding?from=test',
    'https://preview.sociallywoke.com/signin',
    'https://sociallywoke.com.example/signin',
    'https://tenant.example/signin',
    'https://woke.social/signin',
  ])('does not redirect a non-legacy deployment host: %s', (url) => {
    const response = proxy(new NextRequest(url));

    expect(response.headers.get('location')).toBeNull();
  });

  it('does not treat a trailing-dot hostname as an exact legacy match', () => {
    expect(legacyHostRedirect(new URL('https://sociallywoke.com./path'))).toBeUndefined();
  });

  it.each([
    'sociallywoke.com.',
    'sociallywoke.com:65536',
    'sociallywoke.com.example',
    'sociallywoke.com@woke.social',
    ' sociallywoke.com',
  ])('rejects a non-exact or invalid public Host header: %s', (host) => {
    expect(legacyHostRedirect(new URL('http://127.0.0.1:3000/path'), host)).toBeUndefined();
  });
});

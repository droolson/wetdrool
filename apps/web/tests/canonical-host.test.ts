import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { CANONICAL_ORIGIN, legacyHostRedirect } from '../lib/canonical-host';
import { proxy } from '../proxy';

describe('canonical web host', () => {
  it('uses wetdrool.com as the canonical origin', () => {
    expect(CANONICAL_ORIGIN).toBe('https://wetdrool.com');
  });

  it.each(['droolhouse.com', 'www.droolhouse.com', 'www.wetdrool.com', 'www.droolhouse.com..'])(
    'permanently redirects the legacy hostname %s while preserving path and query',
    (hostname) => {
      const request = new NextRequest(
        `http://${hostname}:8080/people/%E2%9C%93?tab=following&empty=`,
      );
      const response = proxy(request);

      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe(
        'https://wetdrool.com/people/%E2%9C%93?tab=following&empty=',
      );
    },
  );

  it('uses the public Host header when the runtime normalizes nextUrl to its bind address', () => {
    const request = new NextRequest('http://127.0.0.1:3000/settings?section=privacy', {
      headers: { host: 'www.droolhouse.com..:443' },
    });
    const response = proxy(request);

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://wetdrool.com/settings?section=privacy');
  });

  it.each([
    'http://localhost:3000/onboarding?from=test',
    'https://preview.droolhouse.com/signin',
    'https://droolhouse.com.example/signin',
    'https://tenant.example/signin',
    'https://wetdrool.com/signin',
  ])('does not redirect a non-legacy deployment host: %s', (url) => {
    const response = proxy(new NextRequest(url));

    expect(response.headers.get('location')).toBeNull();
  });

  it.each([
    'droolhouse.com.:65536',
    'droolhouse.com.example',
    'droolhouse.com..example',
    'droolhouse.com@wetdrool.com',
    ' droolhouse.com',
  ])('rejects a non-exact or invalid public Host header: %s', (host) => {
    expect(legacyHostRedirect(new URL('http://127.0.0.1:3000/path'), host)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { isLocalOrUnspecifiedHostname, isLoopbackHostname } from '../src/network-security.ts';

describe('nonlocal hostname policy', () => {
  it.each([
    'localhost',
    'LOCALHOST.',
    'app.localhost',
    'app.localhost.',
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '::1',
    '[::1]',
    '::',
    '[::]',
    '::ffff:127.0.0.1',
    '[::ffff:7f00:1]',
    '::ffff:0.0.0.0',
  ])('classifies %s as local or unspecified', (hostname) => {
    expect(isLocalOrUnspecifiedHostname(hostname)).toBe(true);
  });

  it.each([
    'wetdrool.com',
    'localhost.example',
    'examplelocalhost',
    '10.0.0.1',
    '169.254.10.20',
    '192.168.1.1',
    '::ffff:10.0.0.1',
    '2001:db8::1',
  ])('does not misclassify deployable/private endpoint %s', (hostname) => {
    expect(isLocalOrUnspecifiedHostname(hostname)).toBe(false);
  });

  it.each(['0.0.0.0', '::', '[::]', '::ffff:0.0.0.0'])(
    'does not mistake unspecified bind address %s for loopback',
    (hostname) => {
      expect(isLoopbackHostname(hostname)).toBe(false);
    },
  );
});

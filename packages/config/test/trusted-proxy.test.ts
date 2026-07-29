import type { IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import { createTrustedProxyPolicy, parseTrustedProxyCidrs } from '../src/trusted-proxy.ts';

describe('trusted proxy CIDR configuration', () => {
  it('defaults to transport-peer addressing and parses explicit IP ranges', () => {
    expect(parseTrustedProxyCidrs(undefined)).toEqual([]);
    expect(parseTrustedProxyCidrs('')).toEqual([]);
    expect(
      parseTrustedProxyCidrs('127.0.0.1/32, 10.42.0.0/24, 2001:db8::1, 2001:db8::/64'),
    ).toEqual(['127.0.0.1/32', '10.42.0.0/24', '2001:db8::1', '2001:db8::/64']);
  });

  it.each([
    'proxy.internal',
    '010.0.0.1',
    '0x7f.0.0.1',
    '127.1',
    '127.0.0.1/0',
    '0.0.0.0/0',
    '0.0.0.0/1',
    '128.0.0.0/1',
    '10.0.0.0/8',
    '::/0',
    '::/1',
    '8000::/1',
    '2001:db8::/63',
    '127.0.0.1/33',
    '2001:db8::/129',
    '127.0.0.1/not-a-prefix',
    '127.0.0.1/32/1',
    '127.0.0.1,,10.0.0.1',
    '127.0.0.1,127.0.0.1',
    '10.42.0.1/24,10.42.0.200/24',
    '::ffff:127.0.0.1',
  ])('rejects unsafe or malformed allowlist value %s', (value) => {
    expect(() => parseTrustedProxyCidrs(value)).toThrow(/TRUSTED_PROXY_CIDRS/u);
  });

  it('ignores forwarding headers unless the transport peer is explicitly trusted', () => {
    const noProxy = createTrustedProxyPolicy([]);
    expect(noProxy.clientIp(request('127.0.0.1', '203.0.113.8'))).toBe('127.0.0.1');

    const loopbackOnly = createTrustedProxyPolicy(['127.0.0.1/32']);
    expect(loopbackOnly.clientIp(request('198.51.100.2', '203.0.113.8'))).toBe('198.51.100.2');
    expect(loopbackOnly.clientIp(request('127.0.0.1', '203.0.113.8'))).toBe('203.0.113.8');
  });

  it('walks trusted hops right-to-left and stops before attacker-controlled history', () => {
    const edgeOnly = createTrustedProxyPolicy(['127.0.0.1/32']);
    expect(edgeOnly.clientIp(request('127.0.0.1', '198.51.100.8, 10.42.0.9'))).toBe('10.42.0.9');

    const edgeAndInternal = createTrustedProxyPolicy(['127.0.0.1/32', '10.42.0.0/24']);
    expect(edgeAndInternal.clientIp(request('127.0.0.1', '198.51.100.8, 10.42.0.9'))).toBe(
      '198.51.100.8',
    );
  });

  it('canonicalizes equivalent addresses and fails malformed forwarded values to one socket bucket', () => {
    const policy = createTrustedProxyPolicy(['127.0.0.1/32']);
    expect(policy.clientIp(request('::ffff:127.0.0.1', '::ffff:192.0.2.9'))).toBe('192.0.2.9');
    expect(policy.clientIp(request('127.0.0.1', 'not-an-ip'))).toBe('127.0.0.1');
    expect(policy.clientIp(request('127.0.0.1', '010.0.0.1'))).toBe('127.0.0.1');
  });
});

function request(remoteAddress: string, forwardedFor?: string): IncomingMessage {
  return {
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    socket: { remoteAddress },
  } as IncomingMessage;
}

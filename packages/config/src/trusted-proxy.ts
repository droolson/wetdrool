import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

import proxyaddr from '@fastify/proxy-addr';
import ipaddr from 'ipaddr.js';

const MAXIMUM_TRUSTED_PROXY_RANGES = 32;
const MAXIMUM_TRUSTED_PROXY_VALUE_BYTES = 4_096;

/**
 * Parses an explicit proxy IP/CIDR allowlist. An empty list means that
 * forwarded headers are ignored and the transport peer remains the client IP.
 *
 * Broad ranges are intentionally forbidden (IPv4 must be /24 or narrower and
 * IPv6 /64 or narrower): trusting an Internet-scale range would let clients
 * choose the identity used by connection and rate limits.
 */
export function parseTrustedProxyCidrs(value: string | undefined): readonly string[] {
  const source = value?.trim();
  if (source === undefined || source === '') {
    return [];
  }
  if (Buffer.byteLength(source, 'utf8') > MAXIMUM_TRUSTED_PROXY_VALUE_BYTES) {
    throw new Error('TRUSTED_PROXY_CIDRS is too large.');
  }

  const ranges = source.split(',').map((entry) => entry.trim());
  if (ranges.length > MAXIMUM_TRUSTED_PROXY_RANGES || ranges.some((entry) => entry.length === 0)) {
    throw new Error(
      `TRUSTED_PROXY_CIDRS must contain between 1 and ${String(MAXIMUM_TRUSTED_PROXY_RANGES)} explicit IP/CIDR entries.`,
    );
  }

  const unique = new Set<string>();
  const canonicalRanges: string[] = [];
  for (const range of ranges) {
    const separator = range.indexOf('/');
    const address = separator === -1 ? range : range.slice(0, separator);
    const suffix = separator === -1 ? undefined : range.slice(separator + 1);
    if (separator !== range.lastIndexOf('/')) {
      throw new Error('TRUSTED_PROXY_CIDRS entries must be IP addresses or CIDR ranges.');
    }
    if (address.includes('%') || isIP(address) === 0 || !ipaddr.isValid(address)) {
      throw new Error('TRUSTED_PROXY_CIDRS entries must use literal IPv4 or IPv6 addresses.');
    }
    const parsedAddress = ipaddr.parse(address);
    if (parsedAddress instanceof ipaddr.IPv6 && parsedAddress.isIPv4MappedAddress()) {
      throw new Error(
        'TRUSTED_PROXY_CIDRS must express IPv4-mapped addresses in canonical IPv4 form.',
      );
    }
    const family = parsedAddress.kind() === 'ipv4' ? 4 : 6;
    const maximumPrefix = family === 4 ? 32 : 128;
    const minimumPrefix = family === 4 ? 24 : 64;
    let prefix = maximumPrefix;
    if (suffix !== undefined) {
      if (!/^[0-9]{1,3}$/u.test(suffix)) {
        throw new Error('TRUSTED_PROXY_CIDRS entries must use numeric CIDR prefixes.');
      }
      prefix = Number(suffix);
      if (!Number.isInteger(prefix) || prefix < minimumPrefix || prefix > maximumPrefix) {
        throw new Error(
          `TRUSTED_PROXY_CIDRS prefixes must be between ${String(minimumPrefix)} and ${String(maximumPrefix)}.`,
        );
      }
    }
    const networkAddress =
      family === 4
        ? ipaddr.IPv4.networkAddressFromCIDR(`${address}/${String(prefix)}`)
        : ipaddr.IPv6.networkAddressFromCIDR(`${address}/${String(prefix)}`);
    const uniqueKey = `${networkAddress.toNormalizedString()}/${String(prefix)}`;
    if (unique.has(uniqueKey)) {
      throw new Error('TRUSTED_PROXY_CIDRS entries must be unique.');
    }
    unique.add(uniqueKey);
    canonicalRanges.push(
      suffix === undefined
        ? parsedAddress.toString()
        : `${networkAddress.toString()}/${String(prefix)}`,
    );
  }
  return canonicalRanges;
}

export type TrustedProxyFunction = (address: string, hop: number) => boolean;

export interface TrustedProxyPolicy {
  readonly cidrs: readonly string[];
  readonly trustProxy: TrustedProxyFunction;
  clientIp(request: IncomingMessage): string;
}

/**
 * Compiles one canonical client-IP policy for Fastify and raw HTTP/WebSocket
 * servers. Forwarded addresses are walked from the transport peer toward the
 * client and stop at the nearest untrusted hop.
 */
export function createTrustedProxyPolicy(cidrs: readonly string[]): TrustedProxyPolicy {
  const validated = parseTrustedProxyCidrs(cidrs.join(','));
  const trustProxy: TrustedProxyFunction =
    validated.length === 0 ? () => false : proxyaddr.compile([...validated]);

  return {
    cidrs: validated,
    trustProxy,
    clientIp(request) {
      const socketIp = canonicalIp(request.socket.remoteAddress) ?? 'unknown';
      if (validated.length === 0 || socketIp === 'unknown') {
        return socketIp;
      }
      try {
        return canonicalIp(proxyaddr(request, trustProxy)) ?? socketIp;
      } catch {
        return socketIp;
      }
    },
  };
}

function canonicalIp(value: string | undefined): string | undefined {
  if (value === undefined || value.includes('%') || isIP(value) === 0 || !ipaddr.isValid(value)) {
    return undefined;
  }
  const address = ipaddr.parse(value);
  if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
    return address.toIPv4Address().toString();
  }
  return address.toString();
}

import ipaddr from 'ipaddr.js';

/**
 * Returns true for hostnames that cannot identify a nonlocal deployment
 * endpoint: localhost names, loopback addresses, and unspecified bind
 * addresses. URL.hostname may retain IPv6 brackets, so both forms are
 * accepted. IPv4-mapped IPv6 addresses are classified by their IPv4 value.
 */
export function isLocalOrUnspecifiedHostname(hostname: string): boolean {
  if (isLoopbackHostname(hostname)) {
    return true;
  }

  const address = parseAddress(hostname);
  return address?.range() === 'unspecified';
}

/**
 * Returns true only for loopback IPs and the special-use localhost DNS suffix.
 * Unspecified bind addresses such as 0.0.0.0 and :: deliberately return false.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.+$/u, '');

  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }

  return parseAddress(normalized)?.range() === 'loopback';
}

function parseAddress(hostname: string): ipaddr.IPv4 | ipaddr.IPv6 | undefined {
  const addressText =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (!ipaddr.isValid(addressText)) {
    return undefined;
  }

  const parsed = ipaddr.parse(addressText);
  return parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()
    ? parsed.toIPv4Address()
    : parsed;
}

export const CANONICAL_ORIGIN = 'https://woke.social';

const LEGACY_HOSTNAMES = new Set(['sociallywoke.com', 'www.sociallywoke.com']);
const REQUEST_HOST_PATTERN =
  /^(?<hostname>(?:sociallywoke\.com|www\.sociallywoke\.com)\.*)(?::(?<port>[0-9]{1,5}))?$/iu;

function normalizeDnsHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, '');
}

export function legacyHostRedirect(input: URL, requestHost = input.host): URL | undefined {
  const match = REQUEST_HOST_PATTERN.exec(requestHost);
  const matchedHostname = match?.groups?.['hostname'];
  const hostname =
    matchedHostname === undefined ? undefined : normalizeDnsHostname(matchedHostname);
  const port = match?.groups?.['port'];
  if (
    hostname === undefined ||
    !LEGACY_HOSTNAMES.has(hostname) ||
    (port !== undefined && Number(port) > 65_535)
  ) {
    return undefined;
  }

  const destination = new URL(input.href);
  destination.protocol = 'https:';
  destination.hostname = 'woke.social';
  destination.port = '';
  destination.username = '';
  destination.password = '';
  destination.hash = '';
  return destination;
}

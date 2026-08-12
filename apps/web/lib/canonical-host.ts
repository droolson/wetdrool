export const CANONICAL_ORIGIN = 'https://wetdrool.com';

const LEGACY_HOSTNAMES = new Set(['droolhouse.com', 'www.droolhouse.com', 'www.wetdrool.com']);
const REQUEST_HOST_PATTERN =
  /^(?<hostname>(?:droolhouse\.com|www\.droolhouse\.com|www\.wetdrool\.com)\.*)(?::(?<port>[0-9]{1,5}))?$/iu;

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
  destination.hostname = 'wetdrool.com';
  destination.port = '';
  destination.username = '';
  destination.password = '';
  destination.hash = '';
  return destination;
}

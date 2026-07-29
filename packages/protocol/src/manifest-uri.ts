import { cidSchema } from './schema-primitives.js';

const MAX_MANIFEST_URI_BYTES = 200;
const ARWEAVE_TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const HTTPS_HOST_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u;

export type WokeManifestUriScheme = 'ar' | 'https' | 'ipfs' | 'local';

export interface ParsedWokeManifestUri {
  readonly cid: string;
  readonly scheme: WokeManifestUriScheme;
  readonly uri: string;
}

/**
 * Parses the exact manifest-locator grammar accepted by the WokeNet program.
 * HTTPS locators are parsed only to extract their final CID path segment; this
 * helper never fetches a provider-controlled URL.
 */
export function parseWokeManifestUri(value: string): ParsedWokeManifestUri | undefined {
  if (!hasSafeWireEncoding(value)) {
    return undefined;
  }

  for (const scheme of ['ipfs', 'local'] as const) {
    const prefix = `${scheme}://`;
    if (value.startsWith(prefix)) {
      const cid = canonicalManifestCid(value.slice(prefix.length));
      return cid === undefined ? undefined : { cid, scheme, uri: value };
    }
  }

  if (value.startsWith('ar://')) {
    const locator = value.slice('ar://'.length);
    const separator = locator.indexOf('/');
    if (separator < 0 || locator.indexOf('/', separator + 1) >= 0) {
      return undefined;
    }
    const transactionId = locator.slice(0, separator);
    const cid = canonicalManifestCid(locator.slice(separator + 1));
    return ARWEAVE_TRANSACTION_ID_PATTERN.test(transactionId) && cid !== undefined
      ? { cid, scheme: 'ar', uri: value }
      : undefined;
  }

  if (value.startsWith('https://')) {
    const locator = value.slice('https://'.length);
    if (locator.includes('?') || locator.includes('#')) {
      return undefined;
    }
    const separator = locator.indexOf('/');
    if (separator < 0) {
      return undefined;
    }
    const authority = locator.slice(0, separator);
    const segments = locator.slice(separator + 1).split('/');
    const cid = canonicalManifestCid(segments.at(-1));
    return isHttpsAuthority(authority) &&
      segments.every((segment) => segment.length > 0) &&
      cid !== undefined
      ? { cid, scheme: 'https', uri: value }
      : undefined;
  }

  return undefined;
}

export function extractWokeManifestCid(value: string): string | undefined {
  return parseWokeManifestUri(value)?.cid;
}

function canonicalManifestCid(value: string | undefined): string | undefined {
  const parsed = cidSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function hasSafeWireEncoding(value: string): boolean {
  const bytes = new TextEncoder().encode(value);
  return (
    bytes.length >= 1 &&
    bytes.length <= MAX_MANIFEST_URI_BYTES &&
    bytes.every(
      (byte) => byte >= 0x21 && byte <= 0x7e && ![0x22, 0x27, 0x3c, 0x3e, 0x5c].includes(byte),
    )
  );
}

function isHttpsAuthority(value: string): boolean {
  const separator = value.lastIndexOf(':');
  const hasPort = separator >= 0;
  const host = hasPort ? value.slice(0, separator) : value;
  const port = hasPort ? value.slice(separator + 1) : undefined;
  if (
    host.includes(':') ||
    !host.split('.').every((label) => HTTPS_HOST_LABEL_PATTERN.test(label))
  ) {
    return false;
  }
  if (port === undefined) {
    return true;
  }
  if (!/^\d{1,5}$/u.test(port)) {
    return false;
  }
  const portNumber = Number(port);
  return portNumber >= 1 && portNumber <= 65_535;
}

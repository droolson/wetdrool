import type { ContentAddressedStorage } from '@wetdrool/storage';

import {
  LOCAL_CAS_CONTENT_TYPE,
  LOCAL_CAS_EXPECTED_CID_HEADER,
  LOCAL_CAS_ROUTE,
} from './local-cas-contract';
import {
  isLoopbackHostname,
  LocalCasConfigurationError,
  readLocalCasConfig,
  type LocalCasConfig,
} from './local-cas-config';
import {
  createLocalCasStorage,
  LocalCasGateway,
  LocalCasGatewayError,
  type LocalCasStorageFactory,
} from './local-cas-gateway';

type Environment = Readonly<Record<string, string | undefined>>;

export interface LocalCasRouteOptions {
  readonly environment?: Environment;
  readonly storageFactory?: LocalCasStorageFactory;
}

class LocalCasRequestError extends Error {
  override readonly name = 'LocalCasRequestError';

  constructor(
    message: string,
    readonly code:
      | 'body-length-invalid'
      | 'body-too-large'
      | 'content-encoding-unsupported'
      | 'content-type-unsupported'
      | 'origin-not-allowed'
      | 'secret-field-rejected',
    readonly status: number,
  ) {
    super(message);
  }
}

export async function handleLocalCasWriteRequest(
  request: Request,
  options: LocalCasRouteOptions = {},
): Promise<Response> {
  let config: LocalCasConfig | null;
  try {
    config = readLocalCasConfig(options.environment);
  } catch (error) {
    if (error instanceof LocalCasConfigurationError) {
      return errorResponse(
        503,
        'local-cas-disabled',
        'The localnet content write boundary is unavailable.',
      );
    }
    throw error;
  }
  if (config === null) {
    return errorResponse(
      503,
      'local-cas-disabled',
      'The localnet content write boundary is unavailable.',
    );
  }

  try {
    assertAllowedRequest(request, config);
    const expectedCid = request.headers.get(LOCAL_CAS_EXPECTED_CID_HEADER) ?? '';
    const declaredLength = parseDeclaredLength(request.headers.get('content-length'), config);
    const bytes = await readBoundedBody(request, config.maximumObjectBytes, declaredLength);
    const storage = (options.storageFactory ?? createLocalCasStorage)(config);
    const result = await new LocalCasGateway(storage, config.maximumObjectBytes).put(
      bytes,
      expectedCid,
    );

    return Response.json(result, {
      status: result.outcome === 'stored' ? 201 : 200,
      headers: responseHeaders({
        etag: `"${result.receipt.cid}"`,
      }),
    });
  } catch (error) {
    if (error instanceof LocalCasRequestError) {
      return errorResponse(error.status, error.code, error.message);
    }
    if (error instanceof LocalCasGatewayError) {
      const status =
        error.code === 'invalid-cid'
          ? 400
          : error.code === 'cid-mismatch'
            ? 422
            : error.code === 'invalid-envelope'
              ? 422
              : error.code === 'integrity-failure'
                ? 502
                : 503;
      return errorResponse(status, error.code, error.message);
    }
    return errorResponse(
      503,
      'storage-failure',
      'The local content store could not verify the submitted object.',
    );
  }
}

function assertAllowedRequest(request: Request, config: LocalCasConfig): void {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    throw new LocalCasRequestError(
      'The request does not target the configured local origin.',
      'origin-not-allowed',
      403,
    );
  }

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const fetchSite = request.headers.get('sec-fetch-site');
  const allowedOriginUrl = new URL(config.allowedOrigin);
  if (
    requestUrl.protocol !== 'http:' ||
    !isLoopbackHostname(requestUrl.hostname) ||
    requestUrl.port !== allowedOriginUrl.port ||
    requestUrl.username !== '' ||
    requestUrl.password !== '' ||
    requestUrl.pathname !== LOCAL_CAS_ROUTE ||
    requestUrl.search !== '' ||
    requestUrl.hash !== '' ||
    origin !== config.allowedOrigin ||
    host === null ||
    host.toLowerCase() !== allowedOriginUrl.host.toLowerCase() ||
    (fetchSite !== null && fetchSite !== 'same-origin') ||
    hasInconsistentForwardingHeaders(request.headers, allowedOriginUrl, host)
  ) {
    throw new LocalCasRequestError(
      'The request does not target the configured local origin.',
      'origin-not-allowed',
      403,
    );
  }

  if (request.headers.get('content-type') !== LOCAL_CAS_CONTENT_TYPE) {
    throw new LocalCasRequestError(
      `Content-Type must be exactly ${LOCAL_CAS_CONTENT_TYPE}.`,
      'content-type-unsupported',
      415,
    );
  }
  const contentEncoding = request.headers.get('content-encoding');
  if (contentEncoding !== null && contentEncoding !== 'identity') {
    throw new LocalCasRequestError(
      'Compressed or transformed request bodies are not accepted.',
      'content-encoding-unsupported',
      415,
    );
  }
  if (hasSecretMaterialHeaders(request.headers)) {
    throw new LocalCasRequestError(
      'Private key, seed, recovery, and PRF material are not accepted by this route.',
      'secret-field-rejected',
      400,
    );
  }
}

function parseDeclaredLength(value: string | null, config: LocalCasConfig): number | undefined {
  if (value === null) {
    return undefined;
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new LocalCasRequestError(
      'Content-Length must be a canonical nonnegative decimal integer.',
      'body-length-invalid',
      400,
    );
  }

  const byteLength = Number(value);
  if (!Number.isSafeInteger(byteLength)) {
    throw new LocalCasRequestError(
      'Content-Length is outside the supported integer range.',
      'body-length-invalid',
      400,
    );
  }
  if (byteLength > config.maximumObjectBytes) {
    throw new LocalCasRequestError(
      'The request body exceeds the configured local CAS limit.',
      'body-too-large',
      413,
    );
  }
  return byteLength;
}

async function readBoundedBody(
  request: Request,
  maximumObjectBytes: number,
  declaredLength: number | undefined,
): Promise<Uint8Array> {
  if (request.body === null) {
    throw new LocalCasRequestError(
      'A nonempty request body is required.',
      'body-length-invalid',
      400,
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumObjectBytes) {
        await reader.cancel('local CAS body limit exceeded');
        throw new LocalCasRequestError(
          'The request body exceeds the configured local CAS limit.',
          'body-too-large',
          413,
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  if (byteLength === 0 || (declaredLength !== undefined && declaredLength !== byteLength)) {
    throw new LocalCasRequestError(
      'Content-Length does not match the received nonempty body.',
      'body-length-invalid',
      400,
    );
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function hasInconsistentForwardingHeaders(
  headers: Headers,
  allowedOriginUrl: URL,
  directHost: string,
): boolean {
  if (headers.has('forwarded')) return true;

  const allowedNames = new Set([
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-proto',
  ]);
  for (const [name] of headers) {
    if (name.startsWith('x-forwarded-') && !allowedNames.has(name)) {
      return true;
    }
  }

  const forwardedFor = headers.get('x-forwarded-for');
  const forwardedHost = headers.get('x-forwarded-host');
  const forwardedPort = headers.get('x-forwarded-port');
  const forwardedProto = headers.get('x-forwarded-proto');
  const values = [forwardedFor, forwardedHost, forwardedPort, forwardedProto];
  if (values.every((value) => value === null)) return false;

  // Next's Node server fills this exact tuple before an App Route runs. Treat
  // it only as consistency evidence: the direct browser Origin and Host above
  // remain authoritative, and caller-supplied forwarding values cannot
  // override either one.
  const expectedPort = allowedOriginUrl.port || '80';
  if (
    forwardedFor === null ||
    forwardedHost === null ||
    forwardedPort === null ||
    forwardedProto === null
  ) {
    return true;
  }
  return (
    forwardedHost.toLowerCase() !== directHost.toLowerCase() ||
    forwardedHost.toLowerCase() !== allowedOriginUrl.host.toLowerCase() ||
    forwardedPort !== expectedPort ||
    forwardedProto !== 'http' ||
    !isLoopbackForwardedAddress(forwardedFor)
  );
}

function isLoopbackForwardedAddress(value: string | null): boolean {
  if (value === null) return false;
  const normalized = value.toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

function hasSecretMaterialHeaders(headers: Headers): boolean {
  return [
    'x-wetdrool-private-key',
    'x-wetdrool-prf',
    'x-wetdrool-prf-output',
    'x-wetdrool-recovery-material',
    'x-wetdrool-seed',
  ].some((name) => headers.has(name));
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    {
      status,
      headers: responseHeaders(),
    },
  );
}

function responseHeaders(additional: Readonly<Record<string, string>> = {}): HeadersInit {
  return {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    ...additional,
  };
}

export type { ContentAddressedStorage };
export { LOCAL_CAS_CONTENT_TYPE, LOCAL_CAS_EXPECTED_CID_HEADER } from './local-cas-contract';

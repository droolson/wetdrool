const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);

export interface RegistrationResponseForServer {
  readonly id: string;
  readonly rawId: string;
  readonly type: 'public-key';
  readonly authenticatorAttachment?: 'cross-platform' | 'platform';
  readonly clientExtensionResults: Record<string, never>;
  readonly response: {
    readonly clientDataJSON: string;
    readonly attestationObject: string;
    readonly transports: readonly string[];
  };
}

export interface AuthenticationResponseForServer {
  readonly id: string;
  readonly rawId: string;
  readonly type: 'public-key';
  readonly authenticatorAttachment?: 'cross-platform' | 'platform';
  readonly clientExtensionResults: Record<string, never>;
  readonly response: {
    readonly clientDataJSON: string;
    readonly authenticatorData: string;
    readonly signature: string;
    readonly userHandle?: string;
  };
}

export function withPrfEvaluation<
  T extends PublicKeyCredentialCreationOptions | PublicKeyCredentialRequestOptions,
>(options: T, first: Uint8Array): T {
  return {
    ...options,
    extensions: {
      ...options.extensions,
      prf: { eval: { first: first.slice() } },
    },
  } as T;
}

export function registrationResponseForServer(
  credential: PublicKeyCredential,
): RegistrationResponseForServer {
  const response = credential.response;
  if (!isAttestationResponse(response)) {
    throw new TypeError('The passkey registration response is unavailable.');
  }
  const rawId = encodeBase64Url(new Uint8Array(credential.rawId));
  assertCredentialIdentity(credential, rawId);
  const attachment = authenticatorAttachment(credential.authenticatorAttachment);
  const transports =
    typeof response.getTransports === 'function'
      ? response.getTransports().filter((transport) => TRANSPORTS.has(transport))
      : [];
  return {
    id: credential.id,
    rawId,
    type: 'public-key',
    ...(attachment === undefined ? {} : { authenticatorAttachment: attachment }),
    // PRF results and every other client extension output are deliberately
    // omitted. The relying party does not need them to verify this ceremony.
    clientExtensionResults: {},
    response: {
      clientDataJSON: encodeBase64Url(new Uint8Array(response.clientDataJSON)),
      attestationObject: encodeBase64Url(new Uint8Array(response.attestationObject)),
      transports,
    },
  };
}

export function authenticationResponseForServer(
  credential: PublicKeyCredential,
): AuthenticationResponseForServer {
  const response = credential.response;
  if (!isAssertionResponse(response)) {
    throw new TypeError('The passkey authentication response is unavailable.');
  }
  const rawId = encodeBase64Url(new Uint8Array(credential.rawId));
  assertCredentialIdentity(credential, rawId);
  const attachment = authenticatorAttachment(credential.authenticatorAttachment);
  const userHandle =
    response.userHandle === null ? undefined : encodeBase64Url(new Uint8Array(response.userHandle));
  return {
    id: credential.id,
    rawId,
    type: 'public-key',
    ...(attachment === undefined ? {} : { authenticatorAttachment: attachment }),
    clientExtensionResults: {},
    response: {
      clientDataJSON: encodeBase64Url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: encodeBase64Url(new Uint8Array(response.authenticatorData)),
      signature: encodeBase64Url(new Uint8Array(response.signature)),
      ...(userHandle === undefined ? {} : { userHandle }),
    },
  };
}

export function extractPrfOutput(credential: PublicKeyCredential): Uint8Array | undefined {
  const first = credential.getClientExtensionResults().prf?.results?.first;
  if (first === undefined) return undefined;
  const output = copyBuffer(first);
  clearBufferSource(first);
  if (output.byteLength !== 32) {
    output.fill(0);
    return undefined;
  }
  return output;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function decodeBase64Url(value: string, maximumBytes = 1_024): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    value.length > Math.ceil((maximumBytes * 4) / 3) + 4 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new TypeError('The passkey value is not canonical base64url.');
  }
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new TypeError('The passkey value is not canonical base64url.');
  }
  const bytes = Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > maximumBytes ||
    encodeBase64Url(bytes) !== value
  ) {
    throw new TypeError('The passkey value is not canonical base64url.');
  }
  return bytes;
}

function copyBuffer(value: BufferSource): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}

function clearBufferSource(value: BufferSource): void {
  try {
    if (value instanceof ArrayBuffer) {
      new Uint8Array(value).fill(0);
    } else {
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(0);
    }
  } catch {
    // The browser may expose an immutable or detached view. The copied output
    // remains caller-owned and is cleared by every flow.
  }
}

function assertCredentialIdentity(credential: PublicKeyCredential, rawId: string): void {
  if (
    credential.type !== 'public-key' ||
    credential.id !== rawId ||
    !BASE64URL_PATTERN.test(credential.id)
  ) {
    throw new TypeError('The passkey credential identifier is invalid.');
  }
}

function authenticatorAttachment(value: string | null): 'cross-platform' | 'platform' | undefined {
  return value === 'cross-platform' || value === 'platform' ? value : undefined;
}

function isAttestationResponse(
  value: AuthenticatorResponse,
): value is AuthenticatorAttestationResponse {
  return (
    value.clientDataJSON instanceof ArrayBuffer &&
    'attestationObject' in value &&
    value.attestationObject instanceof ArrayBuffer
  );
}

function isAssertionResponse(
  value: AuthenticatorResponse,
): value is AuthenticatorAssertionResponse {
  return (
    value.clientDataJSON instanceof ArrayBuffer &&
    'authenticatorData' in value &&
    value.authenticatorData instanceof ArrayBuffer &&
    'signature' in value &&
    value.signature instanceof ArrayBuffer &&
    'userHandle' in value &&
    (value.userHandle === null || value.userHandle instanceof ArrayBuffer)
  );
}

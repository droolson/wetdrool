export type BrowserAuthErrorCode =
  | 'browser-unsupported'
  | 'ceremony-cancelled'
  | 'credential-invalid'
  | 'csrf-unavailable'
  | 'key-wrapper-failed'
  | 'key-wrapper-invalid'
  | 'network-unavailable'
  | 'origin-invalid'
  | 'prf-required'
  | 'server-invalid'
  | 'service-rejected';

const USER_MESSAGES: Record<BrowserAuthErrorCode, string> = {
  'browser-unsupported':
    'This browser cannot complete the required user-verifying passkey ceremony.',
  'ceremony-cancelled': 'The passkey prompt was cancelled or timed out. No key was sent.',
  'credential-invalid': 'The passkey response could not be used safely. Please try again.',
  'csrf-unavailable':
    'This tab cannot safely change the current session. Sign in with your passkey again first.',
  'key-wrapper-failed':
    'The encrypted account-key wrapper could not be prepared. No service credential was committed.',
  'key-wrapper-invalid':
    'No single valid encrypted account-key wrapper matched the passkey used for verification.',
  'network-unavailable': 'The replaceable authentication service could not be reached.',
  'origin-invalid': 'The authentication service URL is not a permitted secure origin.',
  'prf-required':
    'This passkey does not expose the PRF capability required to protect an embedded account key. No service credential was committed.',
  'server-invalid': 'The authentication service returned an invalid response.',
  'service-rejected': 'The authentication service rejected the ceremony. Please start again.',
};

export class BrowserAuthError extends Error {
  override readonly name = 'BrowserAuthError';

  constructor(readonly code: BrowserAuthErrorCode) {
    super(USER_MESSAGES[code]);
  }
}

export function passkeyPromptError(error: unknown): BrowserAuthError {
  const name =
    typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
      ? error.name
      : '';
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return new BrowserAuthError('ceremony-cancelled');
  }
  if (name === 'SecurityError') {
    return new BrowserAuthError('origin-invalid');
  }
  return new BrowserAuthError('credential-invalid');
}

export type AuthServiceErrorCode =
  | 'account-unavailable'
  | 'bundle-invalid'
  | 'ceremony-unavailable'
  | 'credential-duplicate'
  | 'credential-unavailable'
  | 'csrf-invalid'
  | 'database-error'
  | 'invalid-request'
  | 'last-credential'
  | 'origin-invalid'
  | 'session-required'
  | 'step-up-required'
  | 'verification-failed';

export class AuthServiceError extends Error {
  override readonly name = 'AuthServiceError';

  constructor(
    message: string,
    readonly code: AuthServiceErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

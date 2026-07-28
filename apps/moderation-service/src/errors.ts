export type ModerationErrorCode =
  | 'action-not-found'
  | 'appeal-decision-not-found'
  | 'appeal-not-found'
  | 'case-access-denied'
  | 'case-conflict'
  | 'case-not-found'
  | 'conflicting-object'
  | 'conflict-of-interest'
  | 'corrupt-storage'
  | 'database-unavailable'
  | 'encryption-failed'
  | 'encryption-unavailable'
  | 'invalid-object'
  | 'invalid-transition'
  | 'label-provider-mismatch'
  | 'label-subject-mismatch'
  | 'locked'
  | 'retention-failed'
  | 'superseded-label-not-found'
  | 'unauthorized';

export class ModerationServiceError extends Error {
  override readonly name = 'ModerationServiceError';

  constructor(
    message: string,
    readonly code: ModerationErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

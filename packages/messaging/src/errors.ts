export type PairwiseMessagingErrorCode =
  | 'AUTHORIZATION_CHANGED'
  | 'CLOSED'
  | 'DECRYPTION_FAILED'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_UNAUTHORIZED'
  | 'DIRECTORY_PROTOCOL_ERROR'
  | 'DIRECTORY_UNAVAILABLE'
  | 'DUPLICATE_MESSAGE'
  | 'ENCRYPTION_FAILED'
  | 'ENGINE_UNAVAILABLE'
  | 'GROUP_ENCRYPTION_DISABLED'
  | 'INVALID_ENVELOPE'
  | 'INVALID_INPUT'
  | 'PRODUCTION_STORAGE_UNAVAILABLE'
  | 'SESSION_UNAVAILABLE'
  | 'UNSUPPORTED_ENGINE_REQUEST'
  | 'WRONG_RECIPIENT';

const PUBLIC_MESSAGES: Readonly<Record<PairwiseMessagingErrorCode, string>> = {
  AUTHORIZATION_CHANGED: 'The current device authorization changed during the operation.',
  CLOSED: 'The pairwise messaging device is closed.',
  DECRYPTION_FAILED: 'The pairwise ciphertext could not be authenticated and decrypted.',
  DEVICE_NOT_FOUND: 'The requested device is unavailable.',
  DEVICE_UNAUTHORIZED: 'The requested device is not currently authorized.',
  DIRECTORY_PROTOCOL_ERROR: 'The key directory returned an invalid response.',
  DIRECTORY_UNAVAILABLE: 'The key directory is unavailable.',
  DUPLICATE_MESSAGE: 'The pairwise message has already been processed.',
  ENCRYPTION_FAILED: 'The pairwise message could not be encrypted.',
  ENGINE_UNAVAILABLE: 'The pairwise cryptographic engine is unavailable.',
  GROUP_ENCRYPTION_DISABLED: 'Group and room encryption are disabled.',
  INVALID_ENVELOPE: 'The pairwise ciphertext envelope is invalid.',
  INVALID_INPUT: 'The pairwise messaging input is invalid.',
  PRODUCTION_STORAGE_UNAVAILABLE:
    'Volatile pairwise messaging storage is unavailable in production.',
  SESSION_UNAVAILABLE: 'A pairwise session could not be established.',
  UNSUPPORTED_ENGINE_REQUEST: 'The cryptographic engine requested a disabled operation.',
  WRONG_RECIPIENT: 'The pairwise ciphertext is addressed to a different device.',
};

export class PairwiseMessagingError extends Error {
  override readonly name = 'PairwiseMessagingError';

  constructor(readonly code: PairwiseMessagingErrorCode) {
    super(PUBLIC_MESSAGES[code]);
  }
}

export function messagingError(code: PairwiseMessagingErrorCode): PairwiseMessagingError {
  return new PairwiseMessagingError(code);
}

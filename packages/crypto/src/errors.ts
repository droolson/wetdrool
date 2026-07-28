export class CryptoInputError extends TypeError {
  override readonly name = 'CryptoInputError';
}

export class CryptoUnavailableError extends Error {
  override readonly name = 'CryptoUnavailableError';
}

export class CryptoOperationError extends Error {
  override readonly name = 'CryptoOperationError';
}

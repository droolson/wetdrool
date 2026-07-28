import { utf8Length } from './encoding.js';

export class ProtocolValidationError extends Error {
  override readonly name = 'ProtocolValidationError';
}

export function isNfc(value: string): boolean {
  return value.normalize('NFC') === value;
}

export function assertCanonicalInput(
  value: unknown,
  path = '$',
  seen = new WeakSet<object>(),
): void {
  if (typeof value === 'string') {
    if (!isNfc(value)) {
      throw new ProtocolValidationError(`${path} must use Unicode NFC normalization.`);
    }
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new ProtocolValidationError(`${path} must be a finite interoperable integer.`);
    }
    if (Object.is(value, -0)) {
      throw new ProtocolValidationError(`${path} must not be negative zero.`);
    }
    return;
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'undefined') {
    if (typeof value === 'undefined') {
      throw new ProtocolValidationError(`${path} contains undefined, which JSON cannot represent.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new ProtocolValidationError(`${path} contains a cycle.`);
    }
    seen.add(value);
    value.forEach((entry, index) => {
      assertCanonicalInput(entry, `${path}[${index}]`, seen);
    });
    seen.delete(value);
    return;
  }

  if (typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new ProtocolValidationError(`${path} must contain only plain JSON objects.`);
    }
    if (seen.has(value)) {
      throw new ProtocolValidationError(`${path} contains a cycle.`);
    }
    seen.add(value);
    for (const [key, entry] of Object.entries(value)) {
      if (!isNfc(key)) {
        throw new ProtocolValidationError(`${path} contains a non-NFC property name.`);
      }
      assertCanonicalInput(entry, `${path}.${key}`, seen);
    }
    seen.delete(value);
    return;
  }

  throw new ProtocolValidationError(`${path} contains a value JSON cannot represent.`);
}

export function hasMaximumUtf8Bytes(value: string, maximumBytes: number): boolean {
  return utf8Length(value) <= maximumBytes;
}

export function hasExactMillisecondTimestamp(value: string): boolean {
  const pattern =
    /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
  return pattern.test(value) && !Number.isNaN(Date.parse(value));
}

export function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

import { describe, expect, it } from 'vitest';

import {
  assertStrongEncodedToken,
  StaticBearerAuthorization,
} from '../src/static-bearer-authorization.js';

const token = Buffer.alloc(32, 0xa5).toString('base64url');
const authorization = `Bearer ${token}`;
const declaration = {
  declaredMediaType: 'image/png',
  processingMode: 'managed' as const,
  storagePolicy: { permanence: 'deletion-compatible' as const },
  totalBytes: 10,
};
const uploadId = 'cf0da72d-8295-4538-bb86-4a39b2becef30';

describe('StaticBearerAuthorization', () => {
  it('requires canonical base64url encoding of at least 32 token bytes', () => {
    expect(() => assertStrongEncodedToken(Buffer.alloc(31).toString('base64url'))).toThrow();
    expect(() => assertStrongEncodedToken(`${token}=`)).toThrow();
    expect(() => assertStrongEncodedToken('not a token')).toThrow();
    expect(() => assertStrongEncodedToken(token)).not.toThrow();
  });

  it('authenticates a static operator and binds generated IDs on claim', () => {
    const adapter = new StaticBearerAuthorization(token);
    expect(
      adapter.authorize({
        action: 'create',
        authorization,
        declaration,
      }),
    ).toBe(true);
    expect(
      adapter.authorize({
        action: 'read',
        authorization,
        uploadId,
      }),
    ).toBe(false);
    expect(
      adapter.authorize({
        action: 'claim',
        authorization,
        declaration,
        uploadId,
      }),
    ).toBe(true);
    for (const action of ['read', 'append', 'cancel', 'finalize'] as const) {
      expect(adapter.authorize({ action, authorization, uploadId })).toBe(true);
    }
  });

  it('rejects malformed, incorrect, and incomplete authorization without binding ownership', () => {
    const adapter = new StaticBearerAuthorization(token);
    const wrong = `Bearer ${Buffer.alloc(32, 0x5a).toString('base64url')}`;
    expect(
      adapter.authorize({
        action: 'create',
        authorization: wrong,
        declaration,
      }),
    ).toBe(false);
    expect(
      adapter.authorize({
        action: 'claim',
        authorization: `bearer ${token}`,
        declaration,
        uploadId,
      }),
    ).toBe(false);
    expect(
      adapter.authorize({
        action: 'claim',
        authorization,
        uploadId,
      }),
    ).toBe(false);
    expect(adapter.authorize({ action: 'read', authorization, uploadId })).toBe(false);
  });
});

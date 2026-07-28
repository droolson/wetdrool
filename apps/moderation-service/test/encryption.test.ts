import { describe, expect, it } from 'vitest';

import {
  ModerationKeyRing,
  parseModerationKeyRingJson,
  type EncryptedPayload,
} from '../src/encryption.js';

const keyOne = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const keyTwo = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);

describe('moderation restricted-data encryption', () => {
  it('round-trips with a versioned key and record type/id-bound AAD', () => {
    const ring = deterministicRing({ activeKeyId: 'v1', keys: { v1: keyOne } });
    const encrypted = ring.encryptJson('restricted-object:report', 'report-one', {
      summary: 'sentinel-private-report-text',
    });

    expect(encrypted).toMatchObject({ version: 1, keyId: 'v1' });
    expect(JSON.stringify(encrypted)).not.toContain('sentinel-private-report-text');
    expect(ring.decryptJson('restricted-object:report', 'report-one', encrypted)).toEqual({
      summary: 'sentinel-private-report-text',
    });
    expect(() => ring.decryptJson('restricted-object:appeal', 'report-one', encrypted)).toThrow(
      /failed authentication/u,
    );
    expect(() => ring.decryptJson('restricted-object:report', 'report-two', encrypted)).toThrow(
      /failed authentication/u,
    );
  });

  it('rejects ciphertext, tag, and key-version corruption without returning plaintext', () => {
    const ring = deterministicRing({ activeKeyId: 'v1', keys: { v1: keyOne } });
    const encrypted = ring.encryptBytes(
      'restricted-object:report',
      'report-one',
      new TextEncoder().encode('private'),
    );
    const tampered = {
      ...encrypted,
      ciphertext: flipBase64Url(encrypted.ciphertext),
    };
    expect(() => ring.decryptBytes('restricted-object:report', 'report-one', tampered)).toThrow(
      /failed authentication/u,
    );
    expect(() =>
      ring.decryptBytes('restricted-object:report', 'report-one', {
        ...encrypted,
        keyId: 'missing',
      }),
    ).toThrow(/key version is unavailable/u);
    expect(() =>
      ring.decryptBytes('restricted-object:report', 'report-one', {
        ...encrypted,
        tag: encrypted.tag.slice(1),
      }),
    ).toThrow(/malformed/u);
    expect(() =>
      ring.decryptBytes('restricted-object:report', 'report-one', {
        ...encrypted,
        tag: `${encrypted.tag.slice(0, -1)}B`,
      }),
    ).toThrow(/malformed/u);
  });

  it('decrypts old rows after active-key rotation and writes only with the new key', () => {
    const oldRing = deterministicRing({ activeKeyId: 'v1', keys: { v1: keyOne } });
    const old = oldRing.encryptJson('case-event:received', 'event-one', { state: 'received' });
    const rotated = deterministicRing({
      activeKeyId: 'v2',
      keys: { v1: keyOne, v2: keyTwo },
    });
    expect(rotated.decryptJson('case-event:received', 'event-one', old)).toEqual({
      state: 'received',
    });
    expect(
      rotated.encryptJson('case-event:received', 'event-two', { state: 'received' }).keyId,
    ).toBe('v2');
  });

  it('strictly parses canonical 32-byte base64url key rings', () => {
    const encoded = Buffer.from(keyOne).toString('base64url');
    expect(
      parseModerationKeyRingJson(JSON.stringify({ activeKeyId: 'v1', keys: { v1: encoded } }))
        .activeKeyId,
    ).toBe('v1');
    expect(() =>
      parseModerationKeyRingJson(
        JSON.stringify({
          activeKeyId: 'v1',
          keys: { v1: Buffer.alloc(8, 9).toString('base64url') },
        }),
      ),
    ).toThrow(/32 bytes/u);
    expect(
      () =>
        new ModerationKeyRing({
          activeKeyId: 'v0',
          keys: Object.fromEntries(
            Array.from({ length: 17 }, (_, index) => [`v${String(index)}`, keyOne]),
          ),
        }),
    ).toThrow(/between 1 and 16/u);
  });
});

function deterministicRing(input: {
  readonly activeKeyId: string;
  readonly keys: Readonly<Record<string, Uint8Array>>;
}): ModerationKeyRing {
  return new ModerationKeyRing({
    ...input,
    random: (size) => Uint8Array.from({ length: size }, (_, index) => 40 + index),
  });
}

function flipBase64Url(value: EncryptedPayload['ciphertext']): string {
  const first = value[0];
  return `${first === 'A' ? 'B' : 'A'}${value.slice(1)}`;
}

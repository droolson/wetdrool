import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import type { NetworkId } from '@wokesocial/protocol';

import {
  decodeCommunityDirectoryCursor,
  encodeCommunityDirectoryCursor,
  SOLANA_U64_MAX,
} from '../src/community-cursor.js';

const programId = publicKey(2);
const networkId = `wokenet:v1:${publicKey(1)}:${programId}` as NetworkId;
const otherNetworkId = `wokenet:v1:${publicKey(3)}:${programId}` as NetworkId;
const communityAddress = publicKey(4);

describe('community directory cursor', () => {
  it('round-trips the full Solana u64 slot range and binds the cursor to one network', () => {
    const cursor = encodeCommunityDirectoryCursor(
      { createdSlot: SOLANA_U64_MAX, communityAddress },
      networkId,
    );

    expect(decodeCommunityDirectoryCursor(cursor, networkId)).toEqual({
      createdSlot: SOLANA_U64_MAX,
      communityAddress,
    });
    expect(() => decodeCommunityDirectoryCursor(cursor, otherNetworkId)).toThrow(
      'Community directory cursor is invalid.',
    );
  });

  it.each([
    '-1',
    '01',
    '18446744073709551616',
    '99999999999999999999999999999999999999999999999999',
  ])('rejects malformed or out-of-u64 decoded slots (%s)', (createdSlot) => {
    const valid = encodeCommunityDirectoryCursor({ createdSlot: 1n, communityAddress }, networkId);
    const payload = JSON.parse(Buffer.from(valid, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    payload['createdSlot'] = createdSlot;
    const forged = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    expect(() => decodeCommunityDirectoryCursor(forged, networkId)).toThrow(
      'Community directory cursor is invalid.',
    );
  });

  it.each([-1n, SOLANA_U64_MAX + 1n])(
    'refuses to encode an out-of-u64 slot (%s)',
    (createdSlot) => {
      expect(() =>
        encodeCommunityDirectoryCursor({ createdSlot, communityAddress }, networkId),
      ).toThrow('Community directory cursor is invalid.');
    },
  );

  it('refuses to encode an invalid community address', () => {
    expect(() =>
      encodeCommunityDirectoryCursor(
        { createdSlot: 1n, communityAddress: 'not-a-solana-address' },
        networkId,
      ),
    ).toThrow('Community directory cursor is invalid.');
  });
});

function publicKey(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, () => seed));
}

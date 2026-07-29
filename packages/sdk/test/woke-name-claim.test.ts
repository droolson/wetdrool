import { AccountRole } from '@solana/kit';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  WOKENET_SYSTEM_PROGRAM_ADDRESS,
  WOKE_HANDLE_CLAIM_ACCOUNT_SPACE,
  buildClaimRandomWokeNameInstruction,
  type WokeNetContext,
} from '../src/index.js';

const CLAIM_HANDLE_DISCRIMINATOR = [93, 142, 47, 111, 164, 134, 99, 181];
const publicKey = (fill: number): string =>
  bs58.encode(Uint8Array.from({ length: 32 }, () => fill));

const originAuthority = publicKey(1);
const rootAuthority = publicKey(2);
const payer = publicKey(3);
const identityAddress = publicKey(4);
const context: WokeNetContext = {
  endpoint: 'http://127.0.0.1:8899',
  genesisHash: publicKey(7),
  programAddress: publicKey(8),
};

describe('random .woke claim instruction', () => {
  it('derives one stable name, PDA, and exact Anchor ABI', async () => {
    const built = await buildClaimRandomWokeNameInstruction(context, {
      originAuthority,
      rootAuthority,
      payer,
      identityAddress,
      expectedIdentitySequence: 9n,
    });

    expect(built.randomName.name).toMatch(/^anon_[0-9a-hjkmnp-tv-z]{16}\.woke$/u);
    expect(built.handleClaimAddress).toBe('Hh6xbaUWPn3yp5cpkHr5bp9Zoq4VUMmVkW2MWK6eXj4q');
    expect(built.handleClaimBump).toBe(255);
    expect(built.rentExemptionSpace).toBe(WOKE_HANDLE_CLAIM_ACCOUNT_SPACE);
    expect([...built.instruction.data.subarray(0, 8)]).toEqual(CLAIM_HANDLE_DISCRIMINATOR);
    expect(readU64(built.instruction.data, 8)).toBe(9n);
    expect(built.instruction.data.subarray(16, 48)).toEqual(built.handleHash);
    expect(readU32(built.instruction.data, 48)).toBe(
      new TextEncoder().encode(built.randomName.handle).byteLength,
    );
    expect(new TextDecoder().decode(built.instruction.data.subarray(52))).toBe(
      built.randomName.handle,
    );
    expect(built.instruction.accounts).toEqual([
      { address: built.configAddress, role: AccountRole.READONLY },
      { address: identityAddress, role: AccountRole.WRITABLE },
      { address: built.handleClaimAddress, role: AccountRole.WRITABLE },
      { address: rootAuthority, role: AccountRole.READONLY_SIGNER },
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: WOKENET_SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ]);
  });

  it('is retry-stable and defensively copies the digest', async () => {
    const first = await buildClaimRandomWokeNameInstruction(context, {
      originAuthority,
      rootAuthority,
      payer,
      identityAddress,
      expectedIdentitySequence: 0n,
    });
    const originalDigest = first.handleHash.slice();
    first.handleHash.fill(255);
    const retry = await buildClaimRandomWokeNameInstruction(context, {
      originAuthority,
      rootAuthority,
      payer,
      identityAddress,
      expectedIdentitySequence: 0n,
    });
    expect(retry.handleHash).toEqual(originalDigest);
    expect(retry.instruction.data).toEqual(first.instruction.data);
    expect(retry.handleClaimAddress).toBe(first.handleClaimAddress);
  });

  it.each([-1n, 18_446_744_073_709_551_615n])(
    'rejects non-incrementable sequence %s',
    async (expectedIdentitySequence) => {
      await expect(
        buildClaimRandomWokeNameInstruction(context, {
          originAuthority,
          rootAuthority,
          payer,
          identityAddress,
          expectedIdentitySequence,
        }),
      ).rejects.toMatchObject({ code: 'invalid-sequence' });
    },
  );

  it('rejects default, malformed, and aliased accounts', async () => {
    await expect(
      buildClaimRandomWokeNameInstruction(context, {
        originAuthority: WOKENET_SYSTEM_PROGRAM_ADDRESS,
        rootAuthority,
        payer,
        identityAddress,
        expectedIdentitySequence: 0n,
      }),
    ).rejects.toMatchObject({ code: 'invalid-address' });
    await expect(
      buildClaimRandomWokeNameInstruction(context, {
        originAuthority,
        rootAuthority,
        payer: identityAddress,
        identityAddress,
        expectedIdentitySequence: 0n,
      }),
    ).rejects.toMatchObject({ code: 'alias' });
  });
});

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function readU64(bytes: Uint8Array, offset: number): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, true);
}

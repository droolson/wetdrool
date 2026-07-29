import { AccountRole } from '@solana/kit';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  WOKENET_SYSTEM_PROGRAM_ADDRESS,
  WOKE_COMMUNITY_MEMBERSHIP_ACCOUNT_SPACE,
  buildJoinCommunityInstruction,
  buildLeaveCommunityInstruction,
  buildModerateCommunityMembershipInstruction,
  deriveWokeCommunityMembershipAddress,
  deriveWokeProtocolConfigAddress,
  type WokeNetContext,
} from '../src/index.js';

const key = (byte: number): string => bs58.encode(Uint8Array.from({ length: 32 }, () => byte));
const manifestHash = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const manifestCid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const manifestUri = `ipfs://${manifestCid}`;

const context: WokeNetContext = {
  endpoint: 'https://rpc.network.woke.social',
  genesisHash: key(7),
  programAddress: key(8),
};
const community = key(10);
const memberIdentity = key(11);
const memberAuthority = key(12);
const payer = key(13);
const memberDelegation = key(14);
const creatorIdentity = key(15);
const creatorAuthority = key(16);
const creatorDelegation = key(17);

const memberCoordinates = {
  expectedMemberIdentitySequence: 4n,
  expectedMembershipStateSequence: 2n,
  expectedMembershipPolicySequence: 1n,
  expectedCommunityMembershipSequence: 8n,
} as const;

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function readU64(bytes: Uint8Array, offset: number): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true);
}

describe('member-signed community instructions', () => {
  it('derives the exact membership PDA and builds a root-authorized join', async () => {
    const [config, membershipAddress] = await Promise.all([
      deriveWokeProtocolConfigAddress(context),
      deriveWokeCommunityMembershipAddress(context, community, memberIdentity),
    ]);
    expect(membershipAddress).toBe('31CqCuAempD2MYrqyWbvf6Xd4U1JbiWsvVcH4KQ4xbXX');

    const built = await buildJoinCommunityInstruction(context, {
      ...memberCoordinates,
      authority: memberAuthority,
      community,
      memberIdentity,
      payer,
      manifestHash,
      manifestUri,
    });

    expect(WOKE_COMMUNITY_MEMBERSHIP_ACCOUNT_SPACE).toBe(426);
    expect(built).toMatchObject({
      action: 'join',
      expectedState: 'active',
      memberIdentity,
      membershipAddress,
    });
    expect(built.instruction.programAddress).toBe(context.programAddress);
    expect(built.instruction.accounts).toEqual([
      { address: config, role: AccountRole.WRITABLE },
      { address: community, role: AccountRole.WRITABLE },
      { address: memberIdentity, role: AccountRole.WRITABLE },
      { address: membershipAddress, role: AccountRole.WRITABLE },
      { address: memberAuthority, role: AccountRole.READONLY_SIGNER },
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: WOKENET_SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: context.programAddress, role: AccountRole.READONLY },
    ]);
    expect([...built.instruction.data.slice(0, 8)]).toEqual([252, 106, 147, 30, 134, 74, 28, 232]);
    expect(readU64(built.instruction.data, 8)).toBe(4n);
    expect(readU64(built.instruction.data, 16)).toBe(2n);
    expect(readU64(built.instruction.data, 24)).toBe(1n);
    expect(readU64(built.instruction.data, 32)).toBe(8n);
    expect(built.instruction.data.slice(40, 72)).toEqual(manifestHash);
    expect(readU32(built.instruction.data, 72)).toBe(new TextEncoder().encode(manifestUri).length);
    expect(new TextDecoder().decode(built.instruction.data.slice(76))).toBe(manifestUri);
  });

  it('builds leave with the exact delegated account order and no payer', async () => {
    const [config, membershipAddress] = await Promise.all([
      deriveWokeProtocolConfigAddress(context),
      deriveWokeCommunityMembershipAddress(context, community, memberIdentity),
    ]);
    const built = await buildLeaveCommunityInstruction(context, {
      ...memberCoordinates,
      authority: memberAuthority,
      community,
      delegation: memberDelegation,
      memberIdentity,
      manifestHash,
      manifestUri,
    });

    expect(built).toMatchObject({
      action: 'leave',
      expectedState: 'left',
      membershipAddress,
    });
    expect(built.instruction.accounts).toEqual([
      { address: config, role: AccountRole.READONLY },
      { address: community, role: AccountRole.WRITABLE },
      { address: memberIdentity, role: AccountRole.WRITABLE },
      { address: membershipAddress, role: AccountRole.WRITABLE },
      { address: memberAuthority, role: AccountRole.READONLY_SIGNER },
      { address: memberDelegation, role: AccountRole.READONLY },
    ]);
    expect([...built.instruction.data.slice(0, 8)]).toEqual([218, 140, 41, 66, 8, 140, 33, 161]);
    expect(readU64(built.instruction.data, 8)).toBe(4n);
    expect(readU64(built.instruction.data, 32)).toBe(8n);
  });

  it('builds existing-membership remove and ban actions without rent accounts', async () => {
    const [config, membershipAddress] = await Promise.all([
      deriveWokeProtocolConfigAddress(context),
      deriveWokeCommunityMembershipAddress(context, community, memberIdentity),
    ]);
    for (const [action, wire, state] of [
      ['remove', 2, 'removed'],
      ['ban', 3, 'banned'],
    ] as const) {
      const built = await buildModerateCommunityMembershipInstruction(context, {
        action,
        authority: creatorAuthority,
        community,
        creatorIdentity,
        delegation: creatorDelegation,
        expectedCreatorIdentitySequence: 12n,
        expectedMembershipStateSequence: 3n,
        expectedMembershipPolicySequence: 1n,
        expectedCommunityMembershipSequence: 9n,
        memberIdentity,
        manifestHash,
        manifestUri,
      });

      expect(built).toMatchObject({
        action,
        expectedState: state,
        memberIdentity,
        membershipAddress,
      });
      expect(built.instruction.accounts).toEqual([
        { address: config, role: AccountRole.READONLY },
        { address: creatorIdentity, role: AccountRole.WRITABLE },
        { address: community, role: AccountRole.WRITABLE },
        { address: memberIdentity, role: AccountRole.READONLY },
        { address: membershipAddress, role: AccountRole.WRITABLE },
        { address: creatorAuthority, role: AccountRole.READONLY_SIGNER },
        { address: creatorDelegation, role: AccountRole.READONLY },
      ]);
      expect([...built.instruction.data.slice(0, 8)]).toEqual([
        191, 194, 181, 172, 173, 36, 64, 195,
      ]);
      expect(readU64(built.instruction.data, 8)).toBe(12n);
      expect(readU64(built.instruction.data, 16)).toBe(3n);
      expect(readU64(built.instruction.data, 24)).toBe(1n);
      expect(readU64(built.instruction.data, 32)).toBe(9n);
      expect(built.instruction.data[40]).toBe(wire);
      expect(built.instruction.data.slice(41, 73)).toEqual(manifestHash);
      expect(readU32(built.instruction.data, 73)).toBe(
        new TextEncoder().encode(manifestUri).length,
      );
      expect(new TextDecoder().decode(built.instruction.data.slice(77))).toBe(manifestUri);
    }
  });

  it('snapshots manifest bytes and rejects unsafe action coordinates before building', async () => {
    const mutableHash = Uint8Array.from(manifestHash);
    const built = await buildJoinCommunityInstruction(context, {
      ...memberCoordinates,
      authority: memberAuthority,
      community,
      memberIdentity,
      payer,
      manifestHash: mutableHash,
      manifestUri,
    });
    mutableHash.fill(255);
    expect(built.instruction.data.slice(40, 72)).toEqual(manifestHash);
    await expect(
      buildJoinCommunityInstruction(context, {
        ...memberCoordinates,
        authority: memberAuthority,
        community,
        memberIdentity,
        payer,
        expectedMembershipPolicySequence: 18_446_744_073_709_551_615n,
        manifestHash,
        manifestUri,
      }),
    ).resolves.toBeDefined();

    await expect(
      buildJoinCommunityInstruction(context, {
        ...memberCoordinates,
        authority: memberAuthority,
        community,
        memberIdentity,
        payer,
        expectedMembershipPolicySequence: 0n,
        manifestHash,
        manifestUri,
      }),
    ).rejects.toMatchObject({ code: 'invalid-sequence' });
    await expect(
      buildJoinCommunityInstruction(context, {
        ...memberCoordinates,
        authority: memberAuthority,
        community,
        memberIdentity,
        payer: community,
        manifestHash,
        manifestUri,
      }),
    ).rejects.toMatchObject({ code: 'alias' });
    await expect(
      buildJoinCommunityInstruction(context, {
        ...memberCoordinates,
        authority: context.programAddress,
        community,
        memberIdentity,
        payer,
        manifestHash,
        manifestUri,
      }),
    ).rejects.toMatchObject({ code: 'alias' });
    await expect(
      buildJoinCommunityInstruction(context, {
        ...memberCoordinates,
        authority: memberAuthority,
        community,
        memberIdentity,
        payer: context.programAddress,
        manifestHash,
        manifestUri,
      }),
    ).rejects.toMatchObject({ code: 'alias' });
    await expect(
      buildJoinCommunityInstruction(context, {
        ...memberCoordinates,
        authority: memberAuthority,
        community,
        memberIdentity,
        payer,
        manifestHash: new Uint8Array(32),
        manifestUri,
      }),
    ).rejects.toMatchObject({ code: 'invalid-manifest' });
    await expect(
      buildModerateCommunityMembershipInstruction(context, {
        action: 'remove',
        authority: creatorAuthority,
        community,
        creatorIdentity: memberIdentity,
        expectedCreatorIdentitySequence: 1n,
        expectedMembershipStateSequence: 1n,
        expectedMembershipPolicySequence: 1n,
        expectedCommunityMembershipSequence: 1n,
        memberIdentity,
        manifestHash,
        manifestUri,
      }),
    ).rejects.toMatchObject({ code: 'alias' });
  });
});

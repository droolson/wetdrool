import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';

import {
  buildClaimRandomWokeNameInstruction,
  buildPrimaryWokeIdentityRegistration,
  createPrimaryWokeIdentityRegistrationSimulationVerifier,
  createRandomWokeNameClaimSimulationVerifier,
  reconcilePrimaryWokeIdentityRegistration,
  verifyFinalizedPrimaryWokeIdentityNameBinding,
  verifyFinalizedPrimaryWokeIdentityRegistration,
  WOKE_HANDLE_CLAIM_ACCOUNT_SPACE,
  WOKE_IDENTITY_ACCOUNT_SPACE,
  type WokeProgramAccountReader,
  type WokeProgramAccountSnapshot,
  type WokeTransactionSimulationSnapshot,
} from '../src/index.js';

const key = (fill: number): string => bs58.encode(new Uint8Array(32).fill(fill));
const rootAuthority = key(1);
const context = {
  endpoint: 'http://127.0.0.1:8899/',
  genesisHash: key(7),
  programAddress: key(8),
} as const;

describe('atomic primary identity registration', () => {
  it('builds create then claim and verifies both exact simulated effects and events', async () => {
    const built = await buildPrimaryWokeIdentityRegistration(context, {
      payer: rootAuthority,
      rootAuthority,
    });
    expect(built.instructions).toEqual([built.identity.instruction, built.nameClaim.instruction]);
    expect(built.nameClaim.expectedIdentitySequence).toBe(0n);
    expect(built.nameClaim.randomName.name).toMatch(/^anon_[0-9a-hjkmnp-tv-z]{16}\.drool$/u);

    const simulation = registrationSimulation(built);
    expect(() =>
      createPrimaryWokeIdentityRegistrationSimulationVerifier(built)(simulation),
    ).not.toThrow();
    const mutated = {
      ...simulation,
      logs:
        simulation.logs === null
          ? null
          : simulation.logs.map((line) =>
              line.startsWith('Program data: ') ? line.replace(/.$/u, 'A') : line,
            ),
    };
    expect(() => createPrimaryWokeIdentityRegistrationSimulationVerifier(built)(mutated)).toThrow();
  });

  it('accepts the exact nested Agave 2.3 atomic-registration evidence shape', async () => {
    const agaveContext = {
      endpoint: 'http://127.0.0.1:41540/',
      genesisHash: '2VUm3nqk2zdzWadehEihL5fpTzptDb8yaAaguvQ1vzGb',
      programAddress: '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD',
    } as const;
    const agaveRoot = '5gL1MY7TBMNuH1hhYWwdj1fSQASX3jpTQB34qu5mECNT';
    const built = await buildPrimaryWokeIdentityRegistration(agaveContext, {
      payer: agaveRoot,
      rootAuthority: agaveRoot,
    });
    expect(built.identity.identityAddress).toBe('J8eUkB7sS8nbH1JDDM3DLF8WkNGo9JF9ZfJF4ACQqM2b');
    expect(built.nameClaim.handleClaimAddress).toBe('3MEdCUCwUGXZSspx619ih4XhLBg5dJtPNPQ48kSh2jHB');

    const identityRent = 3_723_600n;
    const claimRent = 1_976_640n;
    const fee = 5_000n;
    const simulation: WokeTransactionSimulationSnapshot = {
      ...registrationSimulation(built),
      contextSlot: 113n,
      feePayer: agaveRoot,
      feeLamports: fee,
      maxTransactionFeeLamports: 1_000_000n,
      logs: [
        `Program ${built.context.programAddress} invoke [1]`,
        'Program log: Instruction: CreateIdentity',
        'Program 11111111111111111111111111111111 invoke [2]',
        'Program 11111111111111111111111111111111 success',
        'Program data: 97nnroVeyI4BADHsO6beCkoZ8VtElGQDM+AsBfXui2t5PankJtCd44oj/owezTQlF4z/Z4I+LvIiMDkFx3etDXoHx/TpP4jd4LxFgeO4RUZBd5Yunfj6pqrg4yUBsFAL48cHIQMSTwbysHByaW1hcnktaWRlbnRpdHlxAAAAAAAAAA==',
        `Program ${built.context.programAddress} consumed 13111 of 400000 compute units`,
        `Program ${built.context.programAddress} success`,
        `Program ${built.context.programAddress} invoke [1]`,
        'Program log: Instruction: ClaimHandle',
        'Program 11111111111111111111111111111111 invoke [2]',
        'Program 11111111111111111111111111111111 success',
        'Program data: F7fhDT5Xx5YBADHsO6beCkoZ8VtElGQDM+AsBfXui2t5PankJtCd44ojIuZlFQZoEmTLivRIcCfp4p0zwcAWYg84AvnPp253PBr+jB7NNCUXjP9ngj4u8iIwOQXHd60NegfH9Ok/iN3gvEWB47hFRkF3li6d+PqmquDjJQGwUAvjxwchAxJPBvKwAQAAAAAAAADucd/b1dDW8vxHZcy8MjiDDO8TQP5xaj9uiJqnhfZCMRUAAABhbm9uXzduMDQ0dHNqeHJmbTVlMjNxAAAAAAAAAA==',
        `Program ${built.context.programAddress} consumed 16754 of 386889 compute units`,
        `Program ${built.context.programAddress} success`,
      ],
      innerInstructions: [
        {
          index: 0,
          instructions: [
            createAccountInner(
              agaveRoot,
              built.identity.identityAddress,
              built.context.programAddress,
              identityRent,
              WOKE_IDENTITY_ACCOUNT_SPACE,
            ),
          ],
        },
        {
          index: 1,
          instructions: [
            createAccountInner(
              agaveRoot,
              built.nameClaim.handleClaimAddress,
              built.context.programAddress,
              claimRent,
              WOKE_HANDLE_CLAIM_ACCOUNT_SPACE,
            ),
          ],
        },
      ],
      accountBalances: [
        balance(agaveRoot, 100_000_000n, 94_294_760n),
        balance(built.nameClaim.handleClaimAddress, 0n, claimRent),
        balance(built.identity.configAddress, 1_524_240n, 1_524_240n),
        balance(built.identity.identityAddress, 0n, identityRent),
      ],
      minimumRentExemptBalances: {
        [String(WOKE_IDENTITY_ACCOUNT_SPACE)]: identityRent,
        [String(WOKE_HANDLE_CLAIM_ACCOUNT_SPACE)]: claimRent,
      },
    };

    expect(() =>
      createPrimaryWokeIdentityRegistrationSimulationVerifier(built)(simulation),
    ).not.toThrow();
  });

  it('reconciles absent, legacy identity-only, and complete finalized states', async () => {
    const built = await buildPrimaryWokeIdentityRegistration(context, {
      payer: rootAuthority,
      rootAuthority,
    });
    const identityAccount = snapshot(built.identity.identityAddress, identityAccountBytes(built));
    const nameClaimAccount = snapshot(
      built.nameClaim.handleClaimAddress,
      handleClaimAccountBytes(built),
    );

    await expect(
      reconcilePrimaryWokeIdentityRegistration(built, reader(new Map())),
    ).resolves.toEqual({ status: 'absent' });
    await expect(
      reconcilePrimaryWokeIdentityRegistration(
        built,
        reader(new Map([[built.identity.identityAddress, identityAccount]])),
      ),
    ).resolves.toMatchObject({ status: 'identity-only', identity: { sequence: 1n } });
    await expect(
      reconcilePrimaryWokeIdentityRegistration(
        built,
        reader(
          new Map([
            [built.identity.identityAddress, identityAccount],
            [built.nameClaim.handleClaimAddress, nameClaimAccount],
          ]),
        ),
      ),
    ).resolves.toMatchObject({
      status: 'complete',
      identity: { sequence: 1n },
      nameClaim: { identitySequence: 1n, handle: built.nameClaim.randomName.handle },
    });
    expect(
      verifyFinalizedPrimaryWokeIdentityRegistration(built, identityAccount, nameClaimAccount),
    ).toMatchObject({
      identity: { sequence: 1n },
      nameClaim: { identitySequence: 1n },
    });

    await expect(
      reconcilePrimaryWokeIdentityRegistration(
        built,
        reader(new Map([[built.nameClaim.handleClaimAddress, nameClaimAccount]])),
      ),
    ).rejects.toMatchObject({ code: 'account-conflict' });

    const advancedIdentityAccount = snapshot(
      built.identity.identityAddress,
      identityAccountBytes(built, 3n),
      47n,
    );
    await expect(
      reconcilePrimaryWokeIdentityRegistration(
        built,
        reader(
          new Map([
            [built.identity.identityAddress, advancedIdentityAccount],
            [built.nameClaim.handleClaimAddress, nameClaimAccount],
          ]),
        ),
      ),
    ).resolves.toMatchObject({
      status: 'complete',
      identity: { sequence: 3n },
      nameClaim: { identitySequence: 1n },
    });
    expect(
      verifyFinalizedPrimaryWokeIdentityNameBinding(
        built,
        advancedIdentityAccount,
        nameClaimAccount,
      ),
    ).toMatchObject({
      identity: { sequence: 3n },
      nameClaim: { identitySequence: 1n },
    });
  });

  it('verifies a separately simulated current-sequence legacy name migration', async () => {
    const registration = await buildPrimaryWokeIdentityRegistration(context, {
      payer: rootAuthority,
      rootAuthority,
    });
    const claim = await buildClaimRandomWokeNameInstruction(context, {
      originAuthority: registration.identity.originAuthority,
      rootAuthority,
      identityAddress: registration.identity.identityAddress,
      payer: rootAuthority,
      expectedIdentitySequence: 7n,
    });
    const simulation = claimSimulation(claim);
    expect(() => createRandomWokeNameClaimSimulationVerifier(claim)(simulation)).not.toThrow();
    expect(() =>
      createRandomWokeNameClaimSimulationVerifier(claim)({
        ...simulation,
        logs:
          simulation.logs?.map((line) =>
            line.startsWith('Program data: ') ? line.replace(/.$/u, 'A') : line,
          ) ?? null,
      }),
    ).toThrow();
  });
});

function registrationSimulation(
  built: Awaited<ReturnType<typeof buildPrimaryWokeIdentityRegistration>>,
): WokeTransactionSimulationSnapshot {
  const identityRent = 1_000n;
  const claimRent = 500n;
  const fee = 5n;
  const identityEvent = concat(
    Uint8Array.of(247, 185, 231, 174, 133, 94, 200, 142),
    u16(1),
    pubkey(built.identity.configAddress),
    pubkey(built.identity.identityAddress),
    pubkey(built.identity.rootAuthority),
    built.identity.identityNonce,
    u64(44n),
  );
  const handleEvent = concat(
    Uint8Array.of(23, 183, 225, 13, 62, 87, 199, 150),
    u16(1),
    pubkey(built.nameClaim.configAddress),
    pubkey(built.nameClaim.handleClaimAddress),
    pubkey(built.nameClaim.identityAddress),
    pubkey(built.nameClaim.rootAuthority),
    u64(1n),
    built.nameClaim.handleHash,
    borshString(built.nameClaim.randomName.handle),
    u64(44n),
  );
  return {
    source: 'simulateTransaction',
    endpoint: built.context.endpoint,
    genesisHash: built.context.genesisHash,
    programAddress: built.context.programAddress,
    contextSlot: 44n,
    transactionSignature: key(20),
    transactionVersion: 0,
    feePayer: rootAuthority,
    blockhash: key(21),
    lastValidBlockHeight: 100n,
    maxTransactionFeeLamports: 10n,
    wireTransactionBase64: 'AA==',
    error: null,
    feeLamports: fee,
    logs: [
      `Program ${built.context.programAddress} invoke [1]`,
      `Program data: ${Buffer.from(identityEvent).toString('base64')}`,
      `Program ${built.context.programAddress} success`,
      `Program ${built.context.programAddress} invoke [1]`,
      `Program data: ${Buffer.from(handleEvent).toString('base64')}`,
      `Program ${built.context.programAddress} success`,
    ],
    innerInstructions: [
      {
        index: 0,
        instructions: [
          createAccountInner(
            rootAuthority,
            built.identity.identityAddress,
            built.context.programAddress,
            identityRent,
            WOKE_IDENTITY_ACCOUNT_SPACE,
          ),
        ],
      },
      {
        index: 1,
        instructions: [
          createAccountInner(
            rootAuthority,
            built.nameClaim.handleClaimAddress,
            built.context.programAddress,
            claimRent,
            WOKE_HANDLE_CLAIM_ACCOUNT_SPACE,
          ),
        ],
      },
    ],
    accountBalances: [
      balance(rootAuthority, 10_000n, 10_000n - identityRent - claimRent - fee),
      balance(built.identity.identityAddress, 0n, identityRent),
      balance(built.nameClaim.handleClaimAddress, 0n, claimRent),
    ],
    unitsConsumed: 30_000n,
    minimumRentExemptBalances: {
      [String(WOKE_IDENTITY_ACCOUNT_SPACE)]: identityRent,
      [String(WOKE_HANDLE_CLAIM_ACCOUNT_SPACE)]: claimRent,
    },
  };
}

function claimSimulation(
  built: Awaited<ReturnType<typeof buildClaimRandomWokeNameInstruction>>,
): WokeTransactionSimulationSnapshot {
  const rent = 500n;
  const fee = 5n;
  const event = concat(
    Uint8Array.of(23, 183, 225, 13, 62, 87, 199, 150),
    u16(1),
    pubkey(built.configAddress),
    pubkey(built.handleClaimAddress),
    pubkey(built.identityAddress),
    pubkey(built.rootAuthority),
    u64(8n),
    built.handleHash,
    borshString(built.randomName.handle),
    u64(48n),
  );
  return {
    source: 'simulateTransaction',
    endpoint: built.context.endpoint,
    genesisHash: built.context.genesisHash,
    programAddress: built.context.programAddress,
    contextSlot: 48n,
    transactionSignature: key(22),
    transactionVersion: 0,
    feePayer: rootAuthority,
    blockhash: key(23),
    lastValidBlockHeight: 120n,
    maxTransactionFeeLamports: 10n,
    wireTransactionBase64: 'AA==',
    error: null,
    feeLamports: fee,
    logs: [
      `Program ${built.context.programAddress} invoke [1]`,
      `Program data: ${Buffer.from(event).toString('base64')}`,
      `Program ${built.context.programAddress} success`,
    ],
    innerInstructions: [
      {
        index: 0,
        instructions: [
          createAccountInner(
            rootAuthority,
            built.handleClaimAddress,
            built.context.programAddress,
            rent,
            WOKE_HANDLE_CLAIM_ACCOUNT_SPACE,
          ),
        ],
      },
    ],
    accountBalances: [
      balance(rootAuthority, 10_000n, 10_000n - rent - fee),
      balance(built.handleClaimAddress, 0n, rent),
    ],
    unitsConsumed: 20_000n,
    minimumRentExemptBalances: {
      [String(WOKE_HANDLE_CLAIM_ACCOUNT_SPACE)]: rent,
    },
  };
}

function identityAccountBytes(
  built: Awaited<ReturnType<typeof buildPrimaryWokeIdentityRegistration>>,
  sequence = 1n,
): Uint8Array {
  const output = new Uint8Array(WOKE_IDENTITY_ACCOUNT_SPACE);
  writeParts(output, [
    Uint8Array.of(58, 132, 5, 12, 176, 164, 85, 112),
    Uint8Array.of(1),
    pubkey(built.identity.configAddress),
    built.identity.identityNonce,
    pubkey(built.identity.originAuthority),
    pubkey(built.identity.rootAuthority),
    u64(0n),
    u64(0n),
    u64(sequence),
    u64(0n),
    new Uint8Array(32),
    u32(0),
    u64(44n),
    u64(0n),
    Uint8Array.of(1),
    Uint8Array.of(built.identity.identityBump),
  ]);
  return output;
}

function handleClaimAccountBytes(
  built: Awaited<ReturnType<typeof buildPrimaryWokeIdentityRegistration>>,
): Uint8Array {
  const output = new Uint8Array(WOKE_HANDLE_CLAIM_ACCOUNT_SPACE);
  writeParts(output, [
    Uint8Array.of(148, 215, 248, 53, 11, 234, 115, 190),
    Uint8Array.of(1),
    pubkey(built.nameClaim.configAddress),
    pubkey(built.nameClaim.identityAddress),
    built.nameClaim.handleHash,
    borshString(built.nameClaim.randomName.handle),
    u64(1n),
    u64(44n),
    Uint8Array.of(built.nameClaim.handleClaimBump),
  ]);
  return output;
}

function snapshot(address: string, data: Uint8Array, slot = 44n): WokeProgramAccountSnapshot {
  return {
    address,
    owner: context.programAddress,
    commitment: 'finalized',
    slot,
    data,
  };
}

function reader(
  accounts: ReadonlyMap<string, WokeProgramAccountSnapshot>,
): WokeProgramAccountReader {
  return {
    readAccount: async ({ address }) => accounts.get(address) ?? null,
  };
}

function createAccountInner(
  source: string,
  newAccount: string,
  owner: string,
  lamports: bigint,
  space: number,
): Record<string, unknown> {
  return {
    programId: '11111111111111111111111111111111',
    parsed: {
      type: 'createAccount',
      info: { source, newAccount, owner, lamports, space: BigInt(space) },
    },
  };
}

function balance(address: string, preLamports: bigint, postLamports: bigint) {
  return {
    address,
    preLamports,
    postLamports,
    deltaLamports: postLamports - preLamports,
  };
}

function pubkey(value: string): Uint8Array {
  return bs58.decode(value);
}

function u16(value: number): Uint8Array {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value, true);
  return output;
}

function u32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}

function u64(value: bigint): Uint8Array {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, value, true);
  return output;
}

function borshString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(u32(bytes.byteLength), bytes);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  writeParts(output, parts);
  return output;
}

function writeParts(output: Uint8Array, parts: readonly Uint8Array[]): void {
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
}

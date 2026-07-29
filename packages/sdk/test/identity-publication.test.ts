import { AccountRole, address, getAddressEncoder, getBase64Decoder } from '@solana/kit';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  WOKENET_SYSTEM_PROGRAM_ADDRESS,
  WOKE_IDENTITY_ACCOUNT_SPACE,
  WOKE_POST_REFERENCE_ACCOUNT_SPACE,
  buildCreatePrimaryWokeIdentityInstruction,
  buildCreateWokeIdentityInstruction,
  buildPublishWokePostInstruction,
  createWokeIdentitySimulationVerifier,
  createWokePostSimulationVerifier,
  decodeWokeIdentityAccount,
  decodeWokePostReferenceAccount,
  derivePrimaryWokeIdentityCoordinates,
  deriveWokePostReferenceAddress,
  reconcileWokeIdentityCreation,
  reconcileWokePostPublication,
  verifyFreshWokeIdentityAccount,
  verifyWokeIdentityAccount,
  verifyWokePostReferenceAccount,
  type BuiltCreateWokeIdentityInstruction,
  type BuiltPublishWokePostInstruction,
  type WokeIdentityAccountRecord,
  type WokeIdentityCoordinates,
  type WokeNetContext,
  type WokePostReferenceAccountRecord,
  type WokeProgramAccountReader,
  type WokeProgramAccountSnapshot,
  type WokeTransactionSimulationSnapshot,
} from '../src/index.js';

const CREATE_IDENTITY_DISCRIMINATOR = [12, 253, 209, 41, 176, 51, 195, 179];
const PUBLISH_POST_DISCRIMINATOR = [182, 78, 189, 205, 125, 46, 217, 154];
const IDENTITY_ACCOUNT_DISCRIMINATOR = [58, 132, 5, 12, 176, 164, 85, 112];
const POST_REFERENCE_ACCOUNT_DISCRIMINATOR = [211, 85, 89, 48, 227, 1, 60, 119];
const IDENTITY_CREATED_EVENT_DISCRIMINATOR = [247, 185, 231, 174, 133, 94, 200, 142];
const POST_PUBLISHED_EVENT_DISCRIMINATOR = [65, 16, 116, 252, 204, 196, 161, 100];

const publicKey = (fill: number): string =>
  bs58.encode(Uint8Array.from({ length: 32 }, () => fill));

const rootAuthority = publicKey(1);
const payer = publicKey(2);
const alternatePayer = publicKey(3);
const genesisHash = publicKey(7);
const programAddress = publicKey(8);
const context: WokeNetContext = {
  endpoint: 'http://127.0.0.1:8899',
  genesisHash,
  programAddress,
};
const postNonce = Uint8Array.from({ length: 16 }, (_, index) => index);
const customIdentityNonce = Uint8Array.from({ length: 16 }, (_, index) => 16 - index);
const manifestHash = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const manifestCid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const manifestUri = `local://${manifestCid}`;
const identityAddress = '3VuZxyTFvJGGAKCWvH2SE5NeaPAna7STbUb3kSXogNG9';
const postReferenceAddress = '4o52AWZYWJmSgPEdjkAnJCJgqgxs54FkbAz56Nz2QZib';
const ADDRESS_ENCODER = getAddressEncoder();

async function primary(): Promise<{
  readonly built: BuiltCreateWokeIdentityInstruction;
  readonly coordinates: WokeIdentityCoordinates;
}> {
  const [built, coordinates] = await Promise.all([
    buildCreatePrimaryWokeIdentityInstruction(context, { payer, rootAuthority }),
    derivePrimaryWokeIdentityCoordinates(context, rootAuthority),
  ]);
  return { built, coordinates };
}

async function post(): Promise<{
  readonly built: BuiltPublishWokePostInstruction;
  readonly coordinates: WokeIdentityCoordinates;
}> {
  const coordinates = await derivePrimaryWokeIdentityCoordinates(context, rootAuthority);
  const built = await buildPublishWokePostInstruction(context, {
    authorIdentity: coordinates.identityAddress,
    expectedAuthorSequence: 4n,
    manifestHash,
    manifestUri,
    payer,
    postNonce,
    rootAuthority,
  });
  return { built, coordinates };
}

describe('deterministic WokeSocial identity coordinates', () => {
  it('uses one stable primary nonce and known PDA for the same root authority', async () => {
    const first = await derivePrimaryWokeIdentityCoordinates(context, rootAuthority);
    const second = await derivePrimaryWokeIdentityCoordinates(context, rootAuthority);

    expect(first.identityNonce).toEqual(new TextEncoder().encode('primary-identity'));
    expect(first.identityNonce).toHaveLength(16);
    expect(first.identityAddress).toBe(identityAddress);
    expect(first.identityBump).toBe(253);
    expect(second).toEqual(first);

    first.identityNonce.fill(99);
    expect(second.identityNonce).toEqual(new TextEncoder().encode('primary-identity'));
  });

  it('builds the exact create_identity discriminator, accounts, and copied nonce', async () => {
    const inputNonce = Uint8Array.from(customIdentityNonce);
    const built = await buildCreateWokeIdentityInstruction(context, {
      identityNonce: inputNonce,
      payer,
      rootAuthority,
    });
    inputNonce.fill(0);

    expect([...built.instruction.data.subarray(0, 8)]).toEqual(CREATE_IDENTITY_DISCRIMINATOR);
    expect(built.instruction.data.subarray(8)).toEqual(customIdentityNonce);
    expect(built.identityNonce).toEqual(customIdentityNonce);
    expect(built.rentExemptionSpace).toBe(407);
    expect(built.instruction.accounts).toEqual([
      { address: built.configAddress, role: AccountRole.WRITABLE },
      { address: built.identityAddress, role: AccountRole.WRITABLE },
      { address: rootAuthority, role: AccountRole.READONLY_SIGNER },
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: WOKENET_SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ]);
  });

  it.each([15, 17])('rejects a create-identity nonce with %i bytes', async (nonceLength) => {
    await expect(
      buildCreateWokeIdentityInstruction(context, {
        identityNonce: new Uint8Array(nonceLength),
        payer,
        rootAuthority,
      }),
    ).rejects.toMatchObject({ code: 'invalid-nonce' });
  });

  it('rejects signer/state aliases while allowing one authority to pay rent', async () => {
    const coordinates = await derivePrimaryWokeIdentityCoordinates(context, rootAuthority);

    await expect(
      derivePrimaryWokeIdentityCoordinates(context, programAddress),
    ).rejects.toMatchObject({ code: 'alias' });
    await expect(
      buildCreatePrimaryWokeIdentityInstruction(context, {
        payer: coordinates.identityAddress,
        rootAuthority,
      }),
    ).rejects.toMatchObject({ code: 'alias' });
    await expect(
      buildCreatePrimaryWokeIdentityInstruction(context, {
        payer: rootAuthority,
        rootAuthority,
      }),
    ).resolves.toMatchObject({ payer: rootAuthority });
  });
});

describe('root-authorized post instruction coordinates', () => {
  it('derives a known post PDA and encodes the exact Anchor ABI', async () => {
    const { built, coordinates } = await post();

    await expect(
      deriveWokePostReferenceAddress(context, coordinates.identityAddress, postNonce),
    ).resolves.toBe(postReferenceAddress);
    expect(built.postReferenceAddress).toBe(postReferenceAddress);
    expect(built.postReferenceBump).toBe(255);
    expect([...built.instruction.data.subarray(0, 8)]).toEqual(PUBLISH_POST_DISCRIMINATOR);
    expect(readU64(built.instruction.data, 8)).toBe(4n);
    expect(built.instruction.data.subarray(16, 32)).toEqual(postNonce);
    expect(built.instruction.data.subarray(32, 64)).toEqual(manifestHash);
    expect(readU32(built.instruction.data, 64)).toBe(
      new TextEncoder().encode(manifestUri).byteLength,
    );
    expect(built.instruction.accounts).toEqual([
      { address: built.configAddress, role: AccountRole.WRITABLE },
      { address: coordinates.identityAddress, role: AccountRole.WRITABLE },
      { address: postReferenceAddress, role: AccountRole.WRITABLE },
      { address: rootAuthority, role: AccountRole.READONLY_SIGNER },
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: WOKENET_SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ]);
  });

  it('keeps retry coordinates and instruction bytes stable after caller mutation', async () => {
    const coordinates = await derivePrimaryWokeIdentityCoordinates(context, rootAuthority);
    const mutableNonce = Uint8Array.from(postNonce);
    const mutableHash = Uint8Array.from(manifestHash);
    const input = {
      authorIdentity: coordinates.identityAddress,
      expectedAuthorSequence: 4n,
      manifestHash: mutableHash,
      manifestUri,
      payer,
      postNonce: mutableNonce,
      rootAuthority,
    };
    const first = await buildPublishWokePostInstruction(context, input);
    mutableNonce.fill(200);
    mutableHash.fill(201);
    const retry = await buildPublishWokePostInstruction(context, {
      ...input,
      manifestHash,
      postNonce,
    });

    expect(first.postReferenceAddress).toBe(retry.postReferenceAddress);
    expect(first.postNonce).toEqual(postNonce);
    expect(first.manifestHash).toEqual(manifestHash);
    expect(first.instruction.data).toEqual(retry.instruction.data);
  });

  it.each([-1n, 18_446_744_073_709_551_615n])(
    'rejects the non-incrementable author sequence %s',
    async (expectedAuthorSequence) => {
      const coordinates = await derivePrimaryWokeIdentityCoordinates(context, rootAuthority);
      await expect(
        buildPublishWokePostInstruction(context, {
          authorIdentity: coordinates.identityAddress,
          expectedAuthorSequence,
          manifestHash,
          manifestUri,
          payer,
          postNonce,
          rootAuthority,
        }),
      ).rejects.toMatchObject({ code: 'invalid-sequence' });
    },
  );

  it('accepts the final incrementable sequence without lossy number conversion', async () => {
    const coordinates = await derivePrimaryWokeIdentityCoordinates(context, rootAuthority);
    const built = await buildPublishWokePostInstruction(context, {
      authorIdentity: coordinates.identityAddress,
      expectedAuthorSequence: 18_446_744_073_709_551_614n,
      manifestHash,
      manifestUri,
      payer,
      postNonce,
      rootAuthority,
    });

    expect(readU64(built.instruction.data, 8)).toBe(18_446_744_073_709_551_614n);
  });

  it('rejects bad nonce, manifest, and protocol-account aliases', async () => {
    const coordinates = await derivePrimaryWokeIdentityCoordinates(context, rootAuthority);
    const base = {
      authorIdentity: coordinates.identityAddress,
      expectedAuthorSequence: 0n,
      manifestHash,
      manifestUri,
      payer,
      postNonce,
      rootAuthority,
    };

    await expect(
      buildPublishWokePostInstruction(context, { ...base, postNonce: new Uint8Array(15) }),
    ).rejects.toMatchObject({ code: 'invalid-nonce' });
    await expect(
      buildPublishWokePostInstruction(context, {
        ...base,
        manifestHash: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: 'invalid-manifest' });
    await expect(
      buildPublishWokePostInstruction(context, {
        ...base,
        manifestUri: 'javascript:alert(1)',
      }),
    ).rejects.toMatchObject({ code: 'invalid-manifest' });
    await expect(
      buildPublishWokePostInstruction(context, {
        ...base,
        rootAuthority: coordinates.identityAddress,
      }),
    ).rejects.toMatchObject({ code: 'alias' });
    await expect(
      buildPublishWokePostInstruction(context, {
        ...base,
        payer: coordinates.configAddress,
      }),
    ).rejects.toMatchObject({ code: 'alias' });
  });
});

describe('strict Identity and PostReference account decoding', () => {
  it('decodes and verifies an exact fresh finalized Identity account', async () => {
    const { built } = await primary();
    const data = encodeIdentity(built);
    const snapshot = accountSnapshot(built.identityAddress, data, 42n, 'finalized');

    expect([...data.subarray(0, 8)]).toEqual(IDENTITY_ACCOUNT_DISCRIMINATOR);
    expect(decodeWokeIdentityAccount(data)).toMatchObject({
      active: true,
      bump: 253,
      config: built.configAddress,
      createdAtSlot: 40n,
      originAuthority: rootAuthority,
      rootAuthority,
      sequence: 0n,
    });
    expect(verifyWokeIdentityAccount(built, snapshot, 'finalized')).toMatchObject({
      originAuthority: rootAuthority,
    });
    expect(verifyFreshWokeIdentityAccount(built, snapshot)).toMatchObject({
      active: true,
      sequence: 0n,
    });
  });

  it('decodes and verifies the exact finalized PostReference account', async () => {
    const { built } = await post();
    const data = encodePost(built);
    const snapshot = accountSnapshot(built.postReferenceAddress, data, 44n, 'finalized');

    expect([...data.subarray(0, 8)]).toEqual(POST_REFERENCE_ACCOUNT_DISCRIMINATOR);
    expect(decodeWokePostReferenceAccount(data)).toMatchObject({
      authorIdentity: built.authorIdentity,
      authorSequence: 5n,
      createdAtSlot: 43n,
      manifestUri,
      tombstonedAtSlot: null,
    });
    expect(verifyWokePostReferenceAccount(built, snapshot, 'finalized')).toMatchObject({
      postNonce,
    });
  });

  it('rejects truncated, wrong-discriminator, invalid-boolean, and dirty-padding identities', async () => {
    const { built } = await primary();
    const valid = encodeIdentity(built);
    const wrongDiscriminator = Uint8Array.from(valid);
    wrongDiscriminator[0] = 0;
    const invalidBoolean = Uint8Array.from(valid);
    invalidBoolean[205] = 2;
    const dirtyPadding = Uint8Array.from(valid);
    dirtyPadding[dirtyPadding.length - 1] = 1;
    const oversizedProfileUri = Uint8Array.from(valid);
    oversizedProfileUri[185] = 201;

    for (const malformed of [
      valid.subarray(0, valid.length - 1),
      wrongDiscriminator,
      invalidBoolean,
      dirtyPadding,
      oversizedProfileUri,
    ]) {
      expect(() => decodeWokeIdentityAccount(malformed)).toThrowError(
        expect.objectContaining({ code: 'invalid-account' }),
      );
    }
  });

  it('rejects malformed PostReference options, hashes, padding, and RPC envelopes', async () => {
    const { built } = await post();
    const valid = encodePost(built);
    const invalidOption = Uint8Array.from(valid);
    const optionOffset =
      8 + 1 + 32 + 32 + 16 + 32 + 4 + new TextEncoder().encode(manifestUri).byteLength + 8 + 8;
    invalidOption[optionOffset] = 2;
    const zeroHash = encodePost(built, { manifestHash: new Uint8Array(32) });
    const dirtyPadding = Uint8Array.from(valid);
    dirtyPadding[dirtyPadding.length - 1] = 1;
    const oversizedManifestUri = Uint8Array.from(valid);
    oversizedManifestUri[121] = 201;

    for (const malformed of [invalidOption, zeroHash, dirtyPadding, oversizedManifestUri]) {
      expect(() => decodeWokePostReferenceAccount(malformed)).toThrowError(
        expect.objectContaining({ code: 'invalid-account' }),
      );
    }
    expect(() =>
      verifyWokePostReferenceAccount(
        built,
        accountSnapshot(built.postReferenceAddress, valid, 44n, 'confirmed'),
        'finalized',
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-account' }));
    expect(() =>
      verifyWokePostReferenceAccount(
        built,
        {
          ...accountSnapshot(built.postReferenceAddress, valid, 44n, 'finalized'),
          owner: alternatePayer,
        },
        'finalized',
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-account' }));
  });
});

describe('response-loss-safe reconciliation', () => {
  it('returns absent or the exact existing deterministic identity without resubmission', async () => {
    const { built } = await primary();
    const readAccount = vi.fn<WokeProgramAccountReader['readAccount']>(async () => null);
    const reader = { readAccount };

    await expect(reconcileWokeIdentityCreation(built, reader)).resolves.toEqual({
      status: 'absent',
    });
    readAccount.mockResolvedValueOnce(
      accountSnapshot(built.identityAddress, encodeIdentity(built), 42n),
    );
    await expect(reconcileWokeIdentityCreation(built, reader)).resolves.toMatchObject({
      status: 'existing',
      identity: { originAuthority: rootAuthority },
    });
    expect(readAccount).toHaveBeenLastCalledWith({
      endpoint: 'http://127.0.0.1:8899/',
      genesisHash,
      programAddress,
      address: built.identityAddress,
      commitment: 'processed',
    });
  });

  it('returns ready only for the exact current author state', async () => {
    const { built, coordinates } = await post();
    const identityBuilt = await buildCreatePrimaryWokeIdentityInstruction(context, {
      payer,
      rootAuthority,
    });
    const readAccount = vi
      .fn<WokeProgramAccountReader['readAccount']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        accountSnapshot(
          coordinates.identityAddress,
          encodeIdentity(identityBuilt, { sequence: 4n }),
          45n,
        ),
      );

    await expect(
      reconcileWokePostPublication(built, coordinates, { readAccount }),
    ).resolves.toMatchObject({ status: 'ready', identity: { sequence: 4n } });
    expect(readAccount).toHaveBeenCalledTimes(2);
  });

  it('recognizes the exact landed post first and rejects substituted retry state', async () => {
    const { built, coordinates } = await post();
    const existing = accountSnapshot(
      built.postReferenceAddress,
      encodePost(built),
      46n,
      'confirmed',
    );
    const existingReader = {
      readAccount: vi.fn<WokeProgramAccountReader['readAccount']>(async () => existing),
    };

    await expect(
      reconcileWokePostPublication(built, coordinates, existingReader),
    ).resolves.toMatchObject({ status: 'existing', post: { authorSequence: 5n } });
    expect(existingReader.readAccount).toHaveBeenCalledOnce();

    const mismatched = accountSnapshot(
      built.postReferenceAddress,
      encodePost(built, { manifestHash: Uint8Array.from({ length: 32 }, () => 99) }),
      46n,
    );
    await expect(
      reconcileWokePostPublication(built, coordinates, {
        readAccount: vi.fn(async () => mismatched),
      }),
    ).rejects.toMatchObject({ code: 'invalid-account' });
  });

  it('fails closed when the post is absent but the author sequence advanced', async () => {
    const { built, coordinates } = await post();
    const identityBuilt = await buildCreatePrimaryWokeIdentityInstruction(context, {
      payer,
      rootAuthority,
    });
    const readAccount = vi
      .fn<WokeProgramAccountReader['readAccount']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        accountSnapshot(
          coordinates.identityAddress,
          encodeIdentity(identityBuilt, { sequence: 5n }),
          45n,
        ),
      );

    await expect(
      reconcileWokePostPublication(built, coordinates, { readAccount }),
    ).rejects.toMatchObject({ code: 'invalid-account' });
  });
});

describe('operation-specific simulation verification', () => {
  it('accepts only the exact IdentityCreated event and fee/rent effects', async () => {
    const { built } = await primary();
    const simulation = createIdentitySimulation(built);

    expect(() => createWokeIdentitySimulationVerifier(built)(simulation)).not.toThrow();

    const unexpectedTransfer = {
      ...simulation,
      accountBalances: [
        ...simulation.accountBalances,
        {
          address: alternatePayer,
          preLamports: 1_000n,
          postLamports: 999n,
          deltaLamports: -1n,
        },
      ],
    };
    expect(() => createWokeIdentitySimulationVerifier(built)(unexpectedTransfer)).toThrowError(
      expect.objectContaining({ code: 'simulation-mismatch' }),
    );
    expect(() =>
      createWokeIdentitySimulationVerifier(built)({
        ...simulation,
        innerInstructions: [],
      }),
    ).toThrowError(expect.objectContaining({ code: 'simulation-mismatch' }));
  });

  it('accepts only the exact PostReferencePublished event and persistent coordinates', async () => {
    const { built } = await post();
    const simulation = createPostSimulation(built);

    expect(() => createWokePostSimulationVerifier(built)(simulation)).not.toThrow();

    const wrongSequenceEvent = encodePostEvent(built, { authorSequence: 6n });
    expect(() =>
      createWokePostSimulationVerifier(built)({
        ...simulation,
        logs: operationLogs(programAddress, wrongSequenceEvent),
      }),
    ).toThrowError(expect.objectContaining({ code: 'simulation-mismatch' }));
  });

  it.each([
    ['missing logs', null],
    ['noncanonical base64', operationLogs(programAddress, null, '!!!!')],
    [
      'wrong discriminator',
      operationLogs(
        programAddress,
        Uint8Array.from({ length: 16 }, () => 9),
      ),
    ],
    ['duplicate event', null],
    ['malformed stack', [`Program ${programAddress} invoke [2]`]],
  ] as const)('rejects %s', async (label, candidateLogs) => {
    const { built } = await primary();
    const validEvent = encodeIdentityEvent(built);
    const logs =
      label === 'duplicate event'
        ? [
            `Program ${programAddress} invoke [1]`,
            `Program data: ${base64(validEvent)}`,
            `Program data: ${base64(validEvent)}`,
            `Program ${programAddress} success`,
          ]
        : candidateLogs;

    expect(() =>
      createWokeIdentitySimulationVerifier(built)({
        ...createIdentitySimulation(built),
        logs,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-event' }));
  });
});

function encodeIdentity(
  built: BuiltCreateWokeIdentityInstruction,
  overrides: Partial<WokeIdentityAccountRecord> = {},
): Uint8Array {
  const value: WokeIdentityAccountRecord = {
    version: 1,
    config: built.configAddress,
    identityNonce: built.identityNonce,
    originAuthority: built.originAuthority,
    rootAuthority: built.rootAuthority,
    rootRotationCount: 0n,
    delegationSequence: 0n,
    sequence: 0n,
    profileSequence: 0n,
    profileManifestHash: new Uint8Array(32),
    profileManifestUri: '',
    createdAtSlot: 40n,
    profileUpdatedAtSlot: 0n,
    active: true,
    bump: built.identityBump,
    ...overrides,
  };
  return allocate(
    new TestWriter(IDENTITY_ACCOUNT_DISCRIMINATOR)
      .u8(value.version)
      .address(value.config)
      .fixed(value.identityNonce)
      .address(value.originAuthority)
      .address(value.rootAuthority)
      .u64(value.rootRotationCount)
      .u64(value.delegationSequence)
      .u64(value.sequence)
      .u64(value.profileSequence)
      .fixed(value.profileManifestHash)
      .string(value.profileManifestUri)
      .u64(value.createdAtSlot)
      .u64(value.profileUpdatedAtSlot)
      .boolean(value.active)
      .u8(value.bump)
      .finish(),
    WOKE_IDENTITY_ACCOUNT_SPACE,
  );
}

function encodePost(
  built: BuiltPublishWokePostInstruction,
  overrides: Partial<WokePostReferenceAccountRecord> = {},
): Uint8Array {
  const value: WokePostReferenceAccountRecord = {
    version: 1,
    config: built.configAddress,
    authorIdentity: built.authorIdentity,
    postNonce: built.postNonce,
    manifestHash: built.manifestHash,
    manifestUri: built.manifestUri,
    authorSequence: built.expectedAuthorSequence + 1n,
    createdAtSlot: 43n,
    tombstonedAtSlot: null,
    bump: built.postReferenceBump,
    ...overrides,
  };
  const writer = new TestWriter(POST_REFERENCE_ACCOUNT_DISCRIMINATOR)
    .u8(value.version)
    .address(value.config)
    .address(value.authorIdentity)
    .fixed(value.postNonce)
    .fixed(value.manifestHash)
    .string(value.manifestUri)
    .u64(value.authorSequence)
    .u64(value.createdAtSlot);
  if (value.tombstonedAtSlot === null) {
    writer.u8(0);
  } else {
    writer.u8(1).u64(value.tombstonedAtSlot);
  }
  return allocate(writer.u8(value.bump).finish(), WOKE_POST_REFERENCE_ACCOUNT_SPACE);
}

function accountSnapshot(
  accountAddress: string,
  data: Uint8Array,
  slot: bigint,
  commitment: WokeProgramAccountSnapshot['commitment'] = 'processed',
): WokeProgramAccountSnapshot {
  return {
    address: accountAddress,
    owner: programAddress,
    commitment,
    slot,
    data,
  };
}

function encodeIdentityEvent(
  built: BuiltCreateWokeIdentityInstruction,
  overrides: { readonly createdAtSlot?: bigint } = {},
): Uint8Array {
  return new TestWriter(IDENTITY_CREATED_EVENT_DISCRIMINATOR)
    .u16(1)
    .address(built.configAddress)
    .address(built.identityAddress)
    .address(built.rootAuthority)
    .fixed(built.identityNonce)
    .u64(overrides.createdAtSlot ?? 42n)
    .finish();
}

function encodePostEvent(
  built: BuiltPublishWokePostInstruction,
  overrides: { readonly authorSequence?: bigint; readonly createdAtSlot?: bigint } = {},
): Uint8Array {
  return new TestWriter(POST_PUBLISHED_EVENT_DISCRIMINATOR)
    .u16(1)
    .address(built.configAddress)
    .address(built.postReferenceAddress)
    .address(built.authorIdentity)
    .address(built.rootAuthority)
    .fixed(built.postNonce)
    .u64(overrides.authorSequence ?? built.expectedAuthorSequence + 1n)
    .fixed(built.manifestHash)
    .string(built.manifestUri)
    .u64(overrides.createdAtSlot ?? 43n)
    .finish();
}

function createIdentitySimulation(
  built: BuiltCreateWokeIdentityInstruction,
): WokeTransactionSimulationSnapshot {
  return simulation(built, 42n, WOKE_IDENTITY_ACCOUNT_SPACE, encodeIdentityEvent(built));
}

function createPostSimulation(
  built: BuiltPublishWokePostInstruction,
): WokeTransactionSimulationSnapshot {
  return simulation(
    {
      context: built.context,
      createdAddress: built.postReferenceAddress,
      payer: built.payer,
    },
    43n,
    WOKE_POST_REFERENCE_ACCOUNT_SPACE,
    encodePostEvent(built),
  );
}

function simulation(
  operation:
    | BuiltCreateWokeIdentityInstruction
    | {
        readonly context: BuiltPublishWokePostInstruction['context'];
        readonly createdAddress: string;
        readonly payer: string;
      },
  contextSlot: bigint,
  space: number,
  event: Uint8Array,
): WokeTransactionSimulationSnapshot {
  const operationContext = operation.context;
  const createdAddress =
    'identityAddress' in operation ? operation.identityAddress : operation.createdAddress;
  const rentPayer = operation.payer;
  const rent = 2_000_000n;
  const fee = 5_000n;
  const payerPre = 10_000_000n;
  return {
    source: 'simulateTransaction',
    endpoint: operationContext.endpoint,
    genesisHash: operationContext.genesisHash,
    programAddress: operationContext.programAddress,
    contextSlot,
    transactionSignature: publicKey(11),
    transactionVersion: 0,
    feePayer: rentPayer,
    blockhash: publicKey(12),
    lastValidBlockHeight: 100n,
    maxTransactionFeeLamports: 1_000_000n,
    wireTransactionBase64: 'AA==',
    error: null,
    feeLamports: fee,
    logs: operationLogs(programAddress, event),
    innerInstructions: [
      {
        index: 0,
        instructions: [
          {
            program: 'system',
            programId: WOKENET_SYSTEM_PROGRAM_ADDRESS,
            parsed: {
              type: 'createAccount',
              info: {
                source: rentPayer,
                newAccount: createdAddress,
                owner: programAddress,
                lamports: rent,
                space: BigInt(space),
              },
            },
            stackHeight: 2,
          },
        ],
      },
    ],
    accountBalances: [
      {
        address: createdAddress,
        preLamports: 0n,
        postLamports: rent,
        deltaLamports: rent,
      },
      {
        address: rentPayer,
        preLamports: payerPre,
        postLamports: payerPre - rent - fee,
        deltaLamports: -rent - fee,
      },
    ],
    unitsConsumed: 20_000n,
    minimumRentExemptBalances: { [String(space)]: rent },
  };
}

function operationLogs(
  targetProgram: string,
  event: Uint8Array | null,
  encodedOverride?: string,
): readonly string[] {
  return [
    `Program ${targetProgram} invoke [1]`,
    `Program ${WOKENET_SYSTEM_PROGRAM_ADDRESS} invoke [2]`,
    `Program ${WOKENET_SYSTEM_PROGRAM_ADDRESS} success`,
    `Program data: ${encodedOverride ?? base64(event ?? new Uint8Array())}`,
    `Program ${targetProgram} success`,
  ];
}

function base64(value: Uint8Array): string {
  return getBase64Decoder().decode(value);
}

function allocate(value: Uint8Array, space: number): Uint8Array {
  if (value.byteLength > space) throw new TypeError('fixture exceeds allocation');
  const result = new Uint8Array(space);
  result.set(value);
  return result;
}

function readU32(value: Uint8Array, offset: number): number {
  return (
    ((value[offset] ?? 0) |
      ((value[offset + 1] ?? 0) << 8) |
      ((value[offset + 2] ?? 0) << 16) |
      ((value[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function readU64(value: Uint8Array, offset: number): bigint {
  let result = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(value[offset + index] ?? 0);
  }
  return result;
}

class TestWriter {
  readonly #bytes: number[];

  constructor(prefix: readonly number[]) {
    this.#bytes = [...prefix];
  }

  fixed(value: Uint8Array): this {
    this.#bytes.push(...value);
    return this;
  }

  address(value: string): this {
    return this.fixed(Uint8Array.from(ADDRESS_ENCODER.encode(address(value))));
  }

  boolean(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  u8(value: number): this {
    this.#bytes.push(value);
    return this;
  }

  u16(value: number): this {
    this.#bytes.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }

  u32(value: number): this {
    this.#bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }

  u64(value: bigint): this {
    let remaining = value;
    for (let index = 0; index < 8; index += 1) {
      this.#bytes.push(Number(remaining & 0xffn));
      remaining >>= 8n;
    }
    return this;
  }

  string(value: string): this {
    const encoded = new TextEncoder().encode(value);
    return this.u32(encoded.byteLength).fixed(encoded);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

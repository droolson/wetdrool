import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MESSAGING_CAPABILITIES,
  PairwiseMessagingError,
  createPairwiseDevice,
  type CreatePairwiseDeviceOptions,
  type CurrentDeviceAuthorizationResolver,
  type PairwiseCiphertextEnvelope,
  type PairwiseMessagingDevice,
  type SocialDeviceAddress,
  type UntrustedKeyDirectoryTransport,
} from '../src/index.js';
import { createTestDevice, TestAuthorizationResolver, TestKeyDirectory } from './harness.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const aliceAddress = {
  identityId: 'did:wetdrool:alice',
  deviceId: 'alice-phone-1',
} as const;
const bobAddress = {
  identityId: 'did:wetdrool:bob',
  deviceId: 'bob-phone-1',
} as const;
const bobRotatedAddress = {
  identityId: 'did:wetdrool:bob',
  deviceId: 'bob-phone-2',
} as const;
const charlieAddress = {
  identityId: 'did:wetdrool:charlie',
  deviceId: 'charlie-phone-1',
} as const;

const liveDevices: PairwiseMessagingDevice[] = [];

async function device(
  address: SocialDeviceAddress,
  directory: TestKeyDirectory,
  resolver: TestAuthorizationResolver,
): Promise<PairwiseMessagingDevice> {
  const created = await createTestDevice(address, directory, resolver);
  liveDevices.push(created);
  return created;
}

function expectCode(
  promise: Promise<unknown>,
  code: PairwiseMessagingError['code'],
): Promise<void> {
  return promise.then(
    () => {
      throw new Error(`Expected ${code}.`);
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(PairwiseMessagingError);
      expect((error as PairwiseMessagingError).code).toBe(code);
      expect((error as Error).message).not.toContain('did:wetdrool:');
    },
  );
}

function volatileOptions(
  localDevice: SocialDeviceAddress,
  authorizationResolver: CurrentDeviceAuthorizationResolver,
  keyDirectory: UntrustedKeyDirectoryTransport,
): CreatePairwiseDeviceOptions {
  return {
    localDevice,
    authorizationResolver,
    keyDirectory,
    storage: {
      kind: 'memory',
      usage: 'test-or-development',
      acknowledgeVolatileKeyLoss: true,
    },
    runtimeEnvironment: 'test',
  };
}

function mutateCiphertext(envelope: PairwiseCiphertextEnvelope): PairwiseCiphertextEnvelope {
  const padded = envelope.ciphertext
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(envelope.ciphertext.length + ((4 - (envelope.ciphertext.length % 4)) % 4), '=');
  const encryptedJson = decoder.decode(
    Uint8Array.from(atob(padded), (character) => character.codePointAt(0) ?? 0),
  );
  const encrypted = JSON.parse(encryptedJson) as {
    ciphertext: Record<string, { body: string; type: number }>;
  };
  const recipientKey = Object.keys(encrypted.ciphertext)[0];
  if (recipientKey === undefined) {
    throw new Error('Missing encrypted recipient.');
  }
  const entry = encrypted.ciphertext[recipientKey];
  if (entry === undefined || entry.body.length === 0) {
    throw new Error('Missing encrypted body.');
  }
  entry.body = `${entry.body.startsWith('A') ? 'B' : 'A'}${entry.body.slice(1)}`;
  const mutatedBytes = encoder.encode(JSON.stringify(encrypted));
  let binary = '';
  for (const byte of mutatedBytes) {
    binary += String.fromCodePoint(byte);
  }
  return {
    ...envelope,
    ciphertext: btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, ''),
  };
}

afterEach(async () => {
  await Promise.all(liveDevices.splice(0).map(async (entry) => entry.close()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('real matrix-rust-sdk WASM pairwise adapter', () => {
  it('publishes engine-generated identity and one-time keys without exposing engine IDs', async () => {
    const directory = new TestKeyDirectory();
    const resolver = new TestAuthorizationResolver();
    const alice = await device(aliceAddress, directory, resolver);
    const binding = alice.getLocalDeviceKeyBinding();

    expect(binding).toMatchObject({ version: 1, ...aliceAddress });
    expect(binding.curve25519PublicKey).toMatch(/^[A-Za-z0-9+/]{43}$/u);
    expect(binding.ed25519PublicKey).toMatch(/^[A-Za-z0-9+/]{43}$/u);

    const upload = directory.transcript.find((entry) => entry.operation === 'keys-upload');
    expect(upload).toBeDefined();
    const body = JSON.parse(upload?.body ?? '{}') as {
      device_keys?: {
        algorithms?: string[];
        keys?: Record<string, string>;
        signatures?: Record<string, Record<string, string>>;
      };
      one_time_keys?: Record<string, unknown>;
    };
    expect(body.device_keys?.algorithms).toContain('m.olm.v1.curve25519-aes-sha2');
    expect(Object.values(body.device_keys?.keys ?? {})).toContain(binding.curve25519PublicKey);
    expect(Object.values(body.device_keys?.keys ?? {})).toContain(binding.ed25519PublicKey);
    expect(Object.keys(body.device_keys?.signatures ?? {})).toHaveLength(1);
    expect(Object.keys(body.one_time_keys ?? {}).length).toBeGreaterThan(0);

    expect(Object.keys(binding)).toEqual([
      'version',
      'identityId',
      'deviceId',
      'curve25519PublicKey',
      'ed25519PublicKey',
    ]);
    expect(JSON.stringify(binding)).not.toContain('@wetdrool_');
    expect(JSON.stringify(binding)).not.toContain('messaging.invalid');
  });

  it('round-trips independent devices and keeps plaintext out of relay and directory artifacts', async () => {
    const directory = new TestKeyDirectory();
    const resolver = new TestAuthorizationResolver();
    const alice = await device(aliceAddress, directory, resolver);
    const bob = await device(bobAddress, directory, resolver);
    resolver.authorize(alice.getLocalDeviceKeyBinding());
    resolver.authorize(bob.getLocalDeviceKeyBinding());
    const plaintext = 'violet ferry 7391 — private';

    const envelope = await alice.encrypt({
      recipient: bobAddress,
      plaintext: encoder.encode(plaintext),
      contentType: 'text/plain',
    });
    expect(JSON.stringify(envelope)).not.toContain(plaintext);
    expect(envelope.protocol).toBe('wetdrool.com.messaging.pairwise.v1');
    expect(envelope.signature).toMatchObject({ algorithm: 'ed25519' });
    expect(envelope.signature.value).toMatch(/^[A-Za-z0-9+/]{86}$/u);
    expect(directory.transcript.map((entry) => entry.body).join('\n')).not.toContain(plaintext);
    expect(new Set(directory.transcript.map((entry) => entry.operation))).toEqual(
      new Set(['keys-upload', 'keys-query', 'keys-claim']),
    );

    const decrypted = await bob.decrypt({ envelope });
    expect(decoder.decode(decrypted.plaintext)).toBe(plaintext);
    expect(decrypted.sender).toEqual(aliceAddress);
    expect(decrypted.recipient).toEqual(bobAddress);
    expect(decrypted.messageId).toBe(envelope.messageId);
    expect(decrypted.contentType).toBe('text/plain');
  });

  it('survives post-session loss and reordering while rejecting duplicates', async () => {
    const directory = new TestKeyDirectory();
    const resolver = new TestAuthorizationResolver();
    const alice = await device(aliceAddress, directory, resolver);
    const bob = await device(bobAddress, directory, resolver);
    resolver.authorize(alice.getLocalDeviceKeyBinding());
    resolver.authorize(bob.getLocalDeviceKeyBinding());

    const warmup = await alice.encrypt({
      recipient: bobAddress,
      plaintext: encoder.encode('session start'),
      contentType: 'text/plain',
    });
    await bob.decrypt({ envelope: warmup });
    const messages = await Promise.all(
      ['one', 'two-lost-until-late', 'three'].map(async (text) =>
        alice.encrypt({
          recipient: bobAddress,
          plaintext: encoder.encode(text),
          contentType: 'text/plain',
        }),
      ),
    );
    const first = messages[0];
    const delayed = messages[1];
    const third = messages[2];
    if (first === undefined || delayed === undefined || third === undefined) {
      throw new Error('Missing encrypted test message.');
    }

    await expect(bob.decrypt({ envelope: third })).resolves.toMatchObject({
      messageId: third.messageId,
    });
    await expect(bob.decrypt({ envelope: first })).resolves.toMatchObject({
      messageId: first.messageId,
    });
    await expectCode(bob.decrypt({ envelope: third }), 'DUPLICATE_MESSAGE');
    const late = await bob.decrypt({ envelope: delayed });
    expect(decoder.decode(late.plaintext)).toBe('two-lost-until-late');
  });

  it('authenticates outer routing fields before Olm state mutation', async () => {
    const directory = new TestKeyDirectory();
    const resolver = new TestAuthorizationResolver();
    const alice = await device(aliceAddress, directory, resolver);
    const bob = await device(bobAddress, directory, resolver);
    const charlie = await device(charlieAddress, directory, resolver);
    resolver.authorize(alice.getLocalDeviceKeyBinding());
    resolver.authorize(bob.getLocalDeviceKeyBinding());
    resolver.authorize(charlie.getLocalDeviceKeyBinding());

    const envelope = await alice.encrypt({
      recipient: bobAddress,
      plaintext: encoder.encode('authenticated payload'),
      contentType: 'application/json',
    });
    const changedMessageId = {
      ...envelope,
      messageId: 'wetdrool-message_AAAAAAAAAAAAAAAAAAAAAA',
    };
    const changedSender = {
      ...envelope,
      sender: charlieAddress,
    };
    const changedSignature = {
      ...envelope,
      signature: {
        ...envelope.signature,
        value: `${envelope.signature.value.startsWith('A') ? 'B' : 'A'}${envelope.signature.value.slice(1)}`,
      },
    };

    await expectCode(bob.decrypt({ envelope: changedMessageId }), 'DECRYPTION_FAILED');
    await expectCode(bob.decrypt({ envelope: changedSender }), 'DECRYPTION_FAILED');
    await expectCode(bob.decrypt({ envelope: changedSignature }), 'DECRYPTION_FAILED');
    await expectCode(bob.decrypt({ envelope: mutateCiphertext(envelope) }), 'DECRYPTION_FAILED');
    await expectCode(charlie.decrypt({ envelope }), 'WRONG_RECIPIENT');
    await expect(bob.decrypt({ envelope })).resolves.toMatchObject({
      messageId: envelope.messageId,
    });
  });

  it('fails closed on denial and revocation, then admits a newly authorized rotation', async () => {
    const directory = new TestKeyDirectory();
    const resolver = new TestAuthorizationResolver();
    const alice = await device(aliceAddress, directory, resolver);
    const bob = await device(bobAddress, directory, resolver);
    resolver.authorize(alice.getLocalDeviceKeyBinding());

    await expectCode(
      alice.encrypt({
        recipient: bobAddress,
        plaintext: encoder.encode('must not leave'),
        contentType: 'text/plain',
      }),
      'DEVICE_UNAUTHORIZED',
    );
    expect(directory.transcript.filter((entry) => entry.operation === 'keys-claim')).toHaveLength(
      0,
    );

    const bobBinding = bob.getLocalDeviceKeyBinding();
    resolver.authorize(
      {
        ...bobBinding,
        curve25519PublicKey: `${bobBinding.curve25519PublicKey.slice(0, -1)}${
          bobBinding.curve25519PublicKey.endsWith('A') ? 'B' : 'A'
        }`,
      },
      { assertionId: 'mismatched-engine-key', revision: 6 },
    );
    await expectCode(
      alice.encrypt({
        recipient: bobAddress,
        plaintext: encoder.encode('directory keys are not authorization'),
        contentType: 'text/plain',
      }),
      'DEVICE_UNAUTHORIZED',
    );
    expect(directory.transcript.filter((entry) => entry.operation === 'keys-claim')).toHaveLength(
      0,
    );

    resolver.authorize(bobBinding, { revision: 7 });
    const toOldDevice = await alice.encrypt({
      recipient: bobAddress,
      plaintext: encoder.encode('authorized once'),
      contentType: 'text/plain',
    });
    resolver.revoke(bobAddress);
    await expectCode(alice.refreshDevice(bobAddress), 'DEVICE_UNAUTHORIZED');
    await expectCode(
      alice.encrypt({
        recipient: bobAddress,
        plaintext: encoder.encode('revoked'),
        contentType: 'text/plain',
      }),
      'DEVICE_UNAUTHORIZED',
    );

    resolver.authorize(bobBinding, { revision: 8 });
    resolver.revoke(aliceAddress);
    await expectCode(bob.decrypt({ envelope: toOldDevice }), 'DEVICE_UNAUTHORIZED');
    resolver.authorize(alice.getLocalDeviceKeyBinding(), { revision: 2 });
    await expect(bob.decrypt({ envelope: toOldDevice })).resolves.toMatchObject({
      sender: aliceAddress,
    });

    const bobRotated = await device(bobRotatedAddress, directory, resolver);
    resolver.authorize(bobRotated.getLocalDeviceKeyBinding(), { revision: 8 });
    const toRotatedDevice = await alice.encrypt({
      recipient: bobRotatedAddress,
      plaintext: encoder.encode('new device only'),
      contentType: 'text/plain',
    });
    const rotatedPlaintext = await bobRotated.decrypt({ envelope: toRotatedDevice });
    expect(decoder.decode(rotatedPlaintext.plaintext)).toBe('new device only');
    await expectCode(bob.decrypt({ envelope: toRotatedDevice }), 'WRONG_RECIPIENT');
  });

  it('gates the local device before plaintext release and outbound work', async () => {
    const directory = new TestKeyDirectory();
    const resolver = new TestAuthorizationResolver();
    const alice = await device(aliceAddress, directory, resolver);
    const bob = await device(bobAddress, directory, resolver);
    resolver.authorize(alice.getLocalDeviceKeyBinding());
    const bobBinding = bob.getLocalDeviceKeyBinding();
    resolver.authorize(bobBinding);

    const envelope = await alice.encrypt({
      recipient: bobAddress,
      plaintext: encoder.encode('queued before local revocation'),
      contentType: 'text/plain',
    });
    resolver.revoke(bobAddress);
    const transcriptLength = directory.transcript.length;

    await expectCode(bob.decrypt({ envelope }), 'DEVICE_UNAUTHORIZED');
    await expectCode(
      bob.encrypt({
        recipient: aliceAddress,
        plaintext: encoder.encode('must remain local'),
        contentType: 'text/plain',
      }),
      'DEVICE_UNAUTHORIZED',
    );
    expect(directory.transcript).toHaveLength(transcriptLength);

    resolver.authorize(bobBinding, { revision: 2 });
    const decrypted = await bob.decrypt({ envelope });
    expect(decoder.decode(decrypted.plaintext)).toBe('queued before local revocation');
  });

  it('detects a local authorization change spanning encryption', async () => {
    const directory = new TestKeyDirectory();
    const baseConnection = directory.createConnection();
    const resolver = new TestAuthorizationResolver();
    let rotateLocalAuthorization = false;
    const localState: {
      binding: ReturnType<PairwiseMessagingDevice['getLocalDeviceKeyBinding']> | undefined;
    } = { binding: undefined };
    const alice = await createPairwiseDevice({
      ...volatileOptions(aliceAddress, resolver, {
        exchange: async (request) => {
          if (
            rotateLocalAuthorization &&
            request.operation === 'keys-query' &&
            localState.binding !== undefined
          ) {
            rotateLocalAuthorization = false;
            resolver.authorize(localState.binding, { revision: 2 });
          }
          return baseConnection.exchange(request);
        },
      }),
    });
    liveDevices.push(alice);
    const bob = await device(bobAddress, directory, resolver);
    localState.binding = alice.getLocalDeviceKeyBinding();
    resolver.authorize(localState.binding, { revision: 1 });
    resolver.authorize(bob.getLocalDeviceKeyBinding());
    rotateLocalAuthorization = true;

    await expectCode(
      alice.encrypt({
        recipient: bobAddress,
        plaintext: encoder.encode('authorization race'),
        contentType: 'text/plain',
      }),
      'AUTHORIZATION_CHANGED',
    );
    await expect(
      alice.encrypt({
        recipient: bobAddress,
        plaintext: encoder.encode('stable retry'),
        contentType: 'text/plain',
      }),
    ).resolves.toMatchObject({ sender: aliceAddress, recipient: bobAddress });
  });

  it('rejects non-scalar Unicode before deriving Matrix identifiers', async () => {
    const directory = new TestKeyDirectory();
    const resolver = new TestAuthorizationResolver();
    const invalidAddresses: SocialDeviceAddress[] = [
      { identityId: 'did:wetdrool:invalid-\ud800', deviceId: 'phone' },
      { identityId: 'did:wetdrool:invalid-\udfff', deviceId: 'phone' },
      { identityId: 'did:wetdrool:valid', deviceId: 'phone-\ud800' },
      { identityId: 'did:wetdrool:valid', deviceId: 'phone-\udfff' },
    ];

    for (const address of invalidAddresses) {
      await expectCode(
        createPairwiseDevice(volatileOptions(address, resolver, directory.createConnection())),
        'INVALID_INPUT',
      );
    }
    expect(directory.transcript).toHaveLength(0);
  });

  it('keeps the implementation constructor private at runtime and rejects volatile production use', async () => {
    const runtimeExports: Record<string, unknown> = await import('../src/index.js');
    expect(runtimeExports).not.toHaveProperty('PairwiseMessagingDevice');

    const directory = new TestKeyDirectory();
    const resolver = new TestAuthorizationResolver();
    await expectCode(
      createPairwiseDevice({
        ...volatileOptions(aliceAddress, resolver, directory.createConnection()),
        runtimeEnvironment: 'production',
      }),
      'PRODUCTION_STORAGE_UNAVAILABLE',
    );

    const unacknowledgedStorage = {
      ...volatileOptions(aliceAddress, resolver, directory.createConnection()),
      storage: {
        kind: 'memory',
        usage: 'test-or-development',
      },
    } as unknown as CreatePairwiseDeviceOptions;
    await expectCode(createPairwiseDevice(unacknowledgedStorage), 'INVALID_INPUT');

    vi.stubEnv('NODE_ENV', 'production');
    await expectCode(
      createPairwiseDevice(volatileOptions(aliceAddress, resolver, directory.createConnection())),
      'PRODUCTION_STORAGE_UNAVAILABLE',
    );
    expect(directory.transcript).toHaveLength(0);
  });

  it('bounds resolver and directory stalls and lets close cancel active work', async () => {
    const directory = new TestKeyDirectory();
    const neverResolvingResolver: CurrentDeviceAuthorizationResolver = {
      getCurrentDeviceAuthorization: async (_address, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => {
              reject(context.signal.reason);
            },
            { once: true },
          );
        }),
    };
    const resolverBounded = await createPairwiseDevice({
      ...volatileOptions(aliceAddress, neverResolvingResolver, directory.createConnection()),
      authorizationTimeoutMs: 10,
    });
    liveDevices.push(resolverBounded);
    await expectCode(
      resolverBounded.encrypt({
        recipient: bobAddress,
        plaintext: encoder.encode('resolver timeout'),
        contentType: 'text/plain',
      }),
      'DEVICE_UNAUTHORIZED',
    );

    await expectCode(
      createPairwiseDevice({
        ...volatileOptions(aliceAddress, new TestAuthorizationResolver(), {
          exchange: async () => new Promise(() => undefined),
        }),
        directoryTimeoutMs: 10,
      }),
      'DIRECTORY_UNAVAILABLE',
    );

    const cancellableDirectory = new TestKeyDirectory();
    const baseConnection = cancellableDirectory.createConnection();
    const resolver = new TestAuthorizationResolver();
    let hangQueries = false;
    let startQuery: (() => void) | undefined;
    const queryStarted = new Promise<void>((resolve) => {
      startQuery = resolve;
    });
    let activeSignal: AbortSignal | undefined;
    const alice = await createPairwiseDevice({
      ...volatileOptions(aliceAddress, resolver, {
        exchange: async (request) => {
          if (hangQueries && request.operation === 'keys-query') {
            activeSignal = request.signal;
            startQuery?.();
            return new Promise(() => undefined);
          }
          return baseConnection.exchange(request);
        },
      }),
      directoryTimeoutMs: 120_000,
    });
    liveDevices.push(alice);
    const bob = await device(bobAddress, cancellableDirectory, resolver);
    resolver.authorize(alice.getLocalDeviceKeyBinding());
    resolver.authorize(bob.getLocalDeviceKeyBinding());
    hangQueries = true;

    const pendingRefresh = alice.refreshDevice(bobAddress);
    await queryStarted;
    const closing = alice.close();
    await expectCode(pendingRefresh, 'CLOSED');
    await expect(closing).resolves.toBeUndefined();
    expect(activeSignal?.aborted).toBe(true);
  });

  it('zeroes the owned plaintext copy on closed-device rejection and avoids copying invalid input', async () => {
    const directory = new TestKeyDirectory();
    const resolver = new TestAuthorizationResolver();
    const alice = await device(aliceAddress, directory, resolver);
    await alice.close();

    const ownedCopy = new Uint8Array([91, 92, 93]);
    const from = vi.spyOn(Uint8Array, 'from').mockReturnValueOnce(ownedCopy);
    await expectCode(
      alice.encrypt({
        recipient: bobAddress,
        plaintext: new Uint8Array([1, 2, 3]),
        contentType: 'text/plain',
      }),
      'CLOSED',
    );
    expect([...ownedCopy]).toEqual([0, 0, 0]);

    from.mockClear();
    await expectCode(
      alice.encrypt({
        recipient: bobAddress,
        plaintext: new Uint8Array([4, 5, 6]),
        contentType: 'not a content type',
      }),
      'INVALID_INPUT',
    );
    expect(from).not.toHaveBeenCalled();
  });

  it('keeps room/group encryption absent and explicitly disabled', async () => {
    const directory = new TestKeyDirectory();
    const resolver = new TestAuthorizationResolver();
    const alice = await device(aliceAddress, directory, resolver);
    const prototypeMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(alice));

    expect(MESSAGING_CAPABILITIES).toEqual({
      pairwiseEncryption: 'enabled',
      groupEncryption: 'disabled',
      roomEncryption: 'disabled',
    });
    expect(prototypeMethods).not.toContain('encryptRoomEvent');
    expect(prototypeMethods).not.toContain('encryptGroup');
    expect(prototypeMethods).not.toContain('shareRoomKey');
    expect(
      directory.transcript.every((entry) =>
        ['keys-upload', 'keys-query', 'keys-claim'].includes(entry.operation),
      ),
    ).toBe(true);
  });

  it('redacts upstream directory failures behind fixed public errors', async () => {
    const resolver = new TestAuthorizationResolver();
    const creation = createPairwiseDevice({
      localDevice: aliceAddress,
      authorizationResolver: resolver,
      keyDirectory: {
        exchange: async () => {
          throw new Error('raw @alice:example.invalid key-server failure');
        },
      },
      storage: {
        kind: 'memory',
        usage: 'test-or-development',
        acknowledgeVolatileKeyLoss: true,
      },
      runtimeEnvironment: 'test',
    });

    await expectCode(creation, 'DIRECTORY_UNAVAILABLE');
  });
});

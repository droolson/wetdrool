import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import type { NetworkId } from '@wokesocial/protocol';
import { MemoryContentAddressedStorage } from '@wokesocial/storage';

import {
  AnchorEventDecodingError,
  buildIndexerApp,
  decodeAnchorEventLog,
  deriveRecoveryPolicyAddress,
  deriveRecoveryRequestAddress,
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  SolanaEventMaterializer,
  type ProtocolEvent,
  type RecoveryApprovedEvent,
  type RecoveryExecutedEvent,
  type RecoveryRequestedEvent,
  type SolanaEventMaterializationError,
} from '../src/index.js';

const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
const networkId = `wokenet:v1:${publicKey(1)}:${programId}` as NetworkId;
const configAddress = publicKey(2);
const identityAddress = publicKey(3);
const identityId = `wokesocialid:v1:${networkId}:${identityAddress}`;
const originalRoot = publicKey(4);
const recoveredRoot = publicKey(5);
const secondTargetRoot = publicKey(6);
const executor = publicKey(7);
const guardians = [publicKey(8), publicKey(9), publicKey(10)] as const;
const requestNonce = bytes(16, 30);
const secondRequestNonce = bytes(16, 50);
const requestNonceHex = Buffer.from(requestNonce).toString('hex');
const secondRequestNonceHex = Buffer.from(secondRequestNonce).toString('hex');
const recoveryPolicyAddress = await deriveRecoveryPolicyAddress(programId, identityAddress);
const recoveryRequestAddress = await deriveRecoveryRequestAddress(
  programId,
  identityAddress,
  requestNonce,
);
const secondRecoveryRequestAddress = await deriveRecoveryRequestAddress(
  programId,
  identityAddress,
  secondRequestNonce,
);

describe('recovery Anchor events', () => {
  it('strictly decodes and materializes all six recovery IDL layouts', async () => {
    expect(Object.keys(SOCIAL_PROTOCOL_EVENT_LAYOUT.events)).toHaveLength(32);
    const projection = new MemoryProjectionStore();
    const materializer = new SolanaEventMaterializer(
      new MemoryContentAddressedStorage(),
      projection,
    );
    const cases = [
      {
        encoded: configuredAnchorEvent(),
        slot: 3n,
        expected: {
          kind: 'recovery-policy-configured',
          policySequence: 1n,
          guardians,
          threshold: 2,
          delaySlots: 2n,
        },
        normalized: {
          type: 'recovery-policy-configured',
          identityId,
          recoveryPolicyAddress,
        },
      },
      {
        encoded: disabledAnchorEvent(),
        slot: 10n,
        expected: {
          kind: 'recovery-policy-disabled',
          policySequence: 3n,
          identitySequence: 5n,
        },
        normalized: {
          type: 'recovery-policy-disabled',
          identityId,
          recoveryPolicyAddress,
        },
      },
      {
        encoded: requestedAnchorEvent(),
        slot: 4n,
        expected: {
          kind: 'recovery-requested',
          requestNonce,
          approvalCount: 1,
          executeAfterSlot: 6n,
        },
        normalized: {
          type: 'recovery-requested',
          identityId,
          recoveryRequestAddress,
          requestNonce: requestNonceHex,
        },
      },
      {
        encoded: approvedAnchorEvent(),
        slot: 5n,
        expected: {
          kind: 'recovery-approved',
          guardian: guardians[1],
          guardianIndex: 1,
          approvalCount: 2,
        },
        normalized: {
          type: 'recovery-approved',
          identityId,
          recoveryRequestAddress,
        },
      },
      {
        encoded: cancelledAnchorEvent(),
        slot: 9n,
        expected: {
          kind: 'recovery-cancelled',
          recoveryRequest: secondRecoveryRequestAddress,
          identitySequence: 4n,
        },
        normalized: {
          type: 'recovery-cancelled',
          identityId,
          recoveryRequestAddress: secondRecoveryRequestAddress,
        },
      },
      {
        encoded: executedAnchorEvent(),
        slot: 6n,
        expected: {
          kind: 'recovery-executed',
          previousRootAuthority: originalRoot,
          newRootAuthority: recoveredRoot,
          rotationCount: 1n,
        },
        normalized: {
          type: 'recovery-executed',
          identityId,
          recoveryRequestAddress,
        },
      },
    ] as const;

    for (const [index, item] of cases.entries()) {
      const decoded = decodeAnchorEventLog(item.encoded);
      expect(decoded).toMatchObject(item.expected);
      await expect(
        materializer.materialize(decoded, context(item.slot, 100 + index)),
      ).resolves.toMatchObject(item.normalized);
    }
  });

  it('fails closed on bounded-vector, trailing-byte, account, slot, and event-version drift', async () => {
    const tooManyGuardians = configuredAnchorEvent({
      guardians: [...guardians, publicKey(11), publicKey(12), publicKey(13)],
    });
    expect(() => decodeAnchorEventLog(tooManyGuardians)).toThrow(AnchorEventDecodingError);

    const trailing = Buffer.concat([
      Buffer.from(requestedAnchorEvent(), 'base64'),
      Buffer.from([0]),
    ]).toString('base64');
    expect(() => decodeAnchorEventLog(trailing)).toThrow(/trailing bytes/u);

    const projection = new MemoryProjectionStore();
    const materializer = new SolanaEventMaterializer(
      new MemoryContentAddressedStorage(),
      projection,
    );
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(configuredAnchorEvent({ recoveryPolicy: publicKey(14) })),
        context(3n, 114),
      ),
    ).rejects.toMatchObject({
      code: 'account-mismatch',
    } satisfies Partial<SolanaEventMaterializationError>);
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(requestedAnchorEvent({ recoveryRequest: publicKey(15) })),
        context(4n, 115),
      ),
    ).rejects.toMatchObject({
      code: 'account-mismatch',
    } satisfies Partial<SolanaEventMaterializationError>);
    await expect(
      materializer.materialize(decodeAnchorEventLog(requestedAnchorEvent()), context(5n, 116)),
    ).rejects.toMatchObject({
      code: 'slot-mismatch',
    } satisfies Partial<SolanaEventMaterializationError>);
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(configuredAnchorEvent({ eventVersion: 2 })),
        context(3n, 117),
      ),
    ).rejects.toMatchObject({
      code: 'unsupported-version',
    } satisfies Partial<SolanaEventMaterializationError>);
  });
});

describe('recovery projection', () => {
  it('isolates identical identity, policy, and request addresses by network', async () => {
    const secondNetworkId = `wokenet:v1:${publicKey(140)}:${programId}` as NetworkId;
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(new MemoryContentAddressedStorage(), {
        authorize: () => Promise.resolve(false),
      }),
    );
    const firstNetworkEvents = recoveryEvents();
    const secondNetworkEvents = firstNetworkEvents.map((event) =>
      moveEventToNetwork(event, secondNetworkId),
    );

    for (const event of [...firstNetworkEvents, ...secondNetworkEvents]) {
      await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
    }

    const secondIdentityId = identityId.replace(networkId, secondNetworkId);
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      networkId,
      identityAddress,
    });
    await expect(projection.getIdentity(secondIdentityId)).resolves.toMatchObject({
      networkId: secondNetworkId,
      identityAddress,
    });
    await expect(projection.getRecoveryPolicy(identityId)).resolves.toMatchObject({
      networkId,
      recoveryPolicyAddress,
    });
    await expect(projection.getRecoveryPolicy(secondIdentityId)).resolves.toMatchObject({
      networkId: secondNetworkId,
      recoveryPolicyAddress,
    });
    await expect(
      projection.getRecoveryRequest(networkId, recoveryRequestAddress),
    ).resolves.toMatchObject({
      networkId,
      recoveryRequestAddress,
      state: 'executed',
    });
    await expect(
      projection.getRecoveryRequest(secondNetworkId, recoveryRequestAddress),
    ).resolves.toMatchObject({
      networkId: secondNetworkId,
      recoveryRequestAddress,
      state: 'executed',
    });
  });

  it('preserves raw events and prior state when a late replay transition fails', async () => {
    const fixture = await fixtureThrough(recoveryEvents().length);
    const before = stableJson({
      policy: await fixture.projection.getRecoveryPolicy(identityId),
      requests: await fixture.projection.getRecoveryRequestsByIdentity(identityId),
      checkpoint: await fixture.projection.checkpoint(networkId),
      events: fixture.projection.events(networkId),
    });
    const invalidLateApproval: RecoveryApprovedEvent = {
      ...(fixture.events[4] as RecoveryApprovedEvent),
      ...base(11n, 140),
      approvalCount: 3,
    };

    await expect(
      fixture.indexer.rebuild(networkId, [...fixture.events, invalidLateApproval]),
    ).rejects.toBeInstanceOf(Error);

    const after = stableJson({
      policy: await fixture.projection.getRecoveryPolicy(identityId),
      requests: await fixture.projection.getRecoveryRequestsByIdentity(identityId),
      checkpoint: await fixture.projection.checkpoint(networkId),
      events: fixture.projection.events(networkId),
    });
    expect(after).toBe(before);
  });

  it('projects both terminal lifecycles, serves non-authoritative APIs, and rebuilds deterministically', async () => {
    const fixture = await fixtureThrough(recoveryEvents().length);
    const policy = await fixture.projection.getRecoveryPolicy(identityId);
    const executed = await fixture.projection.getRecoveryRequest(networkId, recoveryRequestAddress);
    const cancelled = await fixture.projection.getRecoveryRequest(
      networkId,
      secondRecoveryRequestAddress,
    );

    expect(policy).toMatchObject({
      recoveryPolicyAddress,
      identityId,
      policySequence: 3n,
      identitySequence: 5n,
      rootRotationCount: 1n,
      active: false,
    });
    expect(executed).toMatchObject({
      recoveryRequestAddress,
      approvalsMask: 3,
      approvedGuardians: [guardians[0], guardians[1]],
      approvalCount: 2,
      state: 'executed',
      terminalIdentitySequence: 2n,
      terminalRootRotationCount: 1n,
      executor,
    });
    expect(cancelled).toMatchObject({
      recoveryRequestAddress: secondRecoveryRequestAddress,
      approvalsMask: 1,
      state: 'cancelled',
      terminalIdentitySequence: 4n,
      cancelledByRootAuthority: recoveredRoot,
    });

    const app = await buildIndexerApp({ projection: fixture.projection, logger: false });
    try {
      const policyResponse = await app.inject({
        method: 'GET',
        url: `/v1/recovery/identities/${encodeURIComponent(identityId)}/policy`,
      });
      expect(policyResponse.statusCode).toBe(200);
      expect(policyResponse.json()).toMatchObject({
        canonical: false,
        authoritativeSource: 'wokenet-account-state',
        policy: { policySequence: '3', active: false },
      });
      const requestsResponse = await app.inject({
        method: 'GET',
        url: `/v1/recovery/identities/${encodeURIComponent(identityId)}/requests`,
      });
      expect(requestsResponse.statusCode).toBe(200);
      expect(requestsResponse.json()).toMatchObject({
        canonical: false,
        eligibilityEvaluated: false,
        requests: [
          { recoveryRequestAddress, state: 'executed', approvalCount: 2 },
          {
            recoveryRequestAddress: secondRecoveryRequestAddress,
            state: 'cancelled',
            approvalCount: 1,
          },
        ],
      });
      const requestResponse = await app.inject({
        method: 'GET',
        url: `/v1/recovery/requests/${recoveryRequestAddress}?network=${encodeURIComponent(networkId)}`,
      });
      expect(requestResponse.statusCode).toBe(200);
      expect(requestResponse.json()).toMatchObject({
        canonical: false,
        eligibilityEvaluated: false,
        request: { recoveryRequestAddress, state: 'executed' },
      });
      const missingNetworkResponse = await app.inject({
        method: 'GET',
        url: `/v1/recovery/requests/${recoveryRequestAddress}`,
      });
      expect(missingNetworkResponse.statusCode).toBe(400);
      const shortAddressResponse = await app.inject({
        method: 'GET',
        url: `/v1/recovery/requests/abc?network=${encodeURIComponent(networkId)}`,
      });
      expect(shortAddressResponse.statusCode).toBe(400);
      const openApiResponse = await app.inject({ method: 'GET', url: '/openapi.json' });
      expect(openApiResponse.statusCode).toBe(200);
      expect(openApiResponse.json().paths).toHaveProperty(
        '/v1/recovery/requests/{recoveryRequestAddress}',
      );
    } finally {
      await app.close();
    }

    const before = stableJson({
      policy,
      requests: await fixture.projection.getRecoveryRequestsByIdentity(identityId),
      checkpoint: await fixture.projection.checkpoint(networkId),
    });
    const rebuilt = await fixture.indexer.rebuild(networkId, [...fixture.events].reverse());
    expect(rebuilt).toHaveLength(fixture.events.length);
    const after = stableJson({
      policy: await fixture.projection.getRecoveryPolicy(identityId),
      requests: await fixture.projection.getRecoveryRequestsByIdentity(identityId),
      checkpoint: await fixture.projection.checkpoint(networkId),
    });
    expect(after).toBe(before);
  });

  it('rejects guardian, duplicate-approval, stale-policy, substituted-account, and unpaired-execution transitions', async () => {
    const requestFixture = await fixtureThrough(4);
    const approval = recoveryEvents()[4] as RecoveryApprovedEvent;
    await expect(
      requestFixture.indexer.ingest({
        ...approval,
        transactionSignature: signature(130),
        guardian: guardians[2],
      }),
    ).rejects.toMatchObject({ code: 'stale-event' });
    await expect(
      requestFixture.indexer.ingest({
        ...(recoveryEvents()[3] as RecoveryRequestedEvent),
        transactionSignature: signature(131),
        recoveryRequestAddress: publicKey(131),
      }),
    ).rejects.toMatchObject({ code: 'stale-event' });
    await expect(requestFixture.indexer.ingest(approval)).resolves.toMatchObject({
      applied: true,
    });
    await expect(
      requestFixture.indexer.ingest({
        ...approval,
        transactionSignature: signature(132),
        approvalCount: 3,
      }),
    ).rejects.toMatchObject({ code: 'stale-event' });

    const executionFixture = await fixtureThrough(5);
    await expect(
      executionFixture.indexer.ingest(recoveryEvents()[6] as RecoveryExecutedEvent),
    ).rejects.toMatchObject({ code: 'stale-event' });

    const stalePolicyFixture = await fixtureThrough(5);
    await stalePolicyFixture.indexer.ingest(recoveryEvents()[5] as ProtocolEvent);
    await stalePolicyFixture.indexer.ingest(recoveryEvents()[6] as ProtocolEvent);
    await stalePolicyFixture.indexer.ingest(recoveryEvents()[7] as ProtocolEvent);
    await expect(
      stalePolicyFixture.indexer.ingest({
        ...approval,
        transactionSignature: signature(133),
        approvalCount: 3,
      }),
    ).rejects.toMatchObject({ code: 'stale-event' });
  });
});

async function fixtureThrough(eventCount: number) {
  const projection = new MemoryProjectionStore();
  const indexer = new OpenIndexer(
    projection,
    new ManifestVerifier(new MemoryContentAddressedStorage(), {
      authorize: () => Promise.resolve(false),
    }),
  );
  const events = recoveryEvents();
  for (const event of events.slice(0, eventCount)) {
    await indexer.ingest(event);
  }
  return { projection, indexer, events };
}

function recoveryEvents(): readonly ProtocolEvent[] {
  const executionSignature = signature(60);
  return [
    {
      ...base(1n, 1),
      type: 'protocol-initialized',
      configAddress,
    },
    {
      ...base(2n, 2),
      type: 'identity-created',
      identityId,
      identityAddress,
      rootAuthority: originalRoot,
    },
    {
      ...base(3n, 3),
      type: 'recovery-policy-configured',
      identityId,
      recoveryPolicyAddress,
      rootAuthority: originalRoot,
      policySequence: 1n,
      identitySequence: 1n,
      rootRotationCount: 0n,
      guardians: [...guardians],
      threshold: 2,
      delaySlots: 2n,
    },
    {
      ...base(4n, 4),
      type: 'recovery-requested',
      identityId,
      recoveryPolicyAddress,
      recoveryRequestAddress,
      requestingGuardian: guardians[0],
      requestNonce: requestNonceHex,
      policySequence: 1n,
      currentRootAuthority: originalRoot,
      identitySequence: 1n,
      rootRotationCount: 0n,
      targetRootAuthority: recoveredRoot,
      threshold: 2,
      guardianCount: 3,
      approvalCount: 1,
      executeAfterSlot: 6n,
    },
    {
      ...base(5n, 5),
      type: 'recovery-approved',
      identityId,
      recoveryPolicyAddress,
      recoveryRequestAddress,
      guardian: guardians[1],
      guardianIndex: 1,
      policySequence: 1n,
      approvalCount: 2,
      threshold: 2,
    },
    {
      ...base(6n, 6, {
        transactionSignature: executionSignature,
        transactionIndex: 6,
        logIndex: 0,
      }),
      type: 'root-authority-rotated',
      identityId,
      previousRootAuthority: originalRoot,
      newRootAuthority: recoveredRoot,
      identitySequence: 2n,
      rotationCount: 1n,
    },
    {
      ...base(6n, 6, {
        transactionSignature: executionSignature,
        transactionIndex: 6,
        logIndex: 1,
      }),
      type: 'recovery-executed',
      identityId,
      recoveryPolicyAddress,
      recoveryRequestAddress,
      executor,
      previousRootAuthority: originalRoot,
      newRootAuthority: recoveredRoot,
      policySequence: 1n,
      approvalCount: 2,
      threshold: 2,
      identitySequence: 2n,
      rotationCount: 1n,
    },
    {
      ...base(7n, 7),
      type: 'recovery-policy-configured',
      identityId,
      recoveryPolicyAddress,
      rootAuthority: recoveredRoot,
      policySequence: 2n,
      identitySequence: 3n,
      rootRotationCount: 1n,
      guardians: [...guardians],
      threshold: 2,
      delaySlots: 2n,
    },
    {
      ...base(8n, 8),
      type: 'recovery-requested',
      identityId,
      recoveryPolicyAddress,
      recoveryRequestAddress: secondRecoveryRequestAddress,
      requestingGuardian: guardians[0],
      requestNonce: secondRequestNonceHex,
      policySequence: 2n,
      currentRootAuthority: recoveredRoot,
      identitySequence: 3n,
      rootRotationCount: 1n,
      targetRootAuthority: secondTargetRoot,
      threshold: 2,
      guardianCount: 3,
      approvalCount: 1,
      executeAfterSlot: 10n,
    },
    {
      ...base(9n, 9),
      type: 'recovery-cancelled',
      identityId,
      recoveryPolicyAddress,
      recoveryRequestAddress: secondRecoveryRequestAddress,
      cancelledByRootAuthority: recoveredRoot,
      targetRootAuthority: secondTargetRoot,
      policySequence: 2n,
      identitySequence: 4n,
      rootRotationCount: 1n,
    },
    {
      ...base(10n, 10),
      type: 'recovery-policy-disabled',
      identityId,
      recoveryPolicyAddress,
      rootAuthority: recoveredRoot,
      policySequence: 3n,
      identitySequence: 5n,
      rootRotationCount: 1n,
    },
  ];
}

function moveEventToNetwork(event: ProtocolEvent, targetNetworkId: NetworkId): ProtocolEvent {
  return Object.fromEntries(
    Object.entries(event).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.replace(networkId, targetNetworkId) : value,
    ]),
  ) as unknown as ProtocolEvent;
}

function base(
  slot: bigint,
  seed: number,
  overrides: {
    readonly transactionSignature?: string;
    readonly transactionIndex?: number;
    readonly logIndex?: number;
  } = {},
) {
  return {
    networkId,
    programId,
    transactionSignature: overrides.transactionSignature ?? signature(seed),
    transactionIndex: overrides.transactionIndex ?? seed,
    slot,
    logIndex: overrides.logIndex ?? 0,
    blockTime: blockTime(slot),
    finalized: true as const,
  };
}

function context(slot: bigint, seed: number) {
  return {
    networkId,
    programId,
    transactionSignature: signature(seed),
    transactionIndex: seed,
    slot,
    logIndex: 0,
    blockTime: Date.parse(blockTime(slot)) / 1_000,
  };
}

function blockTime(slot: bigint): string {
  return new Date(Date.UTC(2026, 6, 28, 18, 0, Number(slot))).toISOString();
}

function configuredAnchorEvent(
  overrides: {
    readonly eventVersion?: number;
    readonly recoveryPolicy?: string;
    readonly guardians?: readonly string[];
  } = {},
): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryPolicyConfigured,
    u16(overrides.eventVersion ?? 1),
    pubkey(configAddress),
    pubkey(identityAddress),
    pubkey(overrides.recoveryPolicy ?? recoveryPolicyAddress),
    pubkey(originalRoot),
    u64(1n),
    u64(1n),
    u64(0n),
    publicKeyVector(overrides.guardians ?? guardians),
    Uint8Array.of(2),
    u64(2n),
    u64(3n),
  );
}

function disabledAnchorEvent(): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryPolicyDisabled,
    u16(1),
    pubkey(configAddress),
    pubkey(identityAddress),
    pubkey(recoveryPolicyAddress),
    pubkey(recoveredRoot),
    u64(3n),
    u64(5n),
    u64(1n),
    u64(10n),
  );
}

function requestedAnchorEvent(overrides: { readonly recoveryRequest?: string } = {}): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryRequested,
    u16(1),
    pubkey(configAddress),
    pubkey(identityAddress),
    pubkey(recoveryPolicyAddress),
    pubkey(overrides.recoveryRequest ?? recoveryRequestAddress),
    pubkey(guardians[0]),
    requestNonce,
    u64(1n),
    pubkey(originalRoot),
    u64(1n),
    u64(0n),
    pubkey(recoveredRoot),
    Uint8Array.of(2),
    Uint8Array.of(3),
    Uint8Array.of(1),
    u64(4n),
    u64(6n),
  );
}

function approvedAnchorEvent(): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryApproved,
    u16(1),
    pubkey(configAddress),
    pubkey(identityAddress),
    pubkey(recoveryPolicyAddress),
    pubkey(recoveryRequestAddress),
    pubkey(guardians[1]),
    Uint8Array.of(1),
    u64(1n),
    Uint8Array.of(2),
    Uint8Array.of(2),
    u64(5n),
  );
}

function cancelledAnchorEvent(): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryCancelled,
    u16(1),
    pubkey(configAddress),
    pubkey(identityAddress),
    pubkey(recoveryPolicyAddress),
    pubkey(secondRecoveryRequestAddress),
    pubkey(recoveredRoot),
    pubkey(secondTargetRoot),
    u64(2n),
    u64(4n),
    u64(1n),
    u64(9n),
  );
}

function executedAnchorEvent(): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryExecuted,
    u16(1),
    pubkey(configAddress),
    pubkey(identityAddress),
    pubkey(recoveryPolicyAddress),
    pubkey(recoveryRequestAddress),
    pubkey(executor),
    pubkey(originalRoot),
    pubkey(recoveredRoot),
    u64(1n),
    Uint8Array.of(2),
    Uint8Array.of(2),
    u64(2n),
    u64(1n),
    u64(6n),
  );
}

function eventData(discriminator: readonly number[], ...fields: readonly Uint8Array[]): string {
  return Buffer.concat([
    Buffer.from(discriminator),
    ...fields.map((field) => Buffer.from(field)),
  ]).toString('base64');
}

function u16(value: number): Uint8Array {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value, true);
  return result;
}

function u32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}

function u64(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value, true);
  return result;
}

function publicKeyVector(values: readonly string[]): Uint8Array {
  return Buffer.concat([Buffer.from(u32(values.length)), ...values.map((value) => pubkey(value))]);
}

function pubkey(value: string): Uint8Array {
  return bs58.decode(value);
}

function signature(seed: number): string {
  return bs58.encode(bytes(64, seed));
}

function publicKey(seed: number): string {
  return bs58.encode(bytes(32, seed));
}

function bytes(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (seed + index) % 256);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

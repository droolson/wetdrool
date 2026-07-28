import {
  createPairwiseDevice,
  type CurrentDeviceAuthorization,
  type CurrentDeviceAuthorizationResolver,
  type KeyDirectoryOperation,
  type LocalDeviceKeyBinding,
  type OpaqueKeyDirectoryRequest,
  type OpaqueKeyDirectoryResponse,
  type PairwiseMessagingDevice,
  type SocialDeviceAddress,
  type UntrustedKeyDirectoryTransport,
} from '../src/index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid test-directory payload.');
  }
  return value as JsonRecord;
}

function addressKey(address: SocialDeviceAddress): string {
  return `${address.identityId.length}:${address.identityId}${address.deviceId.length}:${address.deviceId}`;
}

function engineDeviceKey(userId: string, deviceId: string): string {
  return `${userId}\u0000${deviceId}`;
}

export interface DirectoryTranscriptEntry {
  readonly operation: KeyDirectoryOperation;
  readonly body: string;
}

interface ConnectionOwner {
  readonly userId: string;
  readonly deviceId: string;
}

export class TestKeyDirectory {
  readonly transcript: DirectoryTranscriptEntry[] = [];
  readonly #devices = new Map<string, Map<string, JsonRecord>>();
  readonly #oneTimeKeys = new Map<string, Map<string, unknown>>();
  readonly #fallbackKeys = new Map<string, Map<string, unknown>>();

  createConnection(): UntrustedKeyDirectoryTransport {
    let owner: ConnectionOwner | undefined;
    return {
      exchange: async (request: OpaqueKeyDirectoryRequest): Promise<OpaqueKeyDirectoryResponse> => {
        const bodyText = decoder.decode(request.opaqueBody);
        const body = record(JSON.parse(bodyText) as unknown);
        this.transcript.push({ operation: request.operation, body: bodyText });

        let response: JsonRecord;
        if (request.operation === 'keys-upload') {
          const result = this.#upload(body, owner);
          owner = result.owner;
          response = result.response;
        } else if (request.operation === 'keys-query') {
          response = this.#query(body);
        } else {
          response = this.#claim(body);
        }
        return {
          version: 1,
          opaqueBody: encoder.encode(JSON.stringify(response)),
        };
      },
    };
  }

  #upload(
    body: JsonRecord,
    connectionOwner: ConnectionOwner | undefined,
  ): { readonly owner: ConnectionOwner; readonly response: JsonRecord } {
    const deviceKeys = body.device_keys === undefined ? undefined : record(body.device_keys);
    let owner = connectionOwner;
    if (deviceKeys !== undefined) {
      if (typeof deviceKeys.user_id !== 'string' || typeof deviceKeys.device_id !== 'string') {
        throw new Error('Invalid device key publication.');
      }
      owner = {
        userId: deviceKeys.user_id,
        deviceId: deviceKeys.device_id,
      };
      const userDevices = this.#devices.get(owner.userId) ?? new Map();
      userDevices.set(owner.deviceId, structuredClone(deviceKeys));
      this.#devices.set(owner.userId, userDevices);
    }
    if (owner === undefined) {
      throw new Error('Upload connection has no device owner.');
    }

    const key = engineDeviceKey(owner.userId, owner.deviceId);
    const oneTimeKeys = this.#oneTimeKeys.get(key) ?? new Map();
    const uploadedOneTimeKeys = body.one_time_keys === undefined ? {} : record(body.one_time_keys);
    for (const [keyId, value] of Object.entries(uploadedOneTimeKeys)) {
      oneTimeKeys.set(keyId, structuredClone(value));
    }
    this.#oneTimeKeys.set(key, oneTimeKeys);

    const fallbackKeys = this.#fallbackKeys.get(key) ?? new Map();
    const uploadedFallbackKeys = body.fallback_keys === undefined ? {} : record(body.fallback_keys);
    for (const [keyId, value] of Object.entries(uploadedFallbackKeys)) {
      fallbackKeys.set(keyId, structuredClone(value));
    }
    this.#fallbackKeys.set(key, fallbackKeys);

    return {
      owner,
      response: {
        one_time_key_counts: {
          signed_curve25519: oneTimeKeys.size,
        },
      },
    };
  }

  #query(body: JsonRecord): JsonRecord {
    const requestedUsers = record(body.device_keys);
    const response: Record<string, Record<string, JsonRecord>> = {};
    for (const [userId, rawRequestedDeviceIds] of Object.entries(requestedUsers)) {
      if (!Array.isArray(rawRequestedDeviceIds)) {
        throw new Error('Invalid key query.');
      }
      const available = this.#devices.get(userId);
      const requestedDeviceIds =
        rawRequestedDeviceIds.length === 0 ? [...(available?.keys() ?? [])] : rawRequestedDeviceIds;
      const userResponse: Record<string, JsonRecord> = {};
      for (const rawDeviceId of requestedDeviceIds) {
        if (typeof rawDeviceId !== 'string') {
          throw new Error('Invalid key query device.');
        }
        const device = available?.get(rawDeviceId);
        if (device !== undefined) {
          userResponse[rawDeviceId] = structuredClone(device);
        }
      }
      response[userId] = userResponse;
    }
    return { device_keys: response, failures: {} };
  }

  #claim(body: JsonRecord): JsonRecord {
    const requestedUsers = record(body.one_time_keys);
    const response: Record<string, Record<string, Record<string, unknown>>> = {};
    for (const [userId, rawDevices] of Object.entries(requestedUsers)) {
      const devices = record(rawDevices);
      const userResponse: Record<string, Record<string, unknown>> = {};
      for (const deviceId of Object.keys(devices)) {
        const key = engineDeviceKey(userId, deviceId);
        const oneTimeKeys = this.#oneTimeKeys.get(key);
        const oneTimeKeyId = [...(oneTimeKeys?.keys() ?? [])][0];
        if (oneTimeKeyId !== undefined && oneTimeKeys !== undefined) {
          userResponse[deviceId] = {
            [oneTimeKeyId]: structuredClone(oneTimeKeys.get(oneTimeKeyId)),
          };
          oneTimeKeys.delete(oneTimeKeyId);
          continue;
        }

        const fallbackKeys = this.#fallbackKeys.get(key);
        const fallbackKeyId = [...(fallbackKeys?.keys() ?? [])][0];
        userResponse[deviceId] =
          fallbackKeyId === undefined || fallbackKeys === undefined
            ? {}
            : {
                [fallbackKeyId]: structuredClone(fallbackKeys.get(fallbackKeyId)),
              };
      }
      response[userId] = userResponse;
    }
    return { one_time_keys: response, failures: {} };
  }
}

export class TestAuthorizationResolver implements CurrentDeviceAuthorizationResolver {
  readonly #assertions = new Map<string, CurrentDeviceAuthorization>();

  authorize(
    binding: LocalDeviceKeyBinding,
    options: {
      readonly assertionId?: string;
      readonly revision?: number;
      readonly lifetimeMs?: number;
    } = {},
  ): CurrentDeviceAuthorization {
    const now = Date.now();
    const assertion: CurrentDeviceAuthorization = {
      ...binding,
      status: 'active',
      assertionId: options.assertionId ?? `assertion-${binding.deviceId}`,
      revision: options.revision ?? 1,
      issuedAtEpochMs: now - 1000,
      expiresAtEpochMs: now + (options.lifetimeMs ?? 60 * 60 * 1000),
    };
    this.#assertions.set(addressKey(binding), assertion);
    return assertion;
  }

  setAssertion(assertion: CurrentDeviceAuthorization): void {
    this.#assertions.set(addressKey(assertion), structuredClone(assertion));
  }

  revoke(address: SocialDeviceAddress): void {
    this.#assertions.delete(addressKey(address));
  }

  async getCurrentDeviceAuthorization(
    address: SocialDeviceAddress,
  ): Promise<CurrentDeviceAuthorization | null> {
    return structuredClone(this.#assertions.get(addressKey(address)) ?? null);
  }
}

export async function createTestDevice(
  localDevice: SocialDeviceAddress,
  directory: TestKeyDirectory,
  authorizationResolver: TestAuthorizationResolver,
): Promise<PairwiseMessagingDevice> {
  return createPairwiseDevice({
    localDevice,
    authorizationResolver,
    keyDirectory: directory.createConnection(),
    storage: {
      kind: 'memory',
      usage: 'test-or-development',
      acknowledgeVolatileKeyLoss: true,
    },
    runtimeEnvironment: 'test',
  });
}

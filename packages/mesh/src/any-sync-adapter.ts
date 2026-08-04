/**
 * Fail-closed adapter interfaces modeled after any-sync capabilities.
 *
 * Upstream: https://github.com/anyproto/any-sync
 * Client heart: https://github.com/anyproto/anytype-heart
 *
 * Implementations must not treat DroolNet / Solana as the mesh transport.
 * Solana remains identity/settlement; mesh is the content/sync plane.
 */

import type { MeshEnvelope, MeshObjectId, PeerId, SpaceId } from './types.js';

export interface BoundedMeshContext {
  readonly signal: AbortSignal;
  readonly deadlineEpochMs: number;
}

/**
 * Untrusted peer or node transport. Ciphertext only; directory is not authority.
 */
export interface MeshTransport {
  readonly kind: 'any-sync-node' | 'webrtc-datachannel' | 'quic' | 'relay-bootstrap';
  publish(envelope: MeshEnvelope, context: BoundedMeshContext): Promise<void>;
  pull(
    spaceId: SpaceId,
    sinceObjectId: MeshObjectId | null,
    context: BoundedMeshContext,
  ): Promise<readonly MeshEnvelope[]>;
}

/** Local-first space store (IndexedDB / filesystem / anytype-heart bindings later). */
export interface SpaceStore {
  open(spaceId: SpaceId): Promise<void>;
  put(envelope: MeshEnvelope): Promise<void>;
  get(spaceId: SpaceId, objectId: MeshObjectId): Promise<MeshEnvelope | null>;
  list(spaceId: SpaceId, limit: number): Promise<readonly MeshEnvelope[]>;
  close(): Promise<void>;
}

export interface PeerDiscovery {
  announce(local: PeerId, spaces: readonly SpaceId[]): Promise<void>;
  findPeers(spaceId: SpaceId, context: BoundedMeshContext): Promise<readonly PeerId[]>;
}

export class MeshNotConfiguredError extends Error {
  readonly code = 'mesh_not_configured' as const;
  constructor(message = 'Mesh transport is not configured. Local-only mode only.') {
    super(message);
    this.name = 'MeshNotConfiguredError';
  }
}

/** Fail-closed stub transport — never claims remote sync. */
export class UnconfiguredMeshTransport implements MeshTransport {
  readonly kind = 'relay-bootstrap' as const;

  publish(): Promise<void> {
    return Promise.reject(new MeshNotConfiguredError());
  }

  pull(): Promise<readonly MeshEnvelope[]> {
    return Promise.reject(new MeshNotConfiguredError());
  }
}

/** In-memory space store for tests and offline demos. */
export class MemorySpaceStore implements SpaceStore {
  private readonly spaces = new Map<string, Map<string, MeshEnvelope>>();

  async open(spaceId: SpaceId): Promise<void> {
    if (!this.spaces.has(spaceId)) {
      this.spaces.set(spaceId, new Map());
    }
  }

  async put(envelope: MeshEnvelope): Promise<void> {
    let bucket = this.spaces.get(envelope.spaceId);
    if (!bucket) {
      bucket = new Map();
      this.spaces.set(envelope.spaceId, bucket);
    }
    bucket.set(envelope.objectId, envelope);
  }

  async get(spaceId: SpaceId, objectId: MeshObjectId): Promise<MeshEnvelope | null> {
    return this.spaces.get(spaceId)?.get(objectId) ?? null;
  }

  async list(spaceId: SpaceId, limit: number): Promise<readonly MeshEnvelope[]> {
    const bucket = this.spaces.get(spaceId);
    if (!bucket) return [];
    const safeLimit = Math.max(0, Math.min(limit, 500));
    return [...bucket.values()].slice(0, safeLimit);
  }

  async close(): Promise<void> {
    this.spaces.clear();
  }
}

/**
 * Mesh plane types for WetDrool.
 *
 * Research foundation: Anytype / any-sync (https://github.com/anyproto/any-sync)
 * — local-first, peer-to-peer, E2EE collaborative spaces.
 *
 * This package defines WetDrool-facing contracts only. It does not re-implement
 * any-sync wire codecs or vendor anytype-heart.
 */

/** Opaque space identifier (any-sync "space" analogue). */
export type SpaceId = string & { readonly __brand: 'SpaceId' };

/** Opaque peer identifier for mesh discovery. */
export type PeerId = string & { readonly __brand: 'PeerId' };

/** Content-addressed object id within a space (CID or any-sync object id). */
export type MeshObjectId = string & { readonly __brand: 'MeshObjectId' };

export type MeshTransportKind =
  | 'local-only'
  | 'any-sync-node'
  | 'webrtc-datachannel'
  | 'quic'
  | 'relay-bootstrap';

export interface MeshEnvelope {
  readonly version: 1;
  readonly spaceId: SpaceId;
  readonly objectId: MeshObjectId;
  readonly ciphertext: Uint8Array;
  readonly contentType: 'application/wetdrool-mesh+json';
  /** Outer authenticity; never server-readable payload key material. */
  readonly senderPeerId: PeerId;
}

export interface MeshCapabilityReport {
  readonly foundation: 'anyproto/any-sync';
  readonly upstream: {
    readonly anySync: 'https://github.com/anyproto/any-sync';
    readonly anytypeHeart: 'https://github.com/anyproto/anytype-heart';
    readonly anytypeTs: 'https://github.com/anyproto/anytype-ts';
  };
  readonly localFirst: true;
  readonly e2eeSpaces: true;
  readonly productionMeshDeployed: false;
  readonly transports: readonly MeshTransportKind[];
  readonly notes: readonly string[];
}

export function asSpaceId(value: string): SpaceId {
  if (value.trim() === '' || value.length > 256) {
    throw new Error('invalid SpaceId');
  }
  return value as SpaceId;
}

export function asPeerId(value: string): PeerId {
  if (value.trim() === '' || value.length > 256) {
    throw new Error('invalid PeerId');
  }
  return value as PeerId;
}

export function asMeshObjectId(value: string): MeshObjectId {
  if (value.trim() === '' || value.length > 512) {
    throw new Error('invalid MeshObjectId');
  }
  return value as MeshObjectId;
}

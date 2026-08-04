export type {
  MeshCapabilityReport,
  MeshEnvelope,
  MeshObjectId,
  MeshTransportKind,
  PeerId,
  SpaceId,
} from './types.js';
export { asMeshObjectId, asPeerId, asSpaceId } from './types.js';
export type {
  BoundedMeshContext,
  MeshTransport,
  PeerDiscovery,
  SpaceStore,
} from './any-sync-adapter.js';
export {
  MemorySpaceStore,
  MeshNotConfiguredError,
  UnconfiguredMeshTransport,
} from './any-sync-adapter.js';
export { getMeshCapabilityReport } from './status.js';

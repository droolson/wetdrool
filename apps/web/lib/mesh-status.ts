/**
 * Web-facing mesh capability status (ADR-0014).
 *
 * Re-exports the honest report from `@wetdrool/mesh`. Production P2P is not
 * deployed; UI must not claim a live mesh.
 */

export {
  getMeshCapabilityReport,
  type MeshCapabilityReport,
  type MeshDeploymentStatus,
  type MeshSurfaceStatus,
} from '@wetdrool/mesh';

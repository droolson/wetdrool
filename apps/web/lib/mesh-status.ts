/**
 * Web-facing mesh capability status (ADR-0014).
 * Prefer @wetdrool/mesh when built; fall back to inline honest report so web
 * typecheck does not require a prior package build in every environment.
 */

export interface MeshCapabilityReport {
  readonly foundation: 'anyproto/any-sync';
  readonly productionMeshDeployed: false;
  readonly localFirst: true;
  readonly e2eeSpaces: true;
  readonly transports: readonly ['local-only'];
  readonly notes: readonly string[];
}

export function getMeshCapabilityReport(): MeshCapabilityReport {
  return {
    foundation: 'anyproto/any-sync',
    productionMeshDeployed: false,
    localFirst: true,
    e2eeSpaces: true,
    transports: ['local-only'],
    notes: [
      'any-sync is the research foundation; production mesh is not deployed.',
      'Cloudflare/Vercel are HTTP bootstrap only.',
    ],
  };
}

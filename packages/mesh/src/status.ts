import type { MeshCapabilityReport } from './types.js';

/**
 * Honest mesh capability report for operators and the web /mesh surface.
 */
export function getMeshCapabilityReport(): MeshCapabilityReport {
  return {
    foundation: 'anyproto/any-sync',
    upstream: {
      anySync: 'https://github.com/anyproto/any-sync',
      anytypeHeart: 'https://github.com/anyproto/anytype-heart',
      anytypeTs: 'https://github.com/anyproto/anytype-ts',
    },
    localFirst: true,
    e2eeSpaces: true,
    productionMeshDeployed: false,
    transports: ['local-only'],
    notes: [
      'WetDrool mesh contracts mirror any-sync: local-first E2EE spaces, optional self-hosted nodes, replaceable carriers.',
      'anytype-heart is not vendored; bind via explicit adapter after license and binary review.',
      'Cloudflare Worker + Vercel host only the bootstrap web shell — not peer mesh state.',
      'DroolNet on Solana remains identity/settlement; mesh never writes private adult media to chain.',
      '18+ self-attest and CSAM prohibitions apply to mesh-published objects the same as hosted surfaces.',
    ],
  };
}

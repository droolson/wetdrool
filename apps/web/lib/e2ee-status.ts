/**
 * Honest E2EE readiness for the web client.
 *
 * Real cryptography lives in `@wetdrool/messaging` (pairwise Matrix Rust crypto
 * WASM adapter, ADR-0007). The web app does not claim production E2EE until
 * that package is browser-packaged, persistent storage is reviewed, and a
 * relay/key-directory is configured.
 */

export const PAIRWISE_PROTOCOL = 'wetdrool.com.messaging.pairwise.v1' as const;

export type E2eeSurfaceStatus =
  | 'implemented_package'
  | 'web_not_wired'
  | 'group_disabled'
  | 'relay_locked';

export interface E2eeCapabilityReport {
  readonly protocol: typeof PAIRWISE_PROTOCOL;
  readonly pairwise: E2eeSurfaceStatus;
  readonly groupRooms: E2eeSurfaceStatus;
  readonly serverReadableFallback: false;
  readonly privateByDefault: true;
  readonly details: readonly string[];
}

export function getE2eeCapabilityReport(): E2eeCapabilityReport {
  return {
    protocol: PAIRWISE_PROTOCOL,
    pairwise: 'web_not_wired',
    groupRooms: 'group_disabled',
    serverReadableFallback: false,
    privateByDefault: true,
    details: [
      'Pairwise Olm adapter exists in @wetdrool/messaging with authenticated envelopes and fail-closed auth checks.',
      'Web UI is not yet wired to a browser-safe device store or key directory — messages page stays locked, no fake inbox.',
      'Group/room encryption is intentionally disabled in the adapter.',
      'Private means ciphertext outside authorized devices; there is no plaintext server fallback path in the design.',
      'Volatile memory storage is the only implemented mode today; production multi-device recovery is not claimed.',
    ],
  };
}

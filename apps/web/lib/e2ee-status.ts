/**
 * Honest E2EE readiness for the web client.
 *
 * Two separate surfaces:
 * 1) Pairwise DMs — `@wetdrool/messaging` (Matrix Rust crypto WASM, ADR-0007).
 *    Not browser-wired yet; no fake inbox.
 * 2) Anon rooms — client-side AES-GCM room passphrase + middle-out seal
 *    (`e2ee-seal.ts`). Ciphertext-only store; not identity-bound multi-device E2EE.
 */

export const PAIRWISE_PROTOCOL = 'wetdrool.com.messaging.pairwise.v1' as const;
export const ROOM_SEAL_PROTOCOL = 'wetdrool.e2ee.middle-out.v1' as const;

export type E2eeSurfaceStatus =
  | 'implemented_package'
  | 'web_not_wired'
  | 'group_disabled'
  | 'relay_locked'
  | 'passphrase_rooms_alpha';

export interface E2eeCapabilityReport {
  readonly protocol: typeof PAIRWISE_PROTOCOL;
  readonly pairwise: E2eeSurfaceStatus;
  readonly groupRooms: E2eeSurfaceStatus;
  /** Shared-passphrase rooms (not pairwise Olm). Alpha / local store honesty applies. */
  readonly passphraseRooms: E2eeSurfaceStatus;
  readonly roomSealProtocol: typeof ROOM_SEAL_PROTOCOL;
  readonly serverReadableFallback: false;
  readonly privateByDefault: true;
  readonly details: readonly string[];
}

export function getE2eeCapabilityReport(): E2eeCapabilityReport {
  return {
    protocol: PAIRWISE_PROTOCOL,
    pairwise: 'web_not_wired',
    groupRooms: 'group_disabled',
    passphraseRooms: 'passphrase_rooms_alpha',
    roomSealProtocol: ROOM_SEAL_PROTOCOL,
    serverReadableFallback: false,
    privateByDefault: true,
    details: [
      'Pairwise Olm adapter exists in @wetdrool/messaging with authenticated envelopes and fail-closed auth checks.',
      'Web UI is not yet wired to a browser-safe device store or key directory — messages page stays locked, no fake inbox.',
      'Group/room encryption is intentionally disabled in the Matrix-style adapter (not the same as passphrase rooms).',
      'Anon passphrase rooms seal in-browser (AES-256-GCM + middle-out-lite). Server stores ciphertext only; shared key is the security boundary.',
      'Room ciphertext store is memory-ephemeral by default (or optional single-node file). Not multi-replica; not production multi-device recovery.',
      'Private means ciphertext outside holders of the room key; there is no plaintext server fallback path in the design.',
    ],
  };
}

import type { OnchainKeyAuthorizer } from './manifest-verifier.js';
import type { ProjectionStore } from './projection.js';

/**
 * Authorizes a root or scoped delegation at the event's finalized slot. The
 * projection keeps root-rotation history, so replaying an older manifest does
 * not accidentally evaluate it against today's root key.
 */
export class ProjectionRootKeyAuthorizer implements OnchainKeyAuthorizer {
  constructor(private readonly projection: ProjectionStore) {}

  async authorize(input: {
    readonly authorIdentityId: string;
    readonly keyId: string;
    readonly objectType: string;
    readonly slot: bigint;
    readonly transactionIndex?: number;
    readonly transactionSignature: string;
    readonly logIndex: number;
  }): Promise<boolean> {
    const prefix = `${input.authorIdentityId}#`;
    if (!input.keyId.startsWith(prefix)) {
      return false;
    }
    const match = /^(root|delegation)\/([1-9A-HJ-NP-Za-km-z]+)$/u.exec(
      input.keyId.slice(prefix.length),
    );
    if (match?.[1] === undefined || match[2] === undefined) {
      return false;
    }

    return this.projection.authorizeSigningKey({
      identityId: input.authorIdentityId,
      kind: match[1] as 'root' | 'delegation',
      authority: match[2],
      objectType: input.objectType,
      slot: input.slot,
      ...(input.transactionIndex === undefined ? {} : { transactionIndex: input.transactionIndex }),
      transactionSignature: input.transactionSignature,
      logIndex: input.logIndex,
    });
  }
}

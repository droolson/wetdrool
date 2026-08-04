import { canonicalize } from 'json-canonicalize';
import { z } from 'zod';

import { digestSha256, encodeMultibaseBase64Url, utf8 } from './encoding.js';
import { assertCanonicalInput, ProtocolValidationError } from './validation.js';

export const COMMUNITY_GOVERNANCE_STRATEGY_DOMAIN =
  'droolnet:community-governance-strategy:v1' as const;

export const WOKENET_ONE_MEMBER_ONE_VOTE_V1 = {
  model: 'one-active-member-one-vote',
  version: 1,
  quorumBasisPoints: 5_000,
  approvalBasisPoints: 5_001,
  abstainTreatment: 'quorum-only',
  execution: 'outcome-record-only',
} as const;

export const communityGovernanceStrategySchema = z
  .object({
    model: z.literal(WOKENET_ONE_MEMBER_ONE_VOTE_V1.model),
    version: z.literal(WOKENET_ONE_MEMBER_ONE_VOTE_V1.version),
    quorumBasisPoints: z.literal(WOKENET_ONE_MEMBER_ONE_VOTE_V1.quorumBasisPoints),
    approvalBasisPoints: z.literal(WOKENET_ONE_MEMBER_ONE_VOTE_V1.approvalBasisPoints),
    abstainTreatment: z.literal(WOKENET_ONE_MEMBER_ONE_VOTE_V1.abstainTreatment),
    execution: z.literal(WOKENET_ONE_MEMBER_ONE_VOTE_V1.execution),
  })
  .strict();

export type CommunityGovernanceStrategy = z.infer<typeof communityGovernanceStrategySchema>;

export interface CommunityGovernanceStrategySource {
  readonly governance: CommunityGovernanceStrategy;
}

export interface CommunityGovernanceStrategyCommitment {
  readonly governanceVersion: number;
  /** Multibase base64url encoding of the same 32 bytes returned in `bytes`. */
  readonly digest: string;
  /** Raw SHA-256 digest for the Anchor `[u8; 32]` governance strategy argument. */
  readonly bytes: Uint8Array;
}

/**
 * Commits the exact portable governance semantics accepted by the current
 * onchain program. The NUL separator prevents domain/payload ambiguity.
 */
export function communityGovernanceStrategyCommitment(
  content: CommunityGovernanceStrategySource,
): CommunityGovernanceStrategyCommitment {
  const governance = communityGovernanceStrategySchema.parse(content.governance);
  assertCanonicalInput(governance);
  const canonical = canonicalize(governance);
  if (canonical === undefined) {
    throw new ProtocolValidationError('Community governance cannot be canonicalized.');
  }

  const domain = utf8(COMMUNITY_GOVERNANCE_STRATEGY_DOMAIN);
  const body = utf8(canonical);
  const preimage = new Uint8Array(domain.byteLength + 1 + body.byteLength);
  preimage.set(domain);
  preimage[domain.byteLength] = 0;
  preimage.set(body, domain.byteLength + 1);
  const bytes = digestSha256(preimage);

  return {
    governanceVersion: governance.version,
    digest: encodeMultibaseBase64Url(bytes),
    bytes,
  };
}

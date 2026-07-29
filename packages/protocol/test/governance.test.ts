import { describe, expect, it } from 'vitest';

import {
  COMMUNITY_GOVERNANCE_STRATEGY_DOMAIN,
  COMMUNITY_SCHEMA_VERSION,
  communityGovernanceStrategyCommitment,
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
} from '../src/index.js';

describe('community governance commitment', () => {
  it('is domain-separated, deterministic, and Anchor-compatible', () => {
    const commitment = communityGovernanceStrategyCommitment({
      governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
    });

    expect(COMMUNITY_SCHEMA_VERSION).toBe(2);
    expect(COMMUNITY_GOVERNANCE_STRATEGY_DOMAIN).toBe('wokenet:community-governance-strategy:v1');
    expect(commitment).toEqual({
      governanceVersion: 1,
      digest: 'uneRbAxLESnjaTD1GsoKoiIrsZg1CJCoNdhODS5Q1dXE',
      bytes: Uint8Array.from([
        157, 228, 91, 3, 18, 196, 74, 120, 218, 76, 61, 70, 178, 130, 168, 136, 138, 236, 102, 13,
        66, 36, 42, 13, 118, 19, 131, 75, 148, 53, 117, 113,
      ]),
    });
  });

  it('refuses semantic drift instead of hashing an unsupported strategy', () => {
    expect(() =>
      communityGovernanceStrategyCommitment({
        governance: {
          ...WOKENET_ONE_MEMBER_ONE_VOTE_V1,
          quorumBasisPoints: 4_999,
        } as unknown as typeof WOKENET_ONE_MEMBER_ONE_VOTE_V1,
      }),
    ).toThrow();
  });
});

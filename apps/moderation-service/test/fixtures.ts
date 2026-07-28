import {
  buildAppealPayload,
  buildModerationLabelPayload,
  buildReportPayload,
  signPayload,
  type ModerationSubject,
  type ObjectReference,
  type SignedEnvelope,
} from '@wokesocial/protocol';
import {
  createProtocolFixtureSet,
  FIXTURE_CREATED_AT,
  type FixtureParticipant,
} from '@wokesocial/test-fixtures';

const fixtures = createProtocolFixtureSet();
export const alice = fixtures.participants.alice;
export const bob = fixtures.participants.bob;
export const postReference: ObjectReference = { id: fixtures.manifests.alicePost.objectId };
export const alternatePostReference: ObjectReference = {
  id: `wokesocialobj:v1:post:u${'B'.repeat(43)}`,
};
export const policyReference: ObjectReference = {
  id: `wokesocialobj:v1:community-rule-set:u${'C'.repeat(43)}`,
};
export const postSubject: ModerationSubject = {
  kind: 'object',
  object: postReference,
};
export const alternatePostSubject: ModerationSubject = {
  kind: 'object',
  object: alternatePostReference,
};
export const serviceNow = new Date('2026-07-29T12:00:00.000Z');

let nonceSeed = 100;

export function makeLabel(
  input: {
    readonly subject?: ModerationSubject;
    readonly supersedes?: ObjectReference;
    readonly expiresAt?: string;
    readonly author?: FixtureParticipant;
  } = {},
): SignedEnvelope {
  const author = input.author ?? alice;
  return signPayload(
    buildModerationLabelPayload(
      author.identity,
      {
        subject: input.subject ?? postSubject,
        code: 'provider.harassment-review',
        severity: 'warning',
        recommendation: 'blur',
        rationale: 'A signed provider assertion for deterministic tests.',
        policy: policyReference,
        source: 'human',
        ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      },
      options(),
    ),
    author.privateKey,
  );
}

export function makeReport(
  input: {
    readonly summary?: string;
  } = {},
): SignedEnvelope {
  return signPayload(
    buildReportPayload(
      bob.identity,
      {
        subject: postSubject,
        category: 'harassment',
        summary: input.summary ?? 'Please review a pattern of targeted harassment.',
        evidence: [],
        preserveEvidence: false,
        requestedOutcome: 'review',
        confidentiality: 'restricted',
      },
      options(),
    ),
    bob.privateKey,
  );
}

export function makeAppeal(decision: ObjectReference): SignedEnvelope {
  return signPayload(
    buildAppealPayload(
      alice.identity,
      {
        decision,
        statement: 'The decision appears to apply the wrong policy context.',
        evidence: [],
        requestedOutcome: decision.id.split(':')[2] === 'report' ? 'reconsider' : 'remove-label',
        confidentiality: 'restricted',
      },
      options(),
    ),
    alice.privateKey,
  );
}

export function knownKeyAuthorizer(context: {
  readonly author: string;
  readonly keyId: string;
}): boolean {
  return (
    (context.author === alice.author && context.keyId === alice.identity.signingKey) ||
    (context.author === bob.author && context.keyId === bob.identity.signingKey)
  );
}

function options() {
  const seed = nonceSeed++;
  return {
    createdAt: new Date(FIXTURE_CREATED_AT),
    nonce: Uint8Array.from({ length: 16 }, (_, index) => (seed + index * 17) & 0xff),
  };
}

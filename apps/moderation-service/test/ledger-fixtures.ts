import type { ActionInput, OperatorAssertion } from '../src/models.js';
import { policyReference, postSubject } from './fixtures.js';

export function operator(
  actorId = 'operator:moderator-one',
  permissions: OperatorAssertion['permissions'] = [
    'case.read',
    'case.triage',
    'case.review',
    'case.act',
    'case.emergency',
    'appeal.review',
    'emergency.review',
    'case.audit',
    'case.legal-hold',
  ],
): OperatorAssertion {
  return {
    actorId,
    assertionId: `assertion:${actorId.replaceAll(':', '-')}`,
    permissions,
    expiresAt: '2030-01-01T00:00:00.000Z',
  };
}

export function actionInput(
  expectedVersion: number,
  input: Partial<ActionInput> = {},
): ActionInput {
  return {
    expectedVersion,
    kind: 'temporary-restriction',
    target: postSubject,
    scope: 'operator',
    policyId: policyReference.id,
    policyVersion: 1,
    ruleId: 'targeted-harassment',
    reasonCategory: 'harassment',
    moderatorNote: 'The bounded action cites supporting and exculpatory context.',
    consequences: ['restrict-posting'],
    effectiveAt: '2026-07-29T12:00:00.000Z',
    expiresAt: '2026-07-30T12:00:00.000Z',
    appealEligible: true,
    appealDeadline: '2026-08-05T12:00:00.000Z',
    ...input,
  };
}

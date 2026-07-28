import { getObjectId } from '@socially-woke/protocol';
import { describe, expect, it } from 'vitest';

import { ModerationServiceError } from '../src/errors.js';
import { ModerationService } from '../src/service.js';
import {
  alternatePostSubject,
  bob,
  knownKeyAuthorizer,
  makeAppeal,
  makeLabel,
  makeReport,
  postSubject,
  serviceNow,
} from './fixtures.js';

function verifiedService() {
  return new ModerationService({
    authorizeObject: knownKeyAuthorizer,
    now: () => serviceNow,
  });
}

describe('moderation object service', () => {
  it('starts locked without an identity/delegation authorizer', async () => {
    const service = new ModerationService();
    expect(service.ready).toBe(false);
    expect(service.authorizationMode).toBe('locked');
    await expect(service.ingestLabel(makeLabel())).rejects.toMatchObject({
      code: 'locked',
    });
  });

  it('accepts and returns an authorized signed label as an advisory assertion', async () => {
    const service = verifiedService();
    const envelope = makeLabel();
    const receipt = await service.ingestLabel(envelope);

    expect(receipt).toMatchObject({
      advisory: true,
      canonical: false,
      duplicate: false,
      objectId: getObjectId(envelope.payload),
      objectType: 'moderation-label',
    });
    const labels = await service.activeLabels(postSubject);
    expect(labels).toHaveLength(1);
    expect(labels[0]?.envelope).toEqual(envelope);
  });

  it('is idempotent for exact duplicate canonical objects', async () => {
    const service = verifiedService();
    const envelope = makeLabel();
    expect((await service.ingestLabel(envelope)).duplicate).toBe(false);
    expect((await service.ingestLabel(envelope)).duplicate).toBe(true);
    expect(await service.activeLabels(postSubject)).toHaveLength(1);
  });

  it('rejects a changed payload under the original signature', async () => {
    const service = verifiedService();
    const tampered = structuredClone(makeLabel());
    if (tampered.payload.type !== 'moderation-label') {
      throw new Error('Unexpected test fixture type.');
    }
    tampered.payload.content.rationale = 'Tampered rationale';

    await expect(service.ingestLabel(tampered)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('fails closed when current key authorization denies the object', async () => {
    const service = new ModerationService({
      authorizeObject: () => false,
      now: () => serviceNow,
    });
    await expect(service.ingestReport(makeReport())).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('suppresses superseded and expired labels without deleting their signed history', async () => {
    const service = verifiedService();
    const first = makeLabel();
    const firstReceipt = await service.ingestLabel(first);
    const replacement = makeLabel({
      supersedes: { id: firstReceipt.objectId },
      expiresAt: '2026-08-01T12:00:00.000Z',
    });
    await service.ingestLabel(replacement);

    const active = await service.activeLabels(postSubject);
    expect(active.map(({ objectId }) => objectId)).toEqual([getObjectId(replacement.payload)]);
    expect(await service.store.get(firstReceipt.objectId)).toBeDefined();

    const afterExpiry = new ModerationService({
      store: service.store,
      authorizeObject: knownKeyAuthorizer,
      now: () => new Date('2026-08-02T12:00:00.000Z'),
    });
    expect(await afterExpiry.activeLabels(postSubject)).toHaveLength(0);
  });

  it('rejects a replacement label that changes the moderated subject', async () => {
    const service = verifiedService();
    const first = await service.ingestLabel(makeLabel());
    await expect(
      service.ingestLabel(
        makeLabel({
          subject: alternatePostSubject,
          supersedes: { id: first.objectId },
        }),
      ),
    ).rejects.toMatchObject({ code: 'label-subject-mismatch' });
  });

  it('does not let one moderation provider supersede another provider’s label', async () => {
    const service = verifiedService();
    const first = await service.ingestLabel(makeLabel());
    await expect(
      service.ingestLabel(
        makeLabel({
          author: bob,
          supersedes: { id: first.objectId },
        }),
      ),
    ).rejects.toMatchObject({ code: 'label-provider-mismatch' });
  });

  it('keeps restricted reports and their signed appeals in an explicit case', async () => {
    const service = verifiedService();
    const report = makeReport();
    const reportReceipt = await service.ingestReport(report);
    const appeal = makeAppeal({ id: reportReceipt.objectId });
    await service.ingestAppeal(appeal);

    const moderationCase = await service.readCase(reportReceipt.objectId);
    expect(moderationCase?.report.envelope).toEqual(report);
    expect(moderationCase?.appeals.map(({ envelope }) => envelope)).toEqual([appeal]);
  });

  it('rejects appeals for decisions not present in this provider store', async () => {
    const service = verifiedService();
    await expect(
      service.ingestAppeal(makeAppeal({ id: `swobj:v1:report:u${'D'.repeat(43)}` })),
    ).rejects.toBeInstanceOf(ModerationServiceError);
    await expect(
      service.ingestAppeal(makeAppeal({ id: `swobj:v1:report:u${'E'.repeat(43)}` })),
    ).rejects.toMatchObject({ code: 'appeal-decision-not-found' });
  });

  it('rejects a valid signed object sent to the wrong intake boundary', async () => {
    const service = verifiedService();
    await expect(service.ingestLabel(makeReport())).rejects.toMatchObject({
      code: 'invalid-object',
    });
  });
});

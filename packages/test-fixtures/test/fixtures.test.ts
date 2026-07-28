import {
  getEnvelopeCid,
  identityIdSchema,
  networkIdSchema,
  verifyEnvelope,
} from '@socially-woke/protocol';
import { describe, expect, it } from 'vitest';

import { createProtocolFixtureSet, TEST_FIXTURE_WARNING } from '../src/index.js';

describe('canonical protocol fixtures', () => {
  it('reproduces every key, envelope byte, and object identifier', () => {
    const first = createProtocolFixtureSet();
    const second = createProtocolFixtureSet();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.warning).toBe(TEST_FIXTURE_WARNING);
    expect(first.participants.alice.privateKey).not.toBe(second.participants.alice.privateKey);
    expect(networkIdSchema.parse(first.network)).toBe(first.network);
    expect(first.network.startsWith('woke:v1:')).toBe(true);
    for (const participant of Object.values(first.participants)) {
      expect(identityIdSchema.parse(participant.author)).toBe(participant.author);
      expect(participant.author.startsWith(`swid:v1:${first.network}:`)).toBe(true);
    }

    first.participants.alice.privateKey[0] = 255;
    expect(second.participants.alice.privateKey[0]).toBe(1);
  });

  it('produces canonical envelopes accepted by the real signature verifier', async () => {
    const fixtures = createProtocolFixtureSet();
    const manifests = Object.values(fixtures.manifests);

    for (const manifest of manifests) {
      const verified = await verifyEnvelope(manifest.canonicalBytes, () => true);
      expect(verified.envelope).toEqual(manifest.envelope);
      expect(verified.objectId).toBe(manifest.objectId);
      await expect(getEnvelopeCid(manifest.envelope)).resolves.toBe(verified.cid);
    }
  });

  it('pins interoperability vectors for accidental-change detection', async () => {
    const { manifests } = createProtocolFixtureSet();

    expect(
      Object.fromEntries(
        await Promise.all(
          Object.entries(manifests).map(async ([name, manifest]) => [
            name,
            {
              objectId: manifest.objectId,
              cid: await getEnvelopeCid(manifest.envelope),
            },
          ]),
        ),
      ),
    ).toEqual({
      aliceProfile: {
        objectId: 'swobj:v1:profile:uUe4gKwpiZNNp-p8UiwXoqTSX-gXiE-hIlWnb-4aDsEY',
        cid: 'bafkreifuyouar2hmpoeq4dslyol77s5hwcv3jnftixnbco74nkmknikn4e',
      },
      bobProfile: {
        objectId: 'swobj:v1:profile:ua2whluTQBOAranE-1lcBmHEdPBXUeMS0JV_3OrB1vio',
        cid: 'bafkreibvplks4yfyf3cg4y4mkihy2wnruh5bjseumhe6kmq5ditluudxta',
      },
      alicePost: {
        objectId: 'swobj:v1:post:u5GP5ycWs9yvQsW_CvjFYeZom68f3dD3Pj4M58wvTNK4',
        cid: 'bafkreif5m4tvovle5samu2sn2pvvnb36spo3czzqmni3ru4qrht5vtqkxy',
      },
      bobReply: {
        objectId: 'swobj:v1:post:u0h6t9ATkCDrSDxnPGZL9HT8BI3BnFuvXCUtLXesLhYY',
        cid: 'bafkreibcm5jnyqw3g6ywpdk5kegtlloo3dzcbepfnkv66irluyjuottega',
      },
      bobReplyTombstone: {
        objectId: 'swobj:v1:tombstone:u5hVJDLdHJ70tOvX4Fan5A5ZXlGM_rzA3_87I2jnkte4',
        cid: 'bafkreiggcix4syxqqsuy7uu6dggygi6kciaf6rnvrpkehlury7bjmmzaqe',
      },
    });
  });
});

import {
  canonicalizeEnvelope,
  decodeCanonicalEnvelope,
  getEnvelopeCid,
  identityIdSchema,
  networkIdSchema,
  verifyEnvelope,
} from '@wetdrool/protocol';
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
    expect(first.network.startsWith('droolnet:v1:')).toBe(true);
    for (const participant of Object.values(first.participants)) {
      expect(identityIdSchema.parse(participant.author)).toBe(participant.author);
      expect(participant.author.startsWith(`wetdroolid:v1:${first.network}:`)).toBe(true);
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

  it('round-trips the immutable signed profile-v1 fixture without rewriting its bytes', async () => {
    const fixture = createProtocolFixtureSet().manifests.aliceProfileV1;
    const decoded = decodeCanonicalEnvelope(fixture.canonicalBytes);

    expect(decoded.payload).toMatchObject({
      type: 'profile',
      schemaVersion: 1,
      content: {
        genderVisibility: 'private',
        pronouns: [{ value: 'she/her', visibility: 'public' }],
      },
    });
    expect(canonicalizeEnvelope(decoded)).toEqual(fixture.canonicalBytes);
    await expect(verifyEnvelope(fixture.canonicalBytes, () => true)).resolves.toMatchObject({
      objectId: fixture.objectId,
    });

    expect(createProtocolFixtureSet().manifests.aliceProfile.envelope.payload).toMatchObject({
      type: 'profile',
      schemaVersion: 2,
    });
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
      aliceProfileV1: {
        objectId: 'wetdroolobj:v1:profile:uXkdJJqsNndfcFsSA9vg-NFqZgNm-xi5E3Pf0wdgvhVY',
        cid: 'bafkreicm6agizzet73qfterxlhsuxqn3aoq63r3547nbhgsfwepsqtuxk4',
      },
      aliceProfile: {
        objectId: 'wetdroolobj:v1:profile:uYest1swDczVAkR-TAm939husRUn0kvPna_DKvdlSyvs',
        cid: 'bafkreideebtdlal4m7rwoffvfjaf37f4x2khbk3w3hhroked7i7otewbti',
      },
      bobProfile: {
        objectId: 'wetdroolobj:v1:profile:uYJbmmQbX8UJirf8B1GYhYCKfo52axkbQiptDNRE63Ek',
        cid: 'bafkreigalscswut4q73wtvc6zb4xoj3tczxcfk7ewnohapfhjkmekm4gna',
      },
      alicePost: {
        objectId: 'wetdroolobj:v1:post:ujOrBjnUJaGYhNMmIlg-7sf4OeeDi5JvznJnZo_DF6PM',
        cid: 'bafkreic6xffmw3ilnmexjvcbkieyqzgph5ojpjoyhqeu2lba7nldeopbtq',
      },
      bobReply: {
        objectId: 'wetdroolobj:v1:post:u_OZR8l8RhcESaYXgN_vuC5s9xvX4xJ7a6ueM0ZiOR4E',
        cid: 'bafkreidvng2clbgtbdvz5w6zgb7576cwu2xqw3n7tjvqbgr7oyxwwdvmfi',
      },
      bobReplyTombstone: {
        objectId: 'wetdroolobj:v1:tombstone:u155GDfJ2uHii6pyd6dhzwaBW-ztFiGh765oBTXO8VxY',
        cid: 'bafkreif52zmvjvxrvbascjr4rtzqonavcxz7j6zzdmrtfiazwvuzz2pbby',
      },
    });
  });
});

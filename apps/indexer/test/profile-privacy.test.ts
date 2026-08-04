import { describe, expect, it } from 'vitest';

import type {
  EncryptedContentReference,
  LegacyProfileContent,
  ProfileContent,
} from '@wetdrool/protocol';

import { projectPublicProfileContent } from '../src/profile-privacy.js';
import { TEST_CID } from './cid-fixtures.js';

const encryptedReference = {
  cid: TEST_CID,
  digest: `u${'A'.repeat(43)}`,
  bytes: 128,
  mediaType: 'application/octet-stream',
  protection: {
    kind: 'encrypted',
    encryptionFormat: 'wetdrool-sealed-profile-value-v1',
    keyEnvelope: {
      id: `wetdroolobj:v1:media-manifest:u${'A'.repeat(43)}`,
    },
    accessPolicy: {
      id: `wetdroolobj:v1:community-rule-set:u${'A'.repeat(43)}`,
    },
  },
} as const satisfies EncryptedContentReference;

describe('public profile projection', () => {
  it('retains public identity values without indexing protected references', () => {
    const content: ProfileContent = {
      displayName: 'River',
      bio: 'Public bio.',
      pronouns: [
        { visibility: 'public', value: 'they/them' },
        { visibility: 'private', valueReference: encryptedReference },
      ],
      gender: { visibility: 'followers', valueReference: encryptedReference },
      chosenFamilyLabels: [
        { visibility: 'public', value: 'chosen sibling' },
        { visibility: 'private', valueReference: encryptedReference },
      ],
      location: { visibility: 'public', value: 'Earth' },
      links: [],
    };

    expect(projectPublicProfileContent(2, content)).toEqual({
      displayName: 'River',
      bio: 'Public bio.',
      pronouns: [{ visibility: 'public', value: 'they/them' }],
      chosenFamilyLabels: [{ visibility: 'public', value: 'chosen sibling' }],
      location: { visibility: 'public', value: 'Earth' },
      links: [],
    });
  });

  it('normalizes only explicitly public frozen-v1 values into the v2 projection', () => {
    const content: LegacyProfileContent = {
      displayName: 'River',
      bio: 'Historical public bio.',
      pronouns: [
        { visibility: 'public', value: 'they/them' },
        { visibility: 'followers', value: 'followers plaintext' },
        { visibility: 'private', value: 'private plaintext' },
      ],
      gender: 'nonbinary',
      genderVisibility: 'public',
      chosenFamilyLabels: ['chosen sibling'],
      location: 'Sensitive legacy location',
      links: [],
    };

    const projected = projectPublicProfileContent(1, content);

    expect(projected).toEqual({
      displayName: 'River',
      bio: 'Historical public bio.',
      pronouns: [{ visibility: 'public', value: 'they/them' }],
      gender: { visibility: 'public', value: 'nonbinary' },
      chosenFamilyLabels: [],
      links: [],
    });
    expect(JSON.stringify(projected)).not.toMatch(
      /followers plaintext|private plaintext|chosen sibling|Sensitive legacy location|genderVisibility/u,
    );
  });

  it('drops non-public frozen-v1 gender and rejects legacy fields in v2 content', () => {
    expect(
      projectPublicProfileContent(1, {
        displayName: 'River',
        bio: '',
        pronouns: [],
        gender: 'nonbinary',
        genderVisibility: 'private',
        chosenFamilyLabels: [],
        links: [],
      }),
    ).toEqual({
      displayName: 'River',
      bio: '',
      pronouns: [],
      chosenFamilyLabels: [],
      links: [],
    });

    expect(() =>
      projectPublicProfileContent(2, {
        displayName: 'River',
        bio: '',
        pronouns: [],
        gender: 'nonbinary',
        genderVisibility: 'public',
        chosenFamilyLabels: [],
        links: [],
      }),
    ).toThrow();
  });
});

import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import bs58 from 'bs58';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_ADMIN_DATABASE_URL'] ??
  'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial';
const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

describe('0012 profile-confidentiality migration', () => {
  it('removes protected profile values from every public projection column', async () => {
    const schema = `indexer_0012_${randomBytes(8).toString('hex')}`;
    const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    const programId = publicKey();
    const networkId = `wokenet:v1:${publicKey()}:${programId}`;
    const identityAddress = publicKey();
    const identityId = `wokesocialid:v1:${networkId}:${identityAddress}`;
    const populatedIdentityAddress = publicKey();
    const populatedIdentityId = `wokesocialid:v1:${networkId}:${populatedIdentityAddress}`;
    const protectedIdentityAddress = publicKey();
    const protectedIdentityId = `wokesocialid:v1:${networkId}:${protectedIdentityAddress}`;
    const now = new Date('2026-07-28T20:00:00.000Z');

    try {
      await sql.unsafe(`CREATE SCHEMA "${schema}"`);
      await sql.unsafe(`SET search_path TO "${schema}", wokesocial_indexer, public`);
      const migrationFiles = (await readdir(migrationDirectory))
        .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
        .sort();
      const confidentialityMigration = migrationFiles.find((file) => file.startsWith('0012_'));
      expect(confidentialityMigration).toBeDefined();
      for (const file of migrationFiles.filter(
        (candidate) => candidate < (confidentialityMigration ?? ''),
      )) {
        await sql.unsafe(await readFile(join(migrationDirectory, file), 'utf8'));
      }
      await sql`ALTER TABLE profiles ADD COLUMN content jsonb`;

      await sql`
        INSERT INTO identities (
          identity_id, network_id, identity_address, root_authority,
          root_rotation_count, created_slot, created_at, updated_slot, updated_at
        ) VALUES (
          ${identityId}, ${networkId}, ${identityAddress}, ${publicKey()},
          0, 1, ${now}, 1, ${now}
        )
      `;
      await sql`
        INSERT INTO identities (
          identity_id, network_id, identity_address, root_authority,
          root_rotation_count, created_slot, created_at, updated_slot, updated_at
        ) VALUES (
          ${protectedIdentityId}, ${networkId}, ${protectedIdentityAddress}, ${publicKey()},
          0, 1, ${now}, 1, ${now}
        )
      `;
      await sql`
        INSERT INTO identities (
          identity_id, network_id, identity_address, root_authority,
          root_rotation_count, created_slot, created_at, updated_slot, updated_at
        ) VALUES (
          ${populatedIdentityId}, ${networkId}, ${populatedIdentityAddress}, ${publicKey()},
          0, 1, ${now}, 1, ${now}
        )
      `;
      await sql`
        INSERT INTO profiles (
          identity_id, object_id, cid, payload_hash, display_name, bio,
          pronouns, updated_slot, updated_at
        ) VALUES (
          ${identityId}, 'legacy-profile', 'bafylegacyprofile',
          'uLegacyProfilePayloadHash', 'River', 'Legacy profile',
          ${sql.json([
            { visibility: 'public', value: 'they/them' },
            { visibility: 'followers', value: 'protected followers plaintext' },
            { visibility: 'private', value: 'protected private plaintext' },
          ])},
          2, ${now}
        )
      `;
      await sql`
        INSERT INTO profiles (
          identity_id, object_id, cid, payload_hash, display_name, bio,
          pronouns, content, updated_slot, updated_at
        ) VALUES (
          ${protectedIdentityId}, 'populated-protected-profile', 'bafypopulatedprotectedprofile',
          'uPopulatedProtectedProfilePayloadHash', 'Sam', 'Protected profile',
          ${sql.json([])},
          ${sql.json({
            displayName: 'Sam',
            bio: 'Protected profile',
            pronouns: [
              { visibility: 'public', value: 'ze/hir', unexpected: 'discard me' },
              { visibility: 'private', valueReference: { secret: 'pronoun reference' } },
            ],
            gender: {
              visibility: 'private',
              valueReference: { secret: 'gender reference' },
            },
            chosenFamilyLabels: [
              { visibility: 'public', value: 'chosen sibling', unexpected: 'discard me' },
              { visibility: 'followers', valueReference: { secret: 'label reference' } },
            ],
            location: { visibility: 'public', value: 'Earth', unexpected: 'discard me' },
            links: [],
          })},
          2, ${now}
        )
      `;
      await sql`
        INSERT INTO profiles (
          identity_id, object_id, cid, payload_hash, display_name, bio,
          pronouns, content, updated_slot, updated_at
        ) VALUES (
          ${populatedIdentityId}, 'populated-legacy-profile', 'bafypopulatedlegacyprofile',
          'uPopulatedLegacyProfilePayloadHash', 'Alex', 'Populated legacy profile',
          ${sql.json([
            { visibility: 'public', value: 'she/her' },
            { visibility: 'private', value: 'compatibility-column plaintext' },
          ])},
          ${sql.json({
            displayName: 'Alex',
            bio: 'Populated legacy profile',
            pronouns: [
              { visibility: 'public', value: 'she/her' },
              { visibility: 'followers', value: 'followers plaintext' },
            ],
            gender: 'nonbinary',
            genderVisibility: 'public',
            chosenFamilyLabels: ['chosen sibling'],
            location: 'Sensitive legacy location',
            website: 'https://example.com/alex',
            links: [{ label: 'Public notes', url: 'https://example.com/alex/notes' }],
          })},
          2, ${now}
        )
      `;

      await sql.unsafe(
        await readFile(join(migrationDirectory, confidentialityMigration ?? ''), 'utf8'),
      );

      const rows = await sql<{ pronouns: unknown; content: unknown }[]>`
        SELECT pronouns, content
        FROM profiles
        WHERE identity_id IN (${identityId}, ${populatedIdentityId}, ${protectedIdentityId})
        ORDER BY identity_id
      `;
      expect(rows).toHaveLength(3);
      expect(rows).toEqual(
        expect.arrayContaining([
          {
            pronouns: [{ visibility: 'public', value: 'they/them' }],
            content: {
              displayName: 'River',
              bio: 'Legacy profile',
              pronouns: [{ visibility: 'public', value: 'they/them' }],
              chosenFamilyLabels: [],
              links: [],
            },
          },
          {
            pronouns: [{ visibility: 'public', value: 'she/her' }],
            content: {
              displayName: 'Alex',
              bio: 'Populated legacy profile',
              pronouns: [{ visibility: 'public', value: 'she/her' }],
              gender: { visibility: 'public', value: 'nonbinary' },
              chosenFamilyLabels: [],
              website: 'https://example.com/alex',
              links: [{ label: 'Public notes', url: 'https://example.com/alex/notes' }],
            },
          },
          {
            pronouns: [{ visibility: 'public', value: 'ze/hir' }],
            content: {
              displayName: 'Sam',
              bio: 'Protected profile',
              pronouns: [{ visibility: 'public', value: 'ze/hir' }],
              chosenFamilyLabels: [{ visibility: 'public', value: 'chosen sibling' }],
              location: { visibility: 'public', value: 'Earth' },
              links: [],
            },
          },
        ]),
      );
      expect(JSON.stringify(rows)).not.toContain('protected');
      expect(JSON.stringify(rows)).not.toMatch(
        /followers plaintext|compatibility-column plaintext|Sensitive legacy location|genderVisibility|discard me|pronoun reference|gender reference|label reference/u,
      );
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end({ timeout: 5 });
    }
  }, 30_000);
});

function publicKey(): string {
  return bs58.encode(randomBytes(32));
}

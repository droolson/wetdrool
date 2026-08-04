import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { format } from 'prettier';
import { z } from 'zod';

import {
  COMMUNITY_MEMBERSHIP_SCHEMA_VERSION,
  COMMUNITY_SCHEMA_VERSION,
  PORTABLE_OBJECT_TYPES,
  PROFILE_SCHEMA_VERSION,
} from '../src/constants.js';
import { signedEnvelopeSchema } from '../src/schemas.js';

const outputUrl = new URL('../schemas/wetdrool-signed-envelope-v1.schema.json', import.meta.url);

const generated = z.toJSONSchema(signedEnvelopeSchema, {
  io: 'input',
  reused: 'ref',
  target: 'draft-2020-12',
});

const artifact = {
  $id: 'https://wetdrool.com/protocol/schemas/signed-envelope-v1.schema.json',
  ...generated,
  title: 'WetDrool signed portable object envelope v1',
  description:
    'Structural interchange schema for every WetDrool v1 portable object and its Ed25519 proof.',
  $comment:
    'JSON Schema validates the protocol-v1 read surface, including frozen schema-version-1 profiles, communities, and community memberships plus their current schema-version-2 shapes. Implementations MUST also apply RFC 8785 canonicalization, signature/hash verification, UTF-8 byte limits, cross-field refinements, intrinsic signing rules, immutable-transition rules, and current external authorization policy from the protocol library. New objects MUST use the current creation schema/builders.',
  'x-wetdrool-protocol-version': '1.0',
  'x-wetdrool-schema-versions': [1, 2],
  'x-wetdrool-current-profile-schema-version': PROFILE_SCHEMA_VERSION,
  'x-wetdrool-current-community-schema-version': COMMUNITY_SCHEMA_VERSION,
  'x-wetdrool-current-community-membership-schema-version': COMMUNITY_MEMBERSHIP_SCHEMA_VERSION,
  'x-wetdrool-object-types': PORTABLE_OBJECT_TYPES,
};

const serialized = await format(JSON.stringify(artifact), {
  parser: 'json',
  printWidth: 100,
});
const mode = process.argv[2];

if (mode === '--write') {
  await mkdir(new URL('../schemas/', import.meta.url), { recursive: true });
  await writeFile(outputUrl, serialized, 'utf8');
  process.stdout.write(`Generated ${outputUrl.pathname}\n`);
} else if (mode === '--check') {
  let current: string;
  try {
    current = await readFile(outputUrl, 'utf8');
  } catch {
    throw new Error(
      'The checked-in protocol JSON Schema is missing. Run pnpm --filter @wetdrool/protocol schema:generate.',
    );
  }
  if (current !== serialized) {
    throw new Error(
      'The checked-in protocol JSON Schema is stale. Run pnpm --filter @wetdrool/protocol schema:generate.',
    );
  }
  process.stdout.write('Protocol JSON Schema matches the canonical Zod registry.\n');
} else {
  throw new TypeError('Expected exactly one mode: --write or --check.');
}

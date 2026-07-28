import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { format } from 'prettier';
import { z } from 'zod';

import { PORTABLE_OBJECT_TYPES } from '../src/constants.js';
import { signedEnvelopeSchema } from '../src/schemas.js';

const outputUrl = new URL(
  '../schemas/socially-woke-signed-envelope-v1.schema.json',
  import.meta.url,
);

const generated = z.toJSONSchema(signedEnvelopeSchema, {
  io: 'input',
  reused: 'ref',
  target: 'draft-2020-12',
});

const artifact = {
  $id: 'https://woke.social/protocol/schemas/signed-envelope-v1.schema.json',
  ...generated,
  title: 'Socially Woke signed portable object envelope v1',
  description:
    'Structural interchange schema for every Socially Woke v1 portable object and its Ed25519 proof.',
  $comment:
    'JSON Schema validates transport structure. Implementations MUST also apply RFC 8785 canonicalization, signature/hash verification, UTF-8 byte limits, cross-field refinements, intrinsic signing rules, and current external authorization policy from the protocol library.',
  'x-socially-woke-protocol-version': '1.0',
  'x-socially-woke-schema-version': 1,
  'x-socially-woke-object-types': PORTABLE_OBJECT_TYPES,
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
      'The checked-in protocol JSON Schema is missing. Run pnpm --filter @socially-woke/protocol schema:generate.',
    );
  }
  if (current !== serialized) {
    throw new Error(
      'The checked-in protocol JSON Schema is stale. Run pnpm --filter @socially-woke/protocol schema:generate.',
    );
  }
  process.stdout.write('Protocol JSON Schema matches the canonical Zod registry.\n');
} else {
  throw new TypeError('Expected exactly one mode: --write or --check.');
}

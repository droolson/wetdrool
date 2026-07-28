import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { PORTABLE_OBJECT_TYPES } from '../src/constants.js';

const schemaUrl = new URL(
  '../schemas/socially-woke-signed-envelope-v1.schema.json',
  import.meta.url,
);

describe('distributable JSON Schema', () => {
  it('identifies every portable v1 object family and the stricter runtime boundary', async () => {
    const schema = JSON.parse(await readFile(schemaUrl, 'utf8')) as Record<string, unknown>;

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe('https://woke.social/protocol/schemas/signed-envelope-v1.schema.json');
    expect(schema['x-socially-woke-object-types']).toEqual(PORTABLE_OBJECT_TYPES);
    expect(String(schema.$comment)).toContain('signature/hash verification');

    const serialized = JSON.stringify(schema);
    for (const type of PORTABLE_OBJECT_TYPES) {
      expect(serialized).toContain(`"const":"${type}"`);
    }
    expect(serialized).toContain('^woke:v1:');
    expect(serialized).toContain('^swid:v1:woke:v1:');
    expect(serialized).not.toContain('^solana:');
    expect(serialized).not.toContain('^swid:v1:solana:');
  });
});

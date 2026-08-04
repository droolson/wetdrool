import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { PORTABLE_OBJECT_TYPES } from '../src/constants.js';

const schemaUrl = new URL('../schemas/wetdrool-signed-envelope-v1.schema.json', import.meta.url);

describe('distributable JSON Schema', () => {
  it('identifies every portable v1 object family and the stricter runtime boundary', async () => {
    const schema = JSON.parse(await readFile(schemaUrl, 'utf8')) as Record<string, unknown>;

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe('https://wetdrool.com/protocol/schemas/signed-envelope-v1.schema.json');
    expect(schema['x-wetdrool-object-types']).toEqual(PORTABLE_OBJECT_TYPES);
    expect(schema['x-wetdrool-schema-versions']).toEqual([1, 2]);
    expect(schema['x-wetdrool-current-profile-schema-version']).toBe(2);
    expect(schema['x-wetdrool-current-community-schema-version']).toBe(2);
    expect(schema['x-wetdrool-current-community-membership-schema-version']).toBe(2);
    expect(String(schema.$comment)).toContain('signature/hash verification');

    const serialized = JSON.stringify(schema);
    for (const type of PORTABLE_OBJECT_TYPES) {
      expect(serialized).toContain(`"const":"${type}"`);
    }
    expect(serialized).toContain('^droolnet:v1:');
    expect(serialized).toContain('^wetdroolid:v1:droolnet:v1:');
    expect(serialized).toContain('"valueReference"');
    expect(serialized).toContain('"encryptionFormat"');
    expect(serialized).toContain('"genderVisibility"');
    expect(serialized).not.toContain('^solana:');
    expect(serialized).not.toContain('^wetdroolid:v1:solana:');
  });
});

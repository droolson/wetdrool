import { sha256 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  assertCustomWokeNameAllowed,
  canonicalizeWokeName,
  deriveRandomWokeName,
  isReservedCustomWokeName,
  WOKE_RANDOM_HANDLE_ENTROPY_BITS,
  wokeNameSchema,
} from '../src/index.js';

describe('.drool namespace', () => {
  it('canonicalizes UI forms to one exact onchain handle', () => {
    expect(canonicalizeWokeName('Alex_BTC420')).toEqual({
      namespace: 'woke',
      version: 1,
      handle: 'alex_btc420',
      name: 'alex_btc420.drool',
    });
    expect(canonicalizeWokeName('@alex_btc420.drool')).toEqual(canonicalizeWokeName('alex_btc420'));
    expect(wokeNameSchema.parse('alex_btc420.drool')).toBe('alex_btc420.drool');
  });

  it.each([
    ' alex.drool',
    'alex.drool ',
    'álеx.drool',
    'ａｌｅｘ.drool',
    '@@alex.drool',
    'alex..drool',
    'ab.drool',
    'alex__btc.drool',
    '_alex.drool',
    'alex_.drool',
  ])('rejects ambiguous, confusable, or invalid input: %s', (input) => {
    expect(() => canonicalizeWokeName(input)).toThrow();
  });

  it('keeps anonymous and safety namespaces unavailable to custom claims', () => {
    expect(() => assertCustomWokeNameAllowed('anon_0123456789abcdef.drool')).toThrow(/reserved/u);
    expect(() => assertCustomWokeNameAllowed('support.drool')).toThrow(/reserved/u);
    expect(assertCustomWokeNameAllowed('alexbtc420.drool').handle).toBe('alexbtc420');
    expect(isReservedCustomWokeName('security.drool')).toBe(true);
    expect(isReservedCustomWokeName('independent_artist.drool')).toBe(false);
  });

  it('derives a stable 80-bit anonymous name from public root material only', () => {
    const derived = deriveRandomWokeName('11111111111111111111111111111111');
    expect(derived).toEqual({
      namespace: 'woke',
      version: 1,
      kind: 'random',
      derivation: 'solana-root-sha256-crockford80-v1',
      entropyBits: WOKE_RANDOM_HANDLE_ENTROPY_BITS,
      handle: 'anon_a8rvm9ryz0phc719',
      name: 'anon_a8rvm9ryz0phc719.drool',
    });
    expect(deriveRandomWokeName('11111111111111111111111111111111')).toEqual(derived);
    expect(wokeNameSchema.parse(derived.name)).toBe(derived.name);
  });

  it('produces no collision across a deterministic 4,096-key property sample', () => {
    const names = new Set<string>();
    for (let index = 0; index < 4_096; index += 1) {
      const key = bs58.encode(sha256(new TextEncoder().encode(`woke-name-test-key:${index}`)));
      names.add(deriveRandomWokeName(key).handle);
    }
    expect(names.size).toBe(4_096);
  });

  it.each(['', 'not-base58', '1111111111111111111111111111111', '1'.repeat(45)])(
    'rejects an invalid Solana root authority: %s',
    (authority) => {
      expect(() => deriveRandomWokeName(authority)).toThrow(/32-byte Solana public key/u);
    },
  );
});

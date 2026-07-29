import { describe, expect, it } from 'vitest';

import { isSeekerModelHint } from '../src/seeker-model';

describe('isSeekerModelHint', () => {
  it('recognizes the Android platform string only as a non-security hint', () => {
    expect(isSeekerModelHint('android', { Model: 'Seeker' })).toBe(true);
    expect(isSeekerModelHint('ios', { Model: 'Seeker' })).toBe(false);
    expect(isSeekerModelHint('android', { Model: 'emulator' })).toBe(false);
  });
});

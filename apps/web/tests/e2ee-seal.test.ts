import { describe, expect, it } from 'vitest';

import { openText, sealText } from '../lib/e2ee-seal';
import { encodeMiddleOutLite, decodeMiddleOutLite } from '../lib/middle-out';

describe('e2ee seal + middle-out', () => {
  it('round-trips sealed text', async () => {
    const room = 'lobby';
    const pass = 'test-passphrase-not-secret';
    const msg = 'hello wetdrool e2ee ' + 'x'.repeat(500);
    const env = await sealText(room, pass, msg);
    expect(env.protocol).toBe('wetdrool.e2ee.middle-out.v1');
    expect(env.compression).toBe('middle-out-lite-v1');
    const out = await openText(pass, env);
    expect(out).toBe(msg);
  });

  it('middle-out self-check on json', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ a: 1, b: 'c'.repeat(3000) }));
    const frame = await encodeMiddleOutLite(bytes, 'json');
    const back = await decodeMiddleOutLite(frame);
    expect([...back]).toEqual([...bytes]);
  });
});

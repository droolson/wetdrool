import { describe, expect, it } from 'vitest';

import {
  describeOpenError,
  OpenEnvelopeError,
  openText,
  sealText,
} from '../lib/e2ee-seal';
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

  it('classifies wrong room key as OpenEnvelopeError wrong_key', async () => {
    const env = await sealText('room-a', 'correct-passphrase-here', 'secret body');
    await expect(openText('wrong-passphrase-here', env)).rejects.toMatchObject({
      name: 'OpenEnvelopeError',
      code: 'wrong_key',
    });
    try {
      await openText('wrong-passphrase-here', env);
    } catch (err) {
      expect(err).toBeInstanceOf(OpenEnvelopeError);
      const desc = describeOpenError(err);
      expect(desc.code).toBe('wrong_key');
      expect(desc.message.toLowerCase()).toContain('wrong room key');
    }
  });

  it('rejects unsupported protocol', async () => {
    const env = await sealText('room-b', 'pass-pass-pass', 'x');
    const bad = { ...env, protocol: 'other.protocol.v0' as typeof env.protocol };
    await expect(openText('pass-pass-pass', bad)).rejects.toMatchObject({
      code: 'unsupported_protocol',
    });
  });

  it('middle-out self-check on json', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ a: 1, b: 'c'.repeat(3000) }));
    const frame = await encodeMiddleOutLite(bytes, 'json');
    const back = await decodeMiddleOutLite(frame);
    expect([...back]).toEqual([...bytes]);
  });
});

import { describe, expect, it } from 'vitest';

import { contentDefinedChunk, encodeMiddleOutLite, decodeMiddleOutLite } from '../src/index.js';

describe('@wetdrool/middle-out-lite', () => {
  it('chunks deterministically', () => {
    const data = new TextEncoder().encode('a'.repeat(5000) + 'b'.repeat(5000));
    const a = contentDefinedChunk(data);
    const b = contentDefinedChunk(data);
    expect(a).toEqual(b);
    expect(a.reduce((s, c) => s + c.length, 0)).toBe(data.length);
  });

  it('round-trips text losslessly', async () => {
    const input = new TextEncoder().encode(
      JSON.stringify({ hello: 'wetdrool', n: 42, pad: 'x'.repeat(2000) }),
    );
    const frame = await encodeMiddleOutLite(input, 'json');
    const out = await decodeMiddleOutLite(frame);
    expect([...out]).toEqual([...input]);
    expect(frame.chunks.length).toBeGreaterThan(0);
  });

  it('passes through jpeg-like header as media', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(1)]);
    const frame = await encodeMiddleOutLite(jpeg, 'media-passthrough');
    expect(frame.kind).toBe('media-passthrough');
    const out = await decodeMiddleOutLite(frame);
    expect([...out]).toEqual([...jpeg]);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { openEnvelope, sealMedia, sealText } from '../lib/seal.mjs';

test('text seal roundtrip', () => {
  const room = 'lobby';
  const pass = 'test-pass';
  const env = sealText(room, pass, 'hello onion');
  const opened = openEnvelope(pass, env);
  assert.equal(opened.bytes.toString('utf8'), 'hello onion');
});

test('media seal roundtrip', () => {
  const room = 'shorts';
  const pass = 'gif-pass';
  const bytes = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);
  const env = sealMedia(room, pass, bytes, 'image/gif', 'gif');
  const opened = openEnvelope(pass, env);
  assert.deepEqual([...opened.bytes], [...bytes]);
});

test('wrong passphrase fails', () => {
  const env = sealText('lobby', 'a', 'secret');
  assert.throws(() => openEnvelope('b', env));
});

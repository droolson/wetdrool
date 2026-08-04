import { ed25519 } from '@noble/curves/ed25519.js';
import {
  buildPostPayload,
  canonicalizeEnvelope,
  createPayloadBuilderIdentity,
  signPayload,
  type NetworkId,
  type PostContent,
} from '@wetdrool/protocol';

const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const publicKey = ed25519.getPublicKey(privateKey);
const network =
  'droolnet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD' as NetworkId;
const author = `wetdroolid:v1:${network}:11111111111111111111111111111111`;
const identity = createPayloadBuilderIdentity(network, author, publicKey, 'root');
const content: PostContent = {
  accessibility: {
    altTextReminderAcknowledged: false,
    captionReferences: [],
  },
  authorLabels: [],
  body: 'A canonical localnet publication.',
  contentWarnings: [],
  format: 'plain',
  language: 'en',
  media: [],
  quotePolicy: 'allowed',
  replyPolicy: 'anyone',
  visibility: { kind: 'public' },
};

export function createCanonicalEnvelopeBytes(): Uint8Array {
  return canonicalizeEnvelope(
    signPayload(
      buildPostPayload(identity, content, {
        createdAt: new Date('2026-07-29T12:00:00.000Z'),
        nonce: Uint8Array.from({ length: 16 }, (_, index) => index),
      }),
      privateKey,
    ),
  );
}

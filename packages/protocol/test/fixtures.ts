import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import { createPayloadBuilderIdentity, type NetworkId, type PostContent } from '../src/index.js';

export const privateKey = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));
export const publicKey = ed25519.getPublicKey(privateKey);

const genesis = bs58.encode(Uint8Array.from({ length: 32 }, () => 7));
const program = bs58.encode(Uint8Array.from({ length: 32 }, () => 8));
const identityPda = bs58.encode(Uint8Array.from({ length: 32 }, () => 9));

export const network = `woke:v1:${genesis}:${program}` as NetworkId;
export const author = `swid:v1:${network}:${identityPda}`;
export const identity = createPayloadBuilderIdentity(network, author, publicKey);

export const postContent: PostContent = {
  format: 'plain',
  body: 'We can build kinder networks without giving up user agency.',
  media: [],
  language: 'en',
  contentWarnings: [],
  accessibility: {
    altTextReminderAcknowledged: false,
    captionReferences: [],
  },
  visibility: { kind: 'public' },
  authorLabels: [],
  replyPolicy: 'anyone',
  quotePolicy: 'allowed',
};

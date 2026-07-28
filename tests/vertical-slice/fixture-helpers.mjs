import anchor from '@coral-xyz/anchor';

export function deterministicTestKeypair(seed) {
  // These deterministic keys are test-only, funded exclusively by a fresh local validator.
  return anchor.web3.Keypair.fromSeed(
    Uint8Array.from({ length: 32 }, (_, index) => (seed + index * 37) & 0xff),
  );
}

export function deterministicNonce(seed) {
  return Uint8Array.from({ length: 16 }, (_, index) => (seed + index * 19) & 0xff);
}

export function textPostContent(body) {
  return {
    format: 'plain',
    body,
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
}

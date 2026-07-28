import type { Metadata } from 'next';

import { ProductState } from '@/components/product-state';

export const metadata: Metadata = {
  title: 'Messages',
  description: 'Private messaging safety and encryption readiness without simulated conversations.',
};

export default function MessagesPage() {
  return (
    <ProductState
      actionHref="/messages/group"
      actionLabel="Inspect group-message readiness"
      cards={[
        {
          copy: 'Message bodies, attachments, reactions, and read state must be end-to-end encrypted before leaving a device.',
          eyebrow: 'Encryption',
          footer: 'No server-readable fallback',
          title: 'Private means ciphertext',
          tone: 'plum',
        },
        {
          copy: 'Each conversation can show device changes, safety-number status, retention, and disappearing-message policy.',
          eyebrow: 'Assurance',
          footer: 'Key changes are visible',
          title: 'Trust can be inspected',
          tone: 'coral',
        },
        {
          copy: 'Blocks stop new envelopes, reports separate evidence by consent, and unknown senders begin behind a request boundary.',
          eyebrow: 'Consent',
          footer: 'No forced inbox access',
          title: 'A door you can close',
          tone: 'sky',
        },
      ]}
      detail="No authenticated messaging identity, prekey service, encrypted store, or relay session is configured. This page will not create sample chats or imply end-to-end encryption."
      eyebrow="Private conversations"
      intro="Messaging is not a styled text box. It needs audited key agreement, device verification, encrypted storage, abuse controls, and honest delivery state."
      stateEyebrow="Messaging locked"
      stateTitle="Encryption adapters are required first."
      title="Private by construction."
    />
  );
}

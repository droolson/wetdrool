import type { Metadata } from 'next';

import { AuthoritySurface } from '@/components/authority-surface';

export const metadata: Metadata = {
  title: 'Edit profile',
  description: 'Profile editing boundaries without inferring identity authority.',
};

export default async function EditProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AuthoritySurface
      backHref={`/profile/${encodeURIComponent(id)}`}
      backLabel="Back to profile"
      cards={[
        {
          copy: 'Chosen name, pronouns, languages, identity details, and location each carry an independent visibility boundary.',
          eyebrow: 'Disclosure',
          title: 'Fields do not travel as a bundle',
          tone: 'plum',
        },
        {
          copy: 'The new profile manifest is canonicalized and signed before its content reference is published.',
          eyebrow: 'Integrity',
          title: 'Preview the exact object',
          tone: 'coral',
        },
        {
          copy: 'A prior public object may remain retrievable; clients can honor current chosen names without denying history.',
          eyebrow: 'History',
          title: 'Revision is not magical erasure',
          tone: 'sky',
        },
      ]}
      detail="The viewer has not authenticated control of this identity, and no profile storage or signing adapter is configured. Editable fields are intentionally not rendered."
      eyebrow="Edit profile"
      identifier={id}
      requirements={[
        'Resolve the current identity root and profile reference.',
        'Authenticate the root or a current profile-scoped delegation.',
        'Build and preview a canonical signed profile manifest.',
        'Verify storage receipt and finalized reference update before reporting success.',
      ]}
      stateTitle="No editable identity authority was proven."
      title="Change the profile, preserve the proof."
    />
  );
}

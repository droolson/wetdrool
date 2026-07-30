import type { Metadata } from 'next';
import { StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { WokeAiChat } from '@/components/woke-ai-chat';
import { getWokeAiRuntimeConfig } from '@/lib/woke-ai';

export const metadata: Metadata = {
  title: 'Woke AI',
  description:
    'The platform-native AI assistant: self-hosted Woke AI models beside your feed, with honest limits until the runtime is live.',
};

export const dynamic = 'force-dynamic';

export default function WokeAiPage() {
  const runtime = getWokeAiRuntimeConfig();
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Runtime gated</StatusBadge>}
        eyebrow="Woke AI"
        title="An assistant that lives where you scroll."
      >
        <p>
          Ask about your feed, a community, a transaction, or a launch — answered by WokeSocial’s
          self-hosted models (Kairos by default, Athena for depth, Hermes for speed), not a
          third-party API. Until the runtime passes its evaluation gates, this surface is honest
          about doing nothing.
        </p>
      </AppPageHeader>

      <WokeAiChat
        runtime={
          runtime.kind === 'configured'
            ? { endpoint: runtime.endpoint, kind: 'configured' }
            : { detail: runtime.detail, kind: 'unavailable' }
        }
      />
    </div>
  );
}

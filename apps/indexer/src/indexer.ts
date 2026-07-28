import { trace } from '@opentelemetry/api';

import { compareEventOrder, protocolEventSchema, type ProtocolEvent } from './events.js';
import type { ManifestVerifier } from './manifest-verifier.js';
import type { ProjectionStore } from './projection.js';

const tracer = trace.getTracer('@wokesocial/indexer');

export interface IndexResult {
  readonly event: ProtocolEvent;
  readonly applied: boolean;
}

export class OpenIndexer {
  constructor(
    private readonly projection: ProjectionStore,
    private readonly manifests: ManifestVerifier,
  ) {}

  async ingest(input: ProtocolEvent): Promise<IndexResult> {
    return tracer.startActiveSpan('indexer.ingest', async (span) => {
      try {
        const event = protocolEventSchema.parse(input);
        span.setAttribute('wokesocial.event_type', event.type);
        span.setAttribute('wokesocial.slot', event.slot.toString());
        const manifest = await this.manifests.forEvent(event);
        const applied = await this.projection.apply(event, manifest);
        return { event, applied };
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error('Unknown ingestion error'));
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async rebuild(
    networkId: string,
    events: readonly ProtocolEvent[],
  ): Promise<readonly IndexResult[]> {
    const ordered = events
      .filter((event) => event.networkId === networkId)
      .map((event) => protocolEventSchema.parse(event))
      .sort(compareEventOrder);
    const items = await Promise.all(
      ordered.map(async (event) => {
        const manifest = await this.manifests.forEvent(event);
        return manifest === undefined ? { event } : { event, manifest };
      }),
    );
    await this.projection.rebuildProjection(networkId, items);
    return ordered.map((event) => ({ event, applied: true }));
  }
}

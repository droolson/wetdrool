import { trace } from '@opentelemetry/api';

import {
  assertUnambiguousEventOrder,
  compareEventOrder,
  protocolEventSchema,
  type ProtocolEvent,
} from './events.js';
import type { ManifestVerifier } from './manifest-verifier.js';
import {
  deriveAcceptedManifestSuppressions,
  ProjectionError,
  replayEventCoordinateKey,
  type ManifestEventDisposition,
  type ProjectionReplayItem,
  type ProjectionStore,
  type VerifiedManifest,
} from './projection.js';

const tracer = trace.getTracer('@wokesocial/indexer');

export interface IndexResult {
  readonly event: ProtocolEvent;
  readonly applied: boolean;
}

export interface VerifiedIndexEvent {
  readonly event: ProtocolEvent;
  readonly manifest?: VerifiedManifest;
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
        const verified = await this.verifyEvent(event);
        const applied = await this.projection.apply(verified.event, verified.manifest);
        return { event: verified.event, applied };
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error('Unknown ingestion error'));
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async verifyEvent(input: ProtocolEvent): Promise<VerifiedIndexEvent> {
    const event = protocolEventSchema.parse(input);
    const manifest = await this.manifests.forEvent(event);
    return manifest === undefined ? { event } : { event, manifest };
  }

  async rebuild(
    networkId: string,
    events: readonly ProtocolEvent[],
  ): Promise<readonly IndexResult[]> {
    const ordered = events
      .filter((event) => event.networkId === networkId)
      .map((event) => protocolEventSchema.parse(event));
    assertUnambiguousEventOrder(ordered);
    ordered.sort(compareEventOrder);
    const dispositions = new Map<string, ManifestEventDisposition | undefined>();
    for (const event of ordered) {
      const disposition = await this.projection.manifestEventDisposition(event);
      if (disposition === undefined) {
        throw new ProjectionError(
          'OpenIndexer.rebuild requires every supplied event to exist in the durable raw ledger.',
          'stale-event',
        );
      }
      dispositions.set(replayEventCoordinateKey(event), disposition);
    }
    const acceptedManifestSuppressions = deriveAcceptedManifestSuppressions(
      ordered,
      (event) => dispositions.get(replayEventCoordinateKey(event))?.state === 'accepted',
    );
    const items: ProjectionReplayItem[] = [];
    for (const event of ordered) {
      const eventKey = replayEventCoordinateKey(event);
      const disposition = dispositions.get(eventKey);
      if (disposition?.state === 'terminal') {
        items.push({ event, terminalFailureCode: disposition.failureCode });
        continue;
      }
      if (disposition?.state === 'pending') {
        throw new ProjectionError(
          'OpenIndexer.rebuild cannot reconstruct a pending manifest without its durable deferral record; use the durable-ledger rebuild path.',
          'manifest-required',
        );
      }
      const acceptedManifestSuppression = acceptedManifestSuppressions.get(eventKey);
      if (acceptedManifestSuppression !== undefined) {
        if (disposition?.state !== 'accepted') {
          throw new ProjectionError(
            'Manifest I/O can be suppressed only for a currently accepted durable event.',
            'event-conflict',
          );
        }
        items.push({ event, acceptedManifestSuppression });
        continue;
      }
      items.push(await this.verifyEvent(event));
    }
    await this.projection.rebuildProjection(networkId, items);
    return ordered.map((event) => ({ event, applied: true }));
  }
}

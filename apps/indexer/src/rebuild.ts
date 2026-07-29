import { createHash } from 'node:crypto';

import { networkIdSchema } from '@wokesocial/protocol';
import { LocalContentAddressedStorage } from '@wokesocial/storage';
import postgres from 'postgres';

import {
  assertUnambiguousEventOrder,
  compareEventOrder,
  protocolEventSchema,
  type ProtocolEvent,
} from './events.js';
import {
  isTerminalManifestFailureCode,
  isTerminalManifestVerificationError,
  ManifestVerifier,
  type ManifestSource,
} from './manifest-verifier.js';
import { MemoryProjectionStore } from './memory-projection.js';
import { PostgresProjectionStore } from './postgres-projection.js';
import {
  deriveAcceptedManifestSuppressions,
  replayEventCoordinateKey,
  type AcceptedManifestSuppression,
  type ManifestDeferral,
  type ProjectionReplayItem,
  type TerminalManifestFailureCode,
} from './projection.js';
import { ProjectionRootKeyAuthorizer } from './projection-key-authorizer.js';

const BIGINT_EVENT_FIELDS = new Set([
  'abstainVotes',
  'authoritySequence',
  'blockerSequence',
  'closesAtSlot',
  'creatorRootRotationCount',
  'creatorSequence',
  'decisiveVotes',
  'delaySlots',
  'delegationSequence',
  'delegationStateSequence',
  'distributableLamports',
  'edgeStateSequence',
  'eligibleMemberCount',
  'entitlementFromTimestamp',
  'entitlementStateSequence',
  'entitlementUntilTimestamp',
  'executeAfterSlot',
  'expiresAtSlot',
  'feeLamports',
  'followerSequence',
  'grossLamports',
  'identitySequence',
  'issuedAtRootRotationCount',
  'membershipStateSequence',
  'noVotes',
  'offeringStateSequence',
  'opensAtSlot',
  'paidAtTimestamp',
  'participatingVotes',
  'payerRootRotationCount',
  'paymentPolicySequence',
  'policySequence',
  'previousCommunitySequence',
  'priceLamports',
  'proposalStateSequence',
  'proposerSequence',
  'reactionStateSequence',
  'reactorSequence',
  'recipientLamports',
  'rootRotationCount',
  'rotationCount',
  'sequence',
  'settlementCount',
  'slot',
  'voterSequence',
  'yesVotes',
]);
export const MAXIMUM_INDEXER_REBUILD_EVENTS = 50_000;

export class IndexerRebuildError extends Error {
  override readonly name = 'IndexerRebuildError';
}

export interface RawProtocolEventRow {
  readonly network_id: string;
  readonly transaction_signature: string;
  readonly transaction_index: number | null;
  readonly log_index: number;
  readonly slot: string;
  readonly block_time: Date | string;
  readonly event_type: string;
  readonly event_body: unknown;
  readonly manifest_pending?: boolean;
  readonly terminal_manifest_failure_code?: string | null;
  readonly pending_event_body?: unknown | null;
  readonly pending_failure_code?: string | null;
  readonly pending_failure_detail?: string | null;
  readonly pending_next_attempt_at?: Date | string | null;
}

export type DurableRawEventDisposition =
  | { readonly state: 'accepted' }
  | { readonly state: 'pending'; readonly deferral: ManifestDeferral }
  | {
      readonly state: 'terminal';
      readonly failureCode: TerminalManifestFailureCode;
    };

export interface DurableRawEventLedger {
  readonly events: readonly ProtocolEvent[];
  readonly terminalFailureCodes: ReadonlyMap<string, TerminalManifestFailureCode>;
  readonly dispositions: ReadonlyMap<string, DurableRawEventDisposition>;
}

export interface PreparedIndexerRebuild {
  readonly networkId: string;
  readonly items: readonly ProjectionReplayItem[];
  readonly eventCount: number;
  readonly firstSlot: string;
  readonly lastSlot: string;
  readonly ledgerSha256: string;
}

export interface IndexerRebuildSummary {
  readonly mode: 'dry-run' | 'applied';
  readonly networkId: string;
  readonly eventCount: number;
  readonly firstSlot: string;
  readonly lastSlot: string;
  readonly ledgerSha256: string;
}

export interface ProjectionRebuildTarget {
  rebuildProjection(networkId: string, items: readonly ProjectionReplayItem[]): Promise<void>;
}

export function decodeRawProtocolEventRow(row: RawProtocolEventRow): ProtocolEvent {
  const restored = restoreEventBigInts(row.event_body);
  const event = protocolEventSchema.parse(restored);
  const rowSlot = decimalBigInt(row.slot, 'slot');
  const rowBlockTime = dateString(row.block_time);

  if (
    event.networkId !== row.network_id ||
    event.transactionSignature !== row.transaction_signature ||
    (event.transactionIndex ?? null) !== row.transaction_index ||
    event.logIndex !== row.log_index ||
    event.slot !== rowSlot ||
    event.blockTime !== rowBlockTime ||
    event.type !== row.event_type
  ) {
    throw new IndexerRebuildError(
      'Raw event ledger metadata does not exactly match its stored event body.',
    );
  }
  return event;
}

export async function loadDurableRawEventLedger(
  databaseUrl: string,
  networkId: string,
  maximumEvents = MAXIMUM_INDEXER_REBUILD_EVENTS,
): Promise<DurableRawEventLedger> {
  const parsedNetworkId = networkIdSchema.parse(networkId);
  assertMaximumRebuildEvents(maximumEvents);
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => undefined,
  });

  try {
    const [ledgerSize] = await sql<{ event_count: string }[]>`
      SELECT count(*)::text AS event_count
      FROM protocol_events
      WHERE network_id = ${parsedNetworkId}
    `;
    if (
      ledgerSize === undefined ||
      decimalBigInt(ledgerSize.event_count, 'event_count') > BigInt(maximumEvents)
    ) {
      throw new IndexerRebuildError(
        `The durable raw-event ledger exceeds the bounded rebuild limit of ${String(maximumEvents)} events.`,
      );
    }
    const rows = await sql<RawProtocolEventRow[]>`
      SELECT
        event.network_id,
        event.transaction_signature,
        event.transaction_index,
        event.log_index,
        event.slot::text AS slot,
        event.block_time,
        event.event_type,
        event.event_body,
        event.manifest_pending,
        event.terminal_manifest_failure_code,
        dead_letter.event_body AS pending_event_body,
        dead_letter.failure_code AS pending_failure_code,
        dead_letter.failure_detail AS pending_failure_detail,
        dead_letter.next_attempt_at AS pending_next_attempt_at
      FROM protocol_events AS event
      LEFT JOIN indexer_dead_letters AS dead_letter
        ON event.manifest_pending
       AND dead_letter.network_id = event.network_id
       AND dead_letter.transaction_signature = event.transaction_signature
       AND dead_letter.log_index = event.log_index
      WHERE event.network_id = ${parsedNetworkId}
      LIMIT ${maximumEvents + 1}
    `;
    if (rows.length > maximumEvents) {
      throw new IndexerRebuildError(
        `The durable raw-event ledger exceeds the bounded rebuild limit of ${String(maximumEvents)} events.`,
      );
    }
    if (rows.length === 0) {
      throw new IndexerRebuildError(
        'No durable raw events exist for the requested network; refusing an empty rebuild.',
      );
    }
    const events = rows.map(decodeRawProtocolEventRow);
    assertUnambiguousEventOrder(events);
    events.sort(compareEventOrder);
    const eventsByCoordinate = new Map(
      events.map((event) => [rawEventCoordinateKey(event), event] as const),
    );
    const terminalFailureCodes = new Map<string, TerminalManifestFailureCode>();
    const dispositions = new Map<string, DurableRawEventDisposition>();
    for (const [index, row] of rows.entries()) {
      const event = eventsByCoordinate.get(
        rawEventCoordinateKey({
          networkId: row.network_id,
          transactionSignature: row.transaction_signature,
          logIndex: row.log_index,
        }),
      );
      if (event === undefined) {
        throw new IndexerRebuildError(
          `Raw event ledger disposition at row ${String(index)} has no event.`,
        );
      }
      const eventKey = rawEventCoordinateKey(event);
      const failureCode = row.terminal_manifest_failure_code;
      if (row.manifest_pending === true) {
        if (
          (failureCode !== undefined && failureCode !== null) ||
          row.pending_failure_code !== 'manifest-unavailable' ||
          !isRecord(row.pending_event_body) ||
          typeof row.pending_failure_detail !== 'string' ||
          row.pending_failure_detail.length === 0 ||
          row.pending_next_attempt_at === undefined ||
          row.pending_next_attempt_at === null
        ) {
          throw new IndexerRebuildError(
            'A pending raw manifest event does not have one matching retryable hydration record.',
          );
        }
        dispositions.set(eventKey, {
          state: 'pending',
          deferral: {
            eventBody: row.pending_event_body,
            failureCode: 'manifest-unavailable',
            failureDetail: row.pending_failure_detail,
            nextAttemptAt: dateString(row.pending_next_attempt_at),
          },
        });
        continue;
      }
      if (failureCode === undefined || failureCode === null) {
        dispositions.set(eventKey, { state: 'accepted' });
        continue;
      }
      if (!isTerminalManifestFailureCode(failureCode)) {
        throw new IndexerRebuildError(
          `Raw event ledger contains unknown terminal manifest failure code ${failureCode}.`,
        );
      }
      terminalFailureCodes.set(eventKey, failureCode);
      dispositions.set(eventKey, { state: 'terminal', failureCode });
    }
    return { events, terminalFailureCodes, dispositions };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function prepareIndexerRebuild(
  networkId: string,
  events: readonly ProtocolEvent[],
  source: ManifestSource,
  maximumEvents = MAXIMUM_INDEXER_REBUILD_EVENTS,
  profileSchemaV2ActivationSlot = 0n,
  terminalFailureCodes: ReadonlyMap<string, TerminalManifestFailureCode> = new Map(),
  durableDispositions?: ReadonlyMap<string, DurableRawEventDisposition>,
): Promise<PreparedIndexerRebuild> {
  const parsedNetworkId = networkIdSchema.parse(networkId);
  assertMaximumRebuildEvents(maximumEvents);
  if (events.length === 0) {
    throw new IndexerRebuildError('A projection rebuild requires at least one durable raw event.');
  }
  if (events.length > maximumEvents) {
    throw new IndexerRebuildError(
      `The projection rebuild exceeds the bounded limit of ${String(maximumEvents)} events.`,
    );
  }

  const ordered = events.map((event) => protocolEventSchema.parse(event));
  assertUnambiguousEventOrder(ordered);
  ordered.sort(compareEventOrder);
  if (ordered.some((event) => event.networkId !== parsedNetworkId)) {
    throw new IndexerRebuildError('A projection rebuild cannot cross network boundaries.');
  }
  if (
    durableDispositions !== undefined &&
    (durableDispositions.size !== ordered.length ||
      ordered.some((event) => !durableDispositions.has(rawEventCoordinateKey(event))))
  ) {
    throw new IndexerRebuildError(
      'Durable raw-event dispositions must exactly match supplied event coordinates.',
    );
  }

  const shadow = new MemoryProjectionStore();
  const verifier = new ManifestVerifier(source, new ProjectionRootKeyAuthorizer(shadow), {
    profileSchemaV2ActivationSlot,
  });
  const items: ProjectionReplayItem[] = [];
  const consumedTerminalFailures = new Set<string>();
  const consumedDurableDispositions = new Set<string>();
  const acceptedManifestSuppressions =
    durableDispositions === undefined
      ? new Map<string, AcceptedManifestSuppression>()
      : deriveAcceptedManifestSuppressions(
          ordered,
          (event) => durableDispositions.get(rawEventCoordinateKey(event))?.state === 'accepted',
        );
  try {
    for (const event of ordered) {
      const eventKey = rawEventCoordinateKey(event);
      const durableDisposition = durableDispositions?.get(eventKey);
      const terminalFailureCode = terminalFailureCodes.get(eventKey);
      if (durableDispositions !== undefined && durableDisposition === undefined) {
        throw new IndexerRebuildError(
          'Durable raw-event dispositions must exactly match supplied event coordinates.',
        );
      }
      if (durableDisposition?.state === 'pending') {
        if (terminalFailureCode !== undefined) {
          throw new IndexerRebuildError(
            'A durable pending event cannot also carry a terminal manifest classification.',
          );
        }
        await shadow.deferManifestEvent(event, durableDisposition.deferral);
        items.push({ event, pendingManifest: durableDisposition.deferral });
        consumedDurableDispositions.add(eventKey);
        continue;
      }
      if (durableDisposition?.state === 'terminal') {
        if (
          terminalFailureCode !== undefined &&
          terminalFailureCode !== durableDisposition.failureCode
        ) {
          throw new IndexerRebuildError(
            'Terminal manifest classifications disagree for one durable raw event.',
          );
        }
        if (terminalFailureCode !== undefined) {
          consumedTerminalFailures.add(eventKey);
        }
        await shadow.quarantineManifestEvent(event, {
          eventBody: {},
          failureCode: durableDisposition.failureCode,
          failureDetail: 'Loaded from the immutable raw-event ledger.',
        });
        items.push({ event, terminalFailureCode: durableDisposition.failureCode });
        consumedDurableDispositions.add(eventKey);
        continue;
      }
      if (terminalFailureCode !== undefined) {
        if (durableDisposition?.state === 'accepted') {
          throw new IndexerRebuildError(
            'A durable accepted event cannot also carry a terminal manifest classification.',
          );
        }
        await shadow.quarantineManifestEvent(event, {
          eventBody: {},
          failureCode: terminalFailureCode,
          failureDetail: 'Loaded from the immutable raw-event ledger.',
        });
        items.push({ event, terminalFailureCode });
        consumedTerminalFailures.add(eventKey);
        continue;
      }
      const acceptedManifestSuppression = acceptedManifestSuppressions.get(eventKey);
      if (acceptedManifestSuppression !== undefined) {
        if (durableDisposition?.state !== 'accepted') {
          throw new IndexerRebuildError(
            'Manifest I/O can be suppressed only for an explicitly durably accepted event.',
          );
        }
        await shadow.deferManifestEvent(event, {
          eventBody: { acceptedManifestSuppression },
          failureCode: 'manifest-unavailable',
          failureDetail:
            'Internal non-materializing shadow replay for a durably accepted obsolete manifest.',
          nextAttemptAt: event.blockTime,
        });
        items.push({ event, acceptedManifestSuppression });
        consumedDurableDispositions.add(eventKey);
        continue;
      }
      try {
        const manifest = await verifier.forEvent(event);
        await shadow.apply(event, manifest);
        items.push(manifest === undefined ? { event } : { event, manifest });
        if (durableDisposition?.state === 'accepted') {
          consumedDurableDispositions.add(eventKey);
        }
      } catch (error) {
        if (!isTerminalManifestVerificationError(error)) {
          throw error;
        }
        if (durableDisposition?.state === 'accepted') {
          throw new IndexerRebuildError(
            `Durably accepted event ${event.transactionSignature}:${String(event.logIndex)} now verifies as terminal ${error.code}; refusing disposition drift.`,
            { cause: error },
          );
        }
        await shadow.quarantineManifestEvent(event, {
          eventBody: {},
          failureCode: error.code,
          failureDetail: error.message,
        });
        items.push({ event, terminalFailureCode: error.code });
      }
    }
  } finally {
    await shadow.close();
  }
  if (consumedTerminalFailures.size !== terminalFailureCodes.size) {
    throw new IndexerRebuildError(
      'Terminal manifest classifications must exactly match supplied raw event coordinates.',
    );
  }
  if (
    durableDispositions !== undefined &&
    consumedDurableDispositions.size !== durableDispositions.size
  ) {
    throw new IndexerRebuildError(
      'Durable raw-event dispositions must exactly match supplied event coordinates.',
    );
  }

  const first = ordered[0];
  const last = ordered.at(-1);
  if (first === undefined || last === undefined) {
    throw new IndexerRebuildError('A projection rebuild requires at least one durable raw event.');
  }
  return {
    networkId: parsedNetworkId,
    items,
    eventCount: ordered.length,
    firstSlot: first.slot.toString(),
    lastSlot: last.slot.toString(),
    ledgerSha256: eventLedgerDigest(items),
  };
}

export async function validateAndMaybeApplyIndexerRebuild(options: {
  readonly networkId: string;
  readonly events: readonly ProtocolEvent[];
  readonly source: ManifestSource;
  readonly apply: boolean;
  readonly target?: ProjectionRebuildTarget;
  readonly profileSchemaV2ActivationSlot?: bigint;
  readonly terminalFailureCodes?: ReadonlyMap<string, TerminalManifestFailureCode>;
  readonly durableDispositions?: ReadonlyMap<string, DurableRawEventDisposition>;
}): Promise<IndexerRebuildSummary> {
  const prepared = await prepareIndexerRebuild(
    options.networkId,
    options.events,
    options.source,
    MAXIMUM_INDEXER_REBUILD_EVENTS,
    options.profileSchemaV2ActivationSlot,
    options.terminalFailureCodes,
    options.durableDispositions,
  );
  if (options.apply) {
    if (options.target === undefined) {
      throw new IndexerRebuildError('An apply rebuild requires an atomic projection target.');
    }
    await options.target.rebuildProjection(prepared.networkId, prepared.items);
  }
  return {
    mode: options.apply ? 'applied' : 'dry-run',
    networkId: prepared.networkId,
    eventCount: prepared.eventCount,
    firstSlot: prepared.firstSlot,
    lastSlot: prepared.lastSlot,
    ledgerSha256: prepared.ledgerSha256,
  };
}

export async function rebuildFromDurableLedger(options: {
  readonly databaseUrl: string;
  readonly contentStoragePath: string;
  readonly networkId: string;
  readonly apply: boolean;
  readonly profileSchemaV2ActivationSlot: bigint;
}): Promise<IndexerRebuildSummary> {
  const ledger = await loadDurableRawEventLedger(options.databaseUrl, options.networkId);
  const source = new LocalContentAddressedStorage({
    rootDirectory: options.contentStoragePath,
  });
  if (!options.apply) {
    return validateAndMaybeApplyIndexerRebuild({
      networkId: options.networkId,
      events: ledger.events,
      source,
      apply: false,
      profileSchemaV2ActivationSlot: options.profileSchemaV2ActivationSlot,
      durableDispositions: ledger.dispositions,
    });
  }

  const target = new PostgresProjectionStore(options.databaseUrl);
  try {
    return await validateAndMaybeApplyIndexerRebuild({
      networkId: options.networkId,
      events: ledger.events,
      source,
      apply: true,
      target,
      profileSchemaV2ActivationSlot: options.profileSchemaV2ActivationSlot,
      durableDispositions: ledger.dispositions,
    });
  } finally {
    await target.close();
  }
}

function restoreEventBigInts(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new IndexerRebuildError('Raw event ledger body must be a JSON object.');
  }
  const restored: Record<string, unknown> = { ...value };
  for (const field of BIGINT_EVENT_FIELDS) {
    if (field in restored) {
      restored[field] = decimalBigInt(restored[field], field);
    }
  }
  if ('recipientAmounts' in restored) {
    if (!Array.isArray(restored['recipientAmounts'])) {
      throw new IndexerRebuildError('Raw event recipientAmounts must be an array.');
    }
    restored['recipientAmounts'] = restored['recipientAmounts'].map((amount) =>
      decimalBigInt(amount, 'recipientAmounts'),
    );
  }
  return restored;
}

function assertMaximumRebuildEvents(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM_INDEXER_REBUILD_EVENTS) {
    throw new RangeError(
      `Maximum rebuild events must be between 1 and ${String(MAXIMUM_INDEXER_REBUILD_EVENTS)}.`,
    );
  }
}

function decimalBigInt(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new IndexerRebuildError(`Raw event ${field} must be a canonical unsigned integer.`);
  }
  return BigInt(value);
}

function eventLedgerDigest(items: readonly ProjectionReplayItem[]): string {
  return createHash('sha256')
    .update(
      stableJson(
        items.map(
          ({ event, acceptedManifestSuppression, pendingManifest, terminalFailureCode }) => ({
            event,
            manifestDisposition:
              terminalFailureCode === undefined
                ? pendingManifest === undefined
                  ? acceptedManifestSuppression === undefined
                    ? 'accepted'
                    : {
                        state: 'accepted',
                        acceptedManifestSuppression,
                      }
                  : 'pending'
                : { state: 'terminal', failureCode: terminalFailureCode },
          }),
        ),
      ),
      'utf8',
    )
    .digest('hex');
}

export function rawEventCoordinateKey(event: {
  readonly networkId: string;
  readonly transactionSignature: string;
  readonly logIndex: number;
}): string {
  return replayEventCoordinateKey(event);
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJsonValue(value[key])]),
    );
  }
  return value;
}

function dateString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new IndexerRebuildError('Raw event block time is invalid.');
  }
  return date.toISOString();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

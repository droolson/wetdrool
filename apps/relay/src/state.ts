import { createHash } from 'node:crypto';

import { RELAY_POLICY, type RelayKeyAuthorizationMode } from './policy.js';
import type { SignedRelayEvent } from './protocol.js';
import type { RelayEventFrame } from './wire.js';

interface ExpiringHeapEntry {
  readonly expiresAt: number;
  heapIndex: number;
}

interface RateLimitEntry extends ExpiringHeapEntry {
  count: number;
  readonly key: string;
}

export class SlidingWindowRateLimiter {
  readonly #entries = new Map<string, RateLimitEntry>();
  readonly #expirations: ExpirationMinHeap<RateLimitEntry>;
  #maintenanceOperations = 0;

  constructor(
    private readonly maximum: number,
    private readonly windowMilliseconds: number,
    private readonly maximumKeys = 20_000,
  ) {
    assertPositiveSafeInteger(maximum, 'rate-limit maximum');
    assertPositiveSafeInteger(windowMilliseconds, 'rate-limit window');
    assertPositiveSafeInteger(maximumKeys, 'rate-limit key capacity');
    this.#expirations = new ExpirationMinHeap(() => {
      this.#maintenanceOperations += 1;
    });
  }

  allow(key: string, now: number): boolean {
    this.#prune(now);
    const current = this.#entries.get(key);
    if (current === undefined) {
      this.#makeSpace();
      const entry: RateLimitEntry = {
        count: 1,
        expiresAt: now + this.windowMilliseconds,
        heapIndex: -1,
        key,
      };
      this.#entries.set(key, entry);
      this.#expirations.push(entry);
      return true;
    }
    if (current.count >= this.maximum) {
      return false;
    }
    current.count += 1;
    return true;
  }

  get size(): number {
    return this.#entries.size;
  }

  get maintenanceOperations(): number {
    return this.#maintenanceOperations;
  }

  #prune(now: number): void {
    for (;;) {
      const next = this.#expirations.peek();
      if (next === undefined || next.expiresAt > now) {
        return;
      }
      const expired = this.#expirations.popMinimum();
      if (expired !== undefined && this.#entries.get(expired.key) === expired) {
        this.#entries.delete(expired.key);
      }
    }
  }

  #makeSpace(): void {
    while (this.#entries.size >= this.maximumKeys) {
      const oldestKey = this.#entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        return;
      }
      const oldest = this.#entries.get(oldestKey);
      this.#entries.delete(oldestKey);
      if (oldest === undefined) {
        return;
      }
      this.#maintenanceOperations += 1;
      this.#expirations.remove(oldest);
    }
  }
}

interface ReplayEntry extends ExpiringHeapEntry {
  readonly key: string;
}

export class ReplayWindow {
  readonly #nonces = new Map<string, ReplayEntry>();
  readonly #expirations: ExpirationMinHeap<ReplayEntry>;
  #maintenanceOperations = 0;

  constructor(private readonly maximumNonces: number = RELAY_POLICY.retention.maximumReplayNonces) {
    assertPositiveSafeInteger(maximumNonces, 'replay nonce capacity');
    this.#expirations = new ExpirationMinHeap(() => {
      this.#maintenanceOperations += 1;
    });
  }

  accept(identity: string, nonce: string, expiresAt: number, now: number): boolean {
    this.#prune(now);
    const key = privacyHash(`${identity}\0${nonce}`);
    if (this.#nonces.has(key)) {
      return false;
    }
    this.#makeSpace();
    const entry: ReplayEntry = {
      expiresAt,
      heapIndex: -1,
      key,
    };
    this.#nonces.set(key, entry);
    this.#expirations.push(entry);
    return true;
  }

  get size(): number {
    return this.#nonces.size;
  }

  get maintenanceOperations(): number {
    return this.#maintenanceOperations;
  }

  #makeSpace(): void {
    while (this.#nonces.size >= this.maximumNonces) {
      const oldestKey = this.#nonces.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        return;
      }
      const oldest = this.#nonces.get(oldestKey);
      this.#nonces.delete(oldestKey);
      if (oldest === undefined) {
        return;
      }
      this.#maintenanceOperations += 1;
      this.#expirations.remove(oldest);
    }
  }

  #prune(now: number): void {
    for (;;) {
      const next = this.#expirations.peek();
      if (next === undefined || next.expiresAt > now) {
        return;
      }
      const expired = this.#expirations.popMinimum();
      if (expired !== undefined && this.#nonces.get(expired.key) === expired) {
        this.#nonces.delete(expired.key);
      }
    }
  }
}

class ExpirationMinHeap<TEntry extends ExpiringHeapEntry> {
  readonly #entries: TEntry[] = [];

  constructor(private readonly onMaintenanceOperation: () => void) {}

  peek(): TEntry | undefined {
    return this.#entries[0];
  }

  push(entry: TEntry): void {
    entry.heapIndex = this.#entries.length;
    this.#entries.push(entry);
    this.#bubbleUp(entry.heapIndex);
  }

  popMinimum(): TEntry | undefined {
    return this.#removeAt(0);
  }

  remove(entry: TEntry): void {
    const index = entry.heapIndex;
    if (index < 0 || this.#entries[index] !== entry) {
      return;
    }
    this.#removeAt(index);
  }

  #removeAt(index: number): TEntry | undefined {
    const removed = this.#entries[index];
    if (removed === undefined) {
      return undefined;
    }
    const replacement = this.#entries.pop();
    removed.heapIndex = -1;
    this.onMaintenanceOperation();
    if (replacement === undefined || replacement === removed) {
      return removed;
    }
    this.#entries[index] = replacement;
    replacement.heapIndex = index;
    const parentIndex = Math.floor((index - 1) / 2);
    if (index > 0 && this.#lessThan(replacement, this.#entries[parentIndex] as TEntry)) {
      this.#bubbleUp(index);
    } else {
      this.#bubbleDown(index);
    }
    return removed;
  }

  #bubbleUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const entry = this.#entries[index];
      const parent = this.#entries[parentIndex];
      if (entry === undefined || parent === undefined || !this.#lessThan(entry, parent)) {
        return;
      }
      this.#swap(index, parentIndex);
      index = parentIndex;
    }
  }

  #bubbleDown(startIndex: number): void {
    let index = startIndex;
    for (;;) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let minimumIndex = index;
      const left = this.#entries[leftIndex];
      const minimum = this.#entries[minimumIndex];
      if (left !== undefined && minimum !== undefined && this.#lessThan(left, minimum)) {
        minimumIndex = leftIndex;
      }
      const right = this.#entries[rightIndex];
      const nextMinimum = this.#entries[minimumIndex];
      if (right !== undefined && nextMinimum !== undefined && this.#lessThan(right, nextMinimum)) {
        minimumIndex = rightIndex;
      }
      if (minimumIndex === index) {
        return;
      }
      this.#swap(index, minimumIndex);
      index = minimumIndex;
    }
  }

  #lessThan(left: TEntry, right: TEntry): boolean {
    this.onMaintenanceOperation();
    return left.expiresAt < right.expiresAt;
  }

  #swap(leftIndex: number, rightIndex: number): void {
    const left = this.#entries[leftIndex];
    const right = this.#entries[rightIndex];
    if (left === undefined || right === undefined) {
      return;
    }
    this.onMaintenanceOperation();
    this.#entries[leftIndex] = right;
    this.#entries[rightIndex] = left;
    right.heapIndex = leftIndex;
    left.heapIndex = rightIndex;
  }
}

export interface RetainedEvent {
  readonly frame: RelayEventFrame;
  readonly topic: string;
  readonly expiresAt: number;
}

export class EphemeralEventStore {
  readonly #events: RetainedEvent[] = [];

  add(frame: RelayEventFrame, envelope: SignedRelayEvent, now: number): void {
    if (!isRetainable(envelope.message.kind)) {
      return;
    }
    this.#prune(now);
    const record = {
      frame,
      topic: envelope.message.topic,
      expiresAt: Math.min(
        Date.parse(envelope.message.expiresAt),
        now + RELAY_POLICY.retention.maximumMilliseconds,
      ),
    };
    this.#events.push(record);

    let topicCount = 0;
    for (let index = this.#events.length - 1; index >= 0; index -= 1) {
      const event = this.#events[index];
      if (event?.topic !== record.topic) {
        continue;
      }
      topicCount += 1;
      if (topicCount > RELAY_POLICY.retention.maximumEventsPerTopic) {
        this.#events.splice(index, 1);
      }
    }
    if (this.#events.length > RELAY_POLICY.retention.maximumEvents) {
      this.#events.splice(0, this.#events.length - RELAY_POLICY.retention.maximumEvents);
    }
  }

  replay(
    topic: string,
    sinceSequence: number | undefined,
    now: number,
  ): readonly RelayEventFrame[] {
    this.#prune(now);
    return this.#events
      .filter(
        (entry) =>
          entry.topic === topic &&
          (sinceSequence === undefined || entry.frame.relaySequence > sinceSequence),
      )
      .map((entry) => ({ ...entry.frame, retained: true }));
  }

  get size(): number {
    return this.#events.length;
  }

  #prune(now: number): void {
    let write = 0;
    for (const event of this.#events) {
      if (event.expiresAt > now) {
        this.#events[write] = event;
        write += 1;
      }
    }
    this.#events.length = write;
  }
}

export interface RelayMetricsSnapshot {
  readonly activeConnections: number;
  readonly acceptedConnections: number;
  readonly rejectedConnections: number;
  readonly acceptedEvents: number;
  readonly rejectedFrames: number;
  readonly replayRejections: number;
  readonly rateLimitRejections: number;
  readonly backpressureDisconnects: number;
  readonly retainedEvents: number;
}

export class RelayMetrics {
  activeConnections = 0;
  acceptedConnections = 0;
  rejectedConnections = 0;
  acceptedEvents = 0;
  rejectedFrames = 0;
  replayRejections = 0;
  rateLimitRejections = 0;
  backpressureDisconnects = 0;

  snapshot(retainedEvents: number): RelayMetricsSnapshot {
    return {
      activeConnections: this.activeConnections,
      acceptedConnections: this.acceptedConnections,
      rejectedConnections: this.rejectedConnections,
      acceptedEvents: this.acceptedEvents,
      rejectedFrames: this.rejectedFrames,
      replayRejections: this.replayRejections,
      rateLimitRejections: this.rateLimitRejections,
      backpressureDisconnects: this.backpressureDisconnects,
      retainedEvents,
    };
  }

  prometheus(
    relayId: string,
    retainedEvents: number,
    keyAuthorization: RelayKeyAuthorizationMode,
  ): string {
    const values = this.snapshot(retainedEvents);
    const prefix = 'wetdrool_relay_';
    const lines = [
      '# HELP wetdrool_relay_info Relay service metadata.',
      '# TYPE wetdrool_relay_info gauge',
      `${prefix}info{relay_id="${escapePrometheus(relayId)}",canonical="false",key_authorization="${keyAuthorization}"} 1`,
    ];
    for (const [name, value] of Object.entries(values)) {
      const metricName = name.replace(/[A-Z]/gu, (match) => `_${match.toLowerCase()}`);
      const gauge = name === 'activeConnections' || name === 'retainedEvents';
      const fullName = `${prefix}${metricName}${gauge ? '' : '_total'}`;
      lines.push(
        `# TYPE ${fullName} ${gauge ? 'gauge' : 'counter'}`,
        `${fullName} ${String(value)}`,
      );
    }
    return `${lines.join('\n')}\n`;
  }
}

export function privacyHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function isRetainable(kind: SignedRelayEvent['message']['kind']): boolean {
  return ['community-update', 'encrypted-message', 'live-reaction', 'new-post'].includes(kind);
}

function escapePrometheus(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
}

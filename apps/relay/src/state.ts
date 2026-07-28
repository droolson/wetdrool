import { createHash } from 'node:crypto';

import { RELAY_POLICY, type RelayKeyAuthorizationMode } from './policy.js';
import type { SignedRelayEvent } from './protocol.js';
import type { RelayEventFrame } from './wire.js';

export class SlidingWindowRateLimiter {
  readonly #entries = new Map<string, { count: number; windowStartedAt: number }>();

  constructor(
    private readonly maximum: number,
    private readonly windowMilliseconds: number,
    private readonly maximumKeys = 20_000,
  ) {}

  allow(key: string, now: number): boolean {
    this.#prune(now);
    const current = this.#entries.get(key);
    if (current === undefined || current.windowStartedAt + this.windowMilliseconds <= now) {
      this.#entries.set(key, { count: 1, windowStartedAt: now });
      return true;
    }
    if (current.count >= this.maximum) {
      return false;
    }
    current.count += 1;
    return true;
  }

  #prune(now: number): void {
    if (this.#entries.size < this.maximumKeys) {
      return;
    }
    for (const [key, entry] of this.#entries) {
      if (entry.windowStartedAt + this.windowMilliseconds <= now) {
        this.#entries.delete(key);
      }
    }
    while (this.#entries.size >= this.maximumKeys) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) {
        return;
      }
      this.#entries.delete(oldest);
    }
  }
}

export class ReplayWindow {
  readonly #nonces = new Map<string, number>();

  accept(identity: string, nonce: string, expiresAt: number, now: number): boolean {
    this.#prune(now);
    const key = privacyHash(`${identity}\0${nonce}`);
    if (this.#nonces.has(key)) {
      return false;
    }
    this.#nonces.set(key, expiresAt);
    while (this.#nonces.size > RELAY_POLICY.retention.maximumReplayNonces) {
      const oldest = this.#nonces.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.#nonces.delete(oldest);
    }
    return true;
  }

  #prune(now: number): void {
    for (const [key, expiresAt] of this.#nonces) {
      if (expiresAt <= now) {
        this.#nonces.delete(key);
      }
    }
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
    const prefix = 'socially_woke_relay_';
    const lines = [
      '# HELP socially_woke_relay_info Relay service metadata.',
      '# TYPE socially_woke_relay_info gauge',
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

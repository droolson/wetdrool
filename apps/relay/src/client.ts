import WebSocket, { type RawData } from 'ws';

import { RELAY_PATH, RELAY_POLICY } from './policy.js';
import {
  verifyRelayEvent,
  verifySubscription,
  type RelayEventKind,
  type RelayKeyAuthorizer,
  type SignedRelayEvent,
  type SignedSubscription,
} from './protocol.js';
import { relayServerFrameSchema, type RelayEventFrame, type RelayServerFrame } from './wire.js';

export type RelayClientStatus =
  'closed' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface RelayEndpointStatus {
  readonly url: string;
  readonly failures: number;
  readonly cooldownUntil: number;
  readonly lastConnectedAt?: number;
}

export interface RelayGap {
  readonly relayId: string;
  readonly expectedSequence: number;
  readonly receivedSequence: number;
}

export interface MultiRelayClientOptions {
  readonly urls: readonly string[];
  readonly subscriptionFactory: (
    input: Readonly<{
      endpoint: string;
      lastSequenceByRelay: ReadonlyMap<string, number>;
    }>,
  ) => SignedSubscription | Promise<SignedSubscription>;
  readonly authorizeEventKey?: RelayKeyAuthorizer;
  readonly dangerouslyAllowUnverifiedAdvisoryEvents?: boolean;
  readonly onEvent: (frame: RelayEventFrame) => void | Promise<void>;
  readonly onGap?: (gap: RelayGap) => void;
  readonly onStatus?: (
    status: RelayClientStatus,
    detail: Readonly<{ endpoint?: string; reason?: string }>,
  ) => void;
  readonly handshakeTimeoutMilliseconds?: number;
  readonly reconnectBaseMilliseconds?: number;
  readonly reconnectMaximumMilliseconds?: number;
  readonly now?: () => Date;
}

interface EndpointHealth {
  readonly url: string;
  readonly order: number;
  failures: number;
  cooldownUntil: number;
  lastConnectedAt?: number;
  relayId?: string;
}

interface QueuedServerFrame {
  readonly bytes: Uint8Array;
  readonly isBinary: boolean;
}

interface VerifiedSubscriptionScope {
  readonly expiresAt: number;
  readonly identity: string;
  readonly topics: ReadonlyMap<string, ReadonlySet<RelayEventKind>>;
}

export class MultiRelayClient {
  readonly #endpoints: EndpointHealth[];
  readonly #lastSequenceByRelay = new Map<string, number>();
  readonly #seenEventIds = new Map<string, number>();
  readonly #now: () => Date;
  #socket: WebSocket | undefined;
  #activeEndpoint: string | undefined;
  #status: RelayClientStatus = 'closed';
  #desired = false;
  #connecting: Promise<void> | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #generation = 0;

  constructor(private readonly options: MultiRelayClientOptions) {
    if (
      options.authorizeEventKey === undefined &&
      options.dangerouslyAllowUnverifiedAdvisoryEvents !== true
    ) {
      throw new TypeError(
        'Relay clients require a key authorizer before application delivery. ' +
          'Only isolated local tests may opt into dangerouslyAllowUnverifiedAdvisoryEvents.',
      );
    }
    if (
      options.authorizeEventKey !== undefined &&
      options.dangerouslyAllowUnverifiedAdvisoryEvents === true
    ) {
      throw new TypeError(
        'Choose verified client key authorization or dangerous unverified advisory delivery, never both.',
      );
    }
    if (options.urls.length === 0) {
      throw new TypeError('At least one relay URL is required.');
    }
    this.#endpoints = [...new Set(options.urls.map(normalizeRelayUrl))].map((url, order) => ({
      url,
      order,
      failures: 0,
      cooldownUntil: 0,
    }));
    this.#now = options.now ?? (() => new Date());
  }

  get status(): RelayClientStatus {
    return this.#status;
  }

  get activeEndpoint(): string | undefined {
    return this.#activeEndpoint;
  }

  endpointHealth(): readonly RelayEndpointStatus[] {
    return this.#endpoints.map((endpoint) => ({
      url: endpoint.url,
      failures: endpoint.failures,
      cooldownUntil: endpoint.cooldownUntil,
      ...(endpoint.lastConnectedAt === undefined
        ? {}
        : { lastConnectedAt: endpoint.lastConnectedAt }),
    }));
  }

  lastSequenceByRelay(): ReadonlyMap<string, number> {
    return new Map(this.#lastSequenceByRelay);
  }

  async connect(): Promise<void> {
    this.#desired = true;
    if (this.#socket?.readyState === WebSocket.OPEN && this.#status === 'connected') {
      return;
    }
    if (this.#connecting !== undefined) {
      return this.#connecting;
    }
    const generation = ++this.#generation;
    this.#setStatus(this.#status === 'closed' ? 'connecting' : 'reconnecting', {});
    this.#connecting = this.#connectAvailable(generation).finally(() => {
      this.#connecting = undefined;
      if (this.#desired && this.#status === 'disconnected') {
        this.#scheduleReconnect();
      }
    });
    return this.#connecting;
  }

  publish(envelope: SignedRelayEvent): void {
    const socket = this.#socket;
    if (
      socket === undefined ||
      socket.readyState !== WebSocket.OPEN ||
      this.#status !== 'connected'
    ) {
      throw new RelayClientError('No relay connection is ready.', 'not-connected');
    }
    socket.send(JSON.stringify({ op: 'publish', envelope }));
  }

  async close(): Promise<void> {
    this.#desired = false;
    this.#generation += 1;
    if (this.#reconnectTimer !== undefined) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    const socket = this.#socket;
    this.#socket = undefined;
    this.#activeEndpoint = undefined;
    if (
      socket !== undefined &&
      socket.readyState !== WebSocket.CLOSED &&
      socket.readyState !== WebSocket.CLOSING
    ) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          socket.terminate();
          resolve();
        }, 1_000);
        timeout.unref();
        socket.once('close', () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.close(1000, 'client closed');
      });
    }
    this.#setStatus('closed', {});
  }

  async #connectAvailable(generation: number): Promise<void> {
    const failures: string[] = [];
    for (const endpoint of this.#orderedEndpoints()) {
      if (!this.#desired || generation !== this.#generation) {
        throw new RelayClientError('Relay connection was cancelled.', 'cancelled');
      }
      try {
        await this.#connectEndpoint(endpoint, generation);
        return;
      } catch (error) {
        this.#markFailure(endpoint);
        failures.push(`${endpoint.url}: ${errorMessage(error)}`);
      }
    }
    this.#setStatus('disconnected', { reason: 'all-endpoints-failed' });
    this.#scheduleReconnect();
    throw new RelayClientError(
      `Every relay endpoint failed: ${failures.join('; ')}`,
      'all-endpoints-failed',
    );
  }

  async #connectEndpoint(endpoint: EndpointHealth, generation: number): Promise<void> {
    const socket = new WebSocket(endpoint.url, {
      maxPayload: 64 * 1_024,
      perMessageDeflate: false,
    });
    const handshakeTimeout = this.options.handshakeTimeoutMilliseconds ?? 5_000;
    let helloReceived = false;
    let settled = false;
    let connectionClosed = false;
    let negotiatedRelayId: string | undefined;
    let expectedSubscription:
      | Readonly<{
          expiresAt: string;
          scope: VerifiedSubscriptionScope;
          subscriptionId: string;
          topicCount: number;
        }>
      | undefined;

    await new Promise<void>((resolve, reject) => {
      const pendingFrames: QueuedServerFrame[] = [];
      let processingFrames = false;
      const timer = setTimeout(() => {
        fail(new RelayClientError('Relay handshake timed out.', 'handshake-timeout'));
      }, handshakeTimeout);
      timer.unref();

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        connectionClosed = true;
        pendingFrames.length = 0;
        clearTimeout(timer);
        socket.terminate();
        reject(error);
      };

      const handshakeOpen = () =>
        !connectionClosed &&
        this.#desired &&
        generation === this.#generation &&
        socket.readyState === WebSocket.OPEN;
      const activeConnection = () => handshakeOpen() && settled && socket === this.#socket;
      const abortConnection = (error: Error, closeCode = 4002, reason = 'invalid relay frame') => {
        pendingFrames.length = 0;
        if (!settled) {
          fail(error);
          return;
        }
        connectionClosed = true;
        socket.close(closeCode, reason);
      };

      const processFrame = async (queued: QueuedServerFrame): Promise<void> => {
        const frame = await this.#parseServerFrame(queued.bytes, queued.isBinary);
        if (!helloReceived) {
          if (frame.op !== 'hello') {
            throw new RelayClientError('Relay sent data before hello.', 'invalid-server-frame');
          }
          if (endpoint.relayId !== undefined && endpoint.relayId !== frame.relayId) {
            throw new RelayClientError(
              'Relay identity changed for a configured endpoint.',
              'invalid-server-frame',
            );
          }
          negotiatedRelayId = frame.relayId;
          helloReceived = true;
          const authorization = await this.options.subscriptionFactory({
            endpoint: endpoint.url,
            lastSequenceByRelay: this.lastSequenceByRelay(),
          });
          const verified = await verifySubscription(authorization, { now: this.#now });
          if (!handshakeOpen()) {
            return;
          }
          const verifiedMessage = verified.envelope.message;
          expectedSubscription = {
            expiresAt: verifiedMessage.expiresAt,
            scope: subscriptionScope(verified.envelope),
            subscriptionId: verified.subscriptionId,
            topicCount: verifiedMessage.subscriptions.length,
          };
          socket.send(JSON.stringify({ op: 'subscribe', authorization: verified.envelope }));
          return;
        }
        if (!settled && frame.op === 'subscribed') {
          if (
            expectedSubscription === undefined ||
            frame.subscriptionId !== expectedSubscription.subscriptionId ||
            frame.topicCount !== expectedSubscription.topicCount ||
            frame.expiresAt !== expectedSubscription.expiresAt
          ) {
            throw new RelayClientError(
              'Relay acknowledged a different subscription.',
              'invalid-server-frame',
            );
          }
          if (negotiatedRelayId === undefined) {
            throw new RelayClientError(
              'Relay identity was not negotiated.',
              'invalid-server-frame',
            );
          }
          settled = true;
          clearTimeout(timer);
          this.#socket = socket;
          this.#activeEndpoint = endpoint.url;
          endpoint.relayId = negotiatedRelayId;
          endpoint.failures = 0;
          endpoint.cooldownUntil = 0;
          endpoint.lastConnectedAt = this.#now().getTime();
          this.#setStatus('connected', { endpoint: endpoint.url });
          resolve();
          return;
        }
        if (!settled && frame.op === 'error') {
          throw new RelayClientError(
            `Relay rejected handshake: ${frame.code}`,
            'handshake-rejected',
          );
        }
        if (!settled) {
          throw new RelayClientError(
            'Relay sent data before subscription acknowledgement.',
            'invalid-server-frame',
          );
        }
        if (!activeConnection()) {
          return;
        }
        if (expectedSubscription === undefined) {
          throw new RelayClientError(
            'Relay connection has no verified subscription scope.',
            'invalid-server-frame',
          );
        }
        await this.#handleServerFrame(
          frame,
          negotiatedRelayId,
          expectedSubscription.scope,
          activeConnection,
        );
      };

      const drainFrames = async (): Promise<void> => {
        try {
          while (!connectionClosed) {
            const queued = pendingFrames.shift();
            if (queued === undefined) {
              return;
            }
            await processFrame(queued);
          }
        } catch (error) {
          abortConnection(
            error instanceof Error
              ? error
              : new RelayClientError('Invalid relay frame.', 'invalid-server-frame'),
          );
        } finally {
          processingFrames = false;
          if (!connectionClosed && pendingFrames.length > 0) {
            processingFrames = true;
            void drainFrames();
          }
        }
      };

      socket.on('message', (data, isBinary) => {
        if (connectionClosed) {
          return;
        }
        if (pendingFrames.length >= RELAY_POLICY.connection.maximumPendingFrames) {
          abortConnection(
            new RelayClientError('Relay exceeded the bounded inbound frame queue.', 'backpressure'),
            4008,
            'inbound backpressure',
          );
          return;
        }
        pendingFrames.push({
          bytes: Uint8Array.from(rawDataBytes(data)),
          isBinary,
        });
        if (!processingFrames) {
          processingFrames = true;
          void drainFrames();
        }
      });
      socket.once('error', () => {
        fail(new RelayClientError('Relay WebSocket failed.', 'connection-failed'));
      });
      socket.once('close', () => {
        connectionClosed = true;
        pendingFrames.length = 0;
        if (!settled) {
          fail(new RelayClientError('Relay closed during handshake.', 'connection-closed'));
        }
      });
    });

    socket.once('close', (_code, reason) => {
      if (generation !== this.#generation || socket !== this.#socket) {
        return;
      }
      this.#socket = undefined;
      this.#activeEndpoint = undefined;
      this.#markFailure(endpoint);
      this.#setStatus('disconnected', {
        endpoint: endpoint.url,
        reason: safeCloseReason(reason),
      });
      this.#scheduleReconnect();
    });
    socket.on('error', () => {
      // Close drives failover. Error details are intentionally not surfaced because implementations
      // can include endpoint or proxy data that callers may accidentally log.
    });
  }

  async #parseServerFrame(data: Uint8Array, isBinary: boolean): Promise<RelayServerFrame> {
    if (isBinary) {
      throw new RelayClientError('Relay sent an unsupported binary frame.', 'invalid-server-frame');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    } catch {
      throw new RelayClientError('Relay sent invalid UTF-8 JSON.', 'invalid-server-frame');
    }
    const parsed = relayServerFrameSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new RelayClientError('Relay sent an invalid server frame.', 'invalid-server-frame');
    }
    return parsed.data;
  }

  async #handleServerFrame(
    frame: RelayServerFrame,
    negotiatedRelayId: string | undefined,
    subscription: VerifiedSubscriptionScope,
    activeConnection: () => boolean,
  ): Promise<void> {
    if (frame.op !== 'event') {
      return;
    }
    if (negotiatedRelayId === undefined || frame.relayId !== negotiatedRelayId) {
      throw new RelayClientError(
        'Relay event identity does not match the negotiated endpoint.',
        'invalid-event',
      );
    }
    const verified = await verifyRelayEvent(frame.envelope, {
      now: this.#now,
      ...(this.options.authorizeEventKey === undefined
        ? {}
        : { authorize: this.options.authorizeEventKey }),
    });
    if (!activeConnection()) {
      return;
    }
    if (verified.eventId !== frame.eventId) {
      throw new RelayClientError('Relay event ID does not match its envelope.', 'invalid-event');
    }
    if (!eventIsWithinSubscriptionScope(verified.envelope, subscription, this.#now().getTime())) {
      throw new RelayClientError(
        'Relay delivered an event outside the verified subscription scope.',
        'invalid-event',
      );
    }
    const previous = this.#lastSequenceByRelay.get(frame.relayId);
    if (previous !== undefined && frame.relaySequence <= previous) {
      return;
    }
    if (previous !== undefined && frame.relaySequence > previous + 1) {
      this.options.onGap?.({
        relayId: frame.relayId,
        expectedSequence: previous + 1,
        receivedSequence: frame.relaySequence,
      });
    }

    this.#pruneDedupe();
    if (this.#seenEventIds.has(frame.eventId)) {
      // The application already accepted this signed event through another
      // relay, so advancing this relay-local cursor cannot lose delivery.
      this.#lastSequenceByRelay.set(frame.relayId, frame.relaySequence);
      return;
    }

    if (!activeConnection()) {
      return;
    }
    await this.options.onEvent(frame);
    // Commit relay-local delivery state only after the application callback
    // succeeds. A callback failure closes the socket and allows reconciliation
    // to retry instead of silently checkpointing an undelivered event.
    this.#lastSequenceByRelay.set(frame.relayId, frame.relaySequence);
    this.#seenEventIds.set(frame.eventId, Date.parse(frame.envelope.message.expiresAt));
    while (this.#seenEventIds.size > 10_000) {
      const oldest = this.#seenEventIds.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.#seenEventIds.delete(oldest);
    }
  }

  #orderedEndpoints(): EndpointHealth[] {
    const now = this.#now().getTime();
    return [...this.#endpoints].sort((left, right) => {
      const leftCooling = left.cooldownUntil > now;
      const rightCooling = right.cooldownUntil > now;
      if (leftCooling !== rightCooling) {
        return leftCooling ? 1 : -1;
      }
      if (left.failures !== right.failures) {
        return left.failures - right.failures;
      }
      return left.order - right.order;
    });
  }

  #markFailure(endpoint: EndpointHealth): void {
    endpoint.failures += 1;
    const base = this.options.reconnectBaseMilliseconds ?? 250;
    const maximum = this.options.reconnectMaximumMilliseconds ?? 30_000;
    const delay = Math.min(maximum, base * 2 ** Math.min(endpoint.failures - 1, 10));
    endpoint.cooldownUntil = this.#now().getTime() + delay;
  }

  #scheduleReconnect(): void {
    if (!this.#desired || this.#reconnectTimer !== undefined || this.#connecting !== undefined) {
      return;
    }
    const now = this.#now().getTime();
    const earliest = Math.min(...this.#endpoints.map((endpoint) => endpoint.cooldownUntil));
    const delay = Math.max(0, earliest - now);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.connect().catch(() => undefined);
    }, delay);
    this.#reconnectTimer.unref();
  }

  #pruneDedupe(): void {
    const now = this.#now().getTime();
    for (const [eventId, expiresAt] of this.#seenEventIds) {
      if (expiresAt <= now) {
        this.#seenEventIds.delete(eventId);
      }
    }
  }

  #setStatus(
    status: RelayClientStatus,
    detail: Readonly<{ endpoint?: string; reason?: string }>,
  ): void {
    this.#status = status;
    this.options.onStatus?.(status, detail);
  }
}

export class RelayClientError extends Error {
  override readonly name = 'RelayClientError';

  constructor(
    message: string,
    readonly code:
      | 'all-endpoints-failed'
      | 'backpressure'
      | 'cancelled'
      | 'connection-closed'
      | 'connection-failed'
      | 'handshake-rejected'
      | 'handshake-timeout'
      | 'invalid-event'
      | 'invalid-server-frame'
      | 'not-connected',
  ) {
    super(message);
  }
}

function normalizeRelayUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Relay URL is invalid.');
  }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError('Relay URLs must be credential-free ws:// or wss:// URLs.');
  }
  if (url.pathname === '' || url.pathname === '/') {
    url.pathname = RELAY_PATH;
  }
  if (url.pathname !== RELAY_PATH || url.search) {
    throw new TypeError(`Relay URLs must use the ${RELAY_PATH} endpoint without a query.`);
  }
  return url.toString();
}

function rawDataBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  return new Uint8Array(data);
}

function safeCloseReason(reason: Buffer): string {
  const value = reason.toString('utf8');
  return /^[A-Za-z0-9 ._-]{1,80}$/u.test(value) ? value : 'connection-closed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function subscriptionScope(subscription: SignedSubscription): VerifiedSubscriptionScope {
  return {
    expiresAt: Date.parse(subscription.message.expiresAt),
    identity: subscription.message.identity,
    topics: new Map(
      subscription.message.subscriptions.map(({ kinds, topic }) => [topic, new Set(kinds)]),
    ),
  };
}

export function eventIsWithinSignedSubscription(
  event: SignedRelayEvent,
  subscription: SignedSubscription,
  now: Date,
): boolean {
  return eventIsWithinSubscriptionScope(event, subscriptionScope(subscription), now.getTime());
}

function eventIsWithinSubscriptionScope(
  event: SignedRelayEvent,
  subscription: VerifiedSubscriptionScope,
  now: number,
): boolean {
  if (subscription.expiresAt <= now) {
    return false;
  }
  const topic = subscription.topics.get(event.message.topic);
  if (topic === undefined || !topic.has(event.message.kind)) {
    return false;
  }
  const audience = event.message.audience;
  return (
    audience.kind !== 'identity' ||
    event.message.identity === subscription.identity ||
    audience.recipients.includes(subscription.identity)
  );
}

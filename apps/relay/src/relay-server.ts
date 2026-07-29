import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import type { Duplex } from 'node:stream';

import WebSocket, { WebSocketServer, type RawData } from 'ws';

import {
  createTrustedProxyPolicy,
  type TrustedProxyPolicy,
} from '@wokesocial/config/trusted-proxy';
import type { RateLimiter } from '@wokesocial/rate-limit';

import {
  RELAY_PATH,
  RELAY_POLICY,
  RELAY_PROTOCOL_VERSION,
  publicRelayPolicy,
  type RelayKeyAuthorizationMode,
} from './policy.js';
import {
  assertRelayMessageCurrent,
  RelayProtocolError,
  verifyRelayEvent,
  verifySubscription,
  type RelayEventKind,
  type RelayKeyAuthorizer,
  type SignedRelayEvent,
} from './protocol.js';
import {
  EphemeralEventStore,
  privacyHash,
  RelayMetrics,
  ReplayWindow,
  SlidingWindowRateLimiter,
} from './state.js';
import {
  relayClientFrameSchema,
  type RelayErrorCode,
  type RelayErrorFrame,
  type RelayEventFrame,
  type RelayServerFrame,
  type RelaySubscriptionView,
} from './wire.js';

export interface RelayLogger {
  info(context: Readonly<Record<string, unknown>>, message: string): void;
  warn(context: Readonly<Record<string, unknown>>, message: string): void;
  error(context: Readonly<Record<string, unknown>>, message: string): void;
}

export interface RelaySubscriptionAuthorization {
  readonly identityId: string;
  readonly topic: string;
  readonly kinds: readonly RelayEventKind[];
}

export interface RelaySubscriptionGrant {
  readonly authorized: true;
  readonly expiresAt: number;
}

export type RelaySubscriptionAuthorizationDecision = boolean | RelaySubscriptionGrant;

export interface RelayServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly relayId?: string;
  readonly allowedOrigins?: readonly string[];
  readonly logger?: RelayLogger | false;
  readonly authorizeKey?: RelayKeyAuthorizer;
  readonly dangerouslyAllowUnverifiedLocalMode?: boolean;
  readonly authorizeSubscription?: (
    input: RelaySubscriptionAuthorization,
  ) => RelaySubscriptionAuthorizationDecision | Promise<RelaySubscriptionAuthorizationDecision>;
  readonly readinessCheck?: () => void | Promise<void>;
  readonly rateLimiter?: RateLimiter;
  readonly now?: () => Date;
  readonly trustedProxyCidrs?: readonly string[];
}

interface ConnectionState {
  readonly id: string;
  readonly socket: WebSocket;
  readonly ip: string;
  readonly pendingFrames: QueuedClientFrame[];
  alive: boolean;
  closed: boolean;
  lastSeenAt: number;
  processingFrames: boolean;
  violations: number;
  subscription?: RelaySubscriptionView;
}

interface QueuedClientFrame {
  readonly bytes: Uint8Array;
  readonly isBinary: boolean;
}

class RelayRateLimitDependencyError extends Error {
  constructor() {
    super('The relay rate-limit dependency is unavailable.');
    this.name = 'RelayRateLimitDependencyError';
  }
}

export class RelayServer {
  readonly #host: string;
  readonly #port: number;
  readonly #relayId: string;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #keyAuthorizationMode: RelayKeyAuthorizationMode;
  readonly #logger: RelayLogger;
  readonly #now: () => Date;
  readonly #clientIpPolicy: TrustedProxyPolicy;
  readonly #http: HttpServer;
  readonly #webSockets: WebSocketServer;
  readonly #transportSockets = new Set<Duplex>();
  readonly #transportHeaderDeadlines = new Map<Duplex, NodeJS.Timeout>();
  readonly #connections = new Map<WebSocket, ConnectionState>();
  readonly #connectionsByIp = new Map<string, number>();
  readonly #ipLimiter = new SlidingWindowRateLimiter(
    RELAY_POLICY.rateLimit.ipMessagesPerMinute,
    60_000,
  );
  readonly #identityLimiter = new SlidingWindowRateLimiter(
    RELAY_POLICY.rateLimit.identityMessagesPerMinute,
    60_000,
  );
  readonly #replays = new ReplayWindow();
  readonly #retention = new EphemeralEventStore();
  readonly #metrics = new RelayMetrics();
  #relaySequence = 0;
  #heartbeat: NodeJS.Timeout | undefined;
  #started = false;
  #stopping = false;

  constructor(private readonly options: RelayServerOptions = {}) {
    if (
      (options.authorizeKey !== undefined || options.authorizeSubscription !== undefined) &&
      options.dangerouslyAllowUnverifiedLocalMode === true
    ) {
      throw new TypeError(
        'Choose verified authorization adapters or dangerous local-unverified mode, never both.',
      );
    }
    this.#host = options.host ?? '127.0.0.1';
    this.#port = options.port ?? 4200;
    this.#relayId = validateRelayId(options.relayId ?? `relay-${randomUUID()}`);
    this.#allowedOrigins = new Set(options.allowedOrigins ?? []);
    this.#keyAuthorizationMode =
      options.authorizeKey !== undefined
        ? 'verified'
        : options.dangerouslyAllowUnverifiedLocalMode === true
          ? 'unverified-local'
          : 'locked';
    this.#logger =
      options.logger === false ? silentLogger : (options.logger ?? createPrivacySafeJsonLogger());
    this.#now = options.now ?? (() => new Date());
    this.#clientIpPolicy = createTrustedProxyPolicy(options.trustedProxyCidrs ?? []);
    this.#http = createServer(
      {
        connectionsCheckingInterval:
          RELAY_POLICY.connection.connectionsCheckingIntervalMilliseconds,
        headersTimeout: RELAY_POLICY.connection.headersTimeoutMilliseconds,
        keepAliveTimeout: RELAY_POLICY.connection.keepAliveTimeoutMilliseconds,
        maxHeaderSize: RELAY_POLICY.connection.maximumHeaderBytes,
        requestTimeout: RELAY_POLICY.connection.requestTimeoutMilliseconds,
      },
      (request, response) => {
        this.#clearTransportHeaderDeadline(request.socket);
        response.once('finish', () => {
          if (!request.socket.destroyed && this.#transportSockets.has(request.socket)) {
            this.#armTransportHeaderDeadline(request.socket);
          }
        });
        void this.#handleHttp(request, response);
      },
    );
    this.#http.maxHeadersCount = RELAY_POLICY.connection.maximumHeadersCount;
    this.#http.prependListener('connection', (socket) => this.#acceptTransportSocket(socket));
    this.#webSockets = new WebSocketServer({
      noServer: true,
      clientTracking: false,
      maxPayload: RELAY_POLICY.message.maximumBytes,
      perMessageDeflate: false,
    });
    this.#http.on('upgrade', (request, socket, head) => {
      this.#handleUpgrade(request, socket, head);
    });
    this.#webSockets.on('connection', (socket, request) => {
      this.#acceptConnection(socket, request);
    });
  }

  async start(): Promise<RelayServerAddress> {
    if (this.#started) {
      return this.address();
    }
    if (this.#stopping) {
      throw new Error('Relay server is stopping.');
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.#http.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.#http.removeListener('error', onError);
        resolve();
      };
      this.#http.once('error', onError);
      this.#http.once('listening', onListening);
      this.#http.listen(this.#port, this.#host);
    });
    this.#started = true;
    this.#heartbeat = setInterval(
      () => this.#heartbeatConnections(),
      RELAY_POLICY.connection.heartbeatIntervalMilliseconds,
    );
    this.#heartbeat.unref();
    const address = this.address();
    this.#logger.info(
      {
        host: address.host,
        port: address.port,
        relayId: this.#relayId,
        keyAuthorization: this.#keyAuthorizationMode,
      },
      'relay started',
    );
    if (this.#keyAuthorizationMode === 'locked') {
      this.#logger.warn(
        { code: 'key-authorizer-required', relayId: this.#relayId },
        'relay is locked and not ready because no key authorizer is configured',
      );
    }
    return address;
  }

  async stop(): Promise<void> {
    if (this.#stopping) {
      return;
    }
    this.#stopping = true;
    if (this.#heartbeat !== undefined) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = undefined;
    }
    for (const state of this.#connections.values()) {
      state.socket.close(1001, 'relay shutting down');
    }
    await Promise.all(
      [...this.#connections.values()].map(
        (state) =>
          new Promise<void>((resolve) => {
            if (state.socket.readyState === WebSocket.CLOSED) {
              resolve();
              return;
            }
            const timer = setTimeout(() => {
              state.socket.terminate();
              resolve();
            }, 1_000);
            timer.unref();
            state.socket.once('close', () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      ),
    );
    await new Promise<void>((resolve, reject) => {
      this.#webSockets.close(() => resolve());
      if (!this.#started) {
        resolve();
      }
      this.#webSockets.once('error', reject);
    }).catch(() => undefined);
    for (const socket of this.#transportSockets) {
      socket.destroy();
    }
    for (const deadline of this.#transportHeaderDeadlines.values()) {
      clearTimeout(deadline);
    }
    this.#transportHeaderDeadlines.clear();
    if (this.#started) {
      await new Promise<void>((resolve, reject) => {
        this.#http.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
    await this.options.rateLimiter?.close();
    this.#started = false;
    this.#logger.info({ relayId: this.#relayId }, 'relay stopped');
  }

  address(): RelayServerAddress {
    const address = this.#http.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Relay server is not listening.');
    }
    const host = normalizeHost(address.address);
    return {
      host,
      port: address.port,
      httpUrl: `http://${host}:${String(address.port)}`,
      webSocketUrl: `ws://${host}:${String(address.port)}${RELAY_PATH}`,
      relayId: this.#relayId,
    };
  }

  metrics(): ReturnType<RelayMetrics['snapshot']> {
    return this.#metrics.snapshot(this.#retention.size);
  }

  transportSocketCount(): number {
    return this.#transportSockets.size;
  }

  async #handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    applySecurityHeaders(response);
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'method-not-allowed' });
      return;
    }
    const pathname = safePathname(request.url);
    if (pathname === '/healthz') {
      sendJson(response, 200, {
        ok: true,
        service: '@wokesocial/relay',
        advisory: true,
        canonical: false,
        relayId: this.#relayId,
        keyAuthorization: this.#keyAuthorizationMode,
      });
      return;
    }
    if (pathname === '/readyz') {
      try {
        await this.options.readinessCheck?.();
        const rateLimitHealth = await this.options.rateLimiter?.readiness();
        const ready =
          this.#started &&
          !this.#stopping &&
          this.#keyAuthorizationMode !== 'locked' &&
          (rateLimitHealth === undefined || rateLimitHealth.ready);
        sendJson(response, ready ? 200 : 503, {
          ok: ready,
          relayId: this.#relayId,
          keyAuthorization: this.#keyAuthorizationMode,
        });
      } catch {
        sendJson(response, 503, {
          ok: false,
          relayId: this.#relayId,
          keyAuthorization: this.#keyAuthorizationMode,
        });
      }
      return;
    }
    if (pathname === '/metrics') {
      response.statusCode = 200;
      response.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
      response.end(
        this.#metrics.prometheus(this.#relayId, this.#retention.size, this.#keyAuthorizationMode),
      );
      return;
    }
    if (pathname === '/v1/policy') {
      sendJson(response, 200, publicRelayPolicy);
      return;
    }
    sendJson(response, 404, { error: 'not-found' });
  }

  #handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.#transportSockets.has(socket)) {
      socket.destroy();
      return;
    }
    this.#clearTransportHeaderDeadline(socket);
    if (this.#keyAuthorizationMode === 'locked') {
      this.#metrics.rejectedConnections += 1;
      rejectUpgrade(socket, 503, 'Key Authorizer Required');
      return;
    }
    if (safePathname(request.url) !== RELAY_PATH || !this.#originAllowed(request.headers.origin)) {
      this.#metrics.rejectedConnections += 1;
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const ip = this.#clientIpPolicy.clientIp(request);
    const current = this.#connectionsByIp.get(ip) ?? 0;
    if (current >= RELAY_POLICY.connection.maximumConnectionsPerIp) {
      this.#metrics.rejectedConnections += 1;
      rejectUpgrade(socket, 429, 'Too Many Requests');
      return;
    }
    this.#webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      this.#webSockets.emit('connection', webSocket, request);
    });
  }

  #acceptTransportSocket(socket: Duplex): void {
    if (
      this.#stopping ||
      this.#transportSockets.size >= RELAY_POLICY.connection.maximumTransportSockets
    ) {
      this.#metrics.rejectedConnections += 1;
      socket.destroy();
      return;
    }
    this.#transportSockets.add(socket);
    this.#armTransportHeaderDeadline(socket);
    socket.once('close', () => {
      this.#clearTransportHeaderDeadline(socket);
      this.#transportSockets.delete(socket);
    });
  }

  #armTransportHeaderDeadline(socket: Duplex): void {
    this.#clearTransportHeaderDeadline(socket);
    const deadline = setTimeout(() => {
      this.#transportHeaderDeadlines.delete(socket);
      this.#metrics.rejectedConnections += 1;
      socket.destroy();
    }, RELAY_POLICY.connection.headersTimeoutMilliseconds);
    deadline.unref();
    this.#transportHeaderDeadlines.set(socket, deadline);
  }

  #clearTransportHeaderDeadline(socket: Duplex): void {
    const deadline = this.#transportHeaderDeadlines.get(socket);
    if (deadline === undefined) {
      return;
    }
    clearTimeout(deadline);
    this.#transportHeaderDeadlines.delete(socket);
  }

  #acceptConnection(socket: WebSocket, request: IncomingMessage): void {
    const ip = this.#clientIpPolicy.clientIp(request);
    const now = this.#now().getTime();
    const state: ConnectionState = {
      id: randomUUID(),
      socket,
      ip,
      pendingFrames: [],
      alive: true,
      closed: false,
      lastSeenAt: now,
      processingFrames: false,
      violations: 0,
    };
    this.#connections.set(socket, state);
    this.#connectionsByIp.set(ip, (this.#connectionsByIp.get(ip) ?? 0) + 1);
    this.#metrics.activeConnections += 1;
    this.#metrics.acceptedConnections += 1;
    socket.on('pong', () => {
      state.alive = true;
      state.lastSeenAt = this.#now().getTime();
    });
    socket.on('message', (data, isBinary) => {
      this.#enqueueMessage(state, data, isBinary);
    });
    socket.on('error', () => {
      this.#logger.warn({ connectionId: state.id, code: 'websocket-error' }, 'relay socket error');
    });
    socket.once('close', () => this.#removeConnection(state));
    this.#send(state, {
      op: 'hello',
      advisory: true,
      canonical: false,
      relayId: this.#relayId,
      protocolVersion: RELAY_PROTOCOL_VERSION,
      keyAuthorization: this.#wireKeyAuthorization(),
      serverTime: this.#now().toISOString(),
      limits: {
        maximumMessageBytes: RELAY_POLICY.message.maximumBytes,
        maximumSubscriptions: RELAY_POLICY.connection.maximumSubscriptions,
        retentionMilliseconds: RELAY_POLICY.retention.maximumMilliseconds,
      },
    });
  }

  #enqueueMessage(state: ConnectionState, data: RawData, isBinary: boolean): void {
    if (!this.#connectionOpen(state)) {
      return;
    }
    if (state.pendingFrames.length >= RELAY_POLICY.connection.maximumPendingFrames) {
      this.#metrics.rejectedFrames += 1;
      this.#metrics.backpressureDisconnects += 1;
      this.#sendErrorDirect(state.socket, {
        op: 'error',
        code: 'backpressure',
        message: 'Too many relay frames are awaiting authorization.',
        retryable: true,
      });
      state.closed = true;
      state.pendingFrames.length = 0;
      state.socket.close(4008, 'inbound backpressure');
      return;
    }
    state.pendingFrames.push({
      bytes: Uint8Array.from(rawDataBytes(data)),
      isBinary,
    });
    if (state.processingFrames) {
      return;
    }
    state.processingFrames = true;
    void this.#drainMessages(state);
  }

  async #drainMessages(state: ConnectionState): Promise<void> {
    try {
      while (this.#connectionOpen(state)) {
        const frame = state.pendingFrames.shift();
        if (frame === undefined) {
          return;
        }
        await this.#handleMessage(state, frame.bytes, frame.isBinary);
      }
    } catch {
      this.#logger.error(
        { connectionId: state.id, code: 'frame-queue-failed' },
        'relay frame queue failed',
      );
      if (this.#connectionOpen(state)) {
        state.closed = true;
        state.pendingFrames.length = 0;
        state.socket.close(1011, 'relay frame processing failed');
      }
    } finally {
      state.processingFrames = false;
      if (this.#connectionOpen(state) && state.pendingFrames.length > 0) {
        state.processingFrames = true;
        void this.#drainMessages(state);
      }
    }
  }

  async #handleMessage(
    state: ConnectionState,
    bytes: Uint8Array,
    isBinary: boolean,
  ): Promise<void> {
    if (!this.#connectionOpen(state)) {
      return;
    }
    const now = this.#now();
    state.lastSeenAt = now.getTime();
    if (!(await this.#allowIpMessage(state.ip, now.getTime()))) {
      this.#metrics.rateLimitRejections += 1;
      this.#rejectFrame(state, 'rate-limit', 'The per-IP message rate limit was exceeded.', true);
      return;
    }
    if (isBinary || bytes.byteLength > RELAY_POLICY.message.maximumBytes) {
      this.#metrics.rejectedFrames += 1;
      this.#rejectFrame(
        state,
        'too-large',
        'Only bounded UTF-8 JSON relay frames are accepted.',
        false,
      );
      return;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      this.#metrics.rejectedFrames += 1;
      this.#rejectFrame(state, 'invalid-frame', 'Relay frame must be valid UTF-8 JSON.', false);
      return;
    }
    const frame = relayClientFrameSchema.safeParse(decoded);
    if (!frame.success) {
      this.#metrics.rejectedFrames += 1;
      this.#rejectFrame(
        state,
        'invalid-frame',
        'Relay frame does not match the versioned wire schema.',
        false,
      );
      return;
    }

    if (frame.data.op === 'subscribe') {
      await this.#subscribe(state, frame.data.authorization);
    } else {
      await this.#publish(state, frame.data.envelope, now);
    }
  }

  async #subscribe(state: ConnectionState, input: unknown): Promise<void> {
    try {
      const verified = await verifySubscription(input, {
        now: this.#now,
        ...(this.options.authorizeKey === undefined
          ? {}
          : { authorize: this.options.authorizeKey }),
      });
      if (!this.#connectionOpen(state)) {
        return;
      }
      const message = verified.envelope.message;
      const subscriptionExpiresAt = Date.parse(message.expiresAt);
      let authorizationNow = this.#now();
      assertRelayMessageCurrent(message, authorizationNow);
      if (
        !this.#replays.accept(
          message.identity,
          message.nonce,
          subscriptionExpiresAt,
          authorizationNow.getTime(),
        )
      ) {
        this.#metrics.replayRejections += 1;
        this.#rejectFrame(state, 'replay', 'Subscription authorization was already used.', false);
        return;
      }
      const authorizationExpiries = new Map<string, number | undefined>();
      for (const subscription of message.subscriptions) {
        if (this.options.authorizeSubscription !== undefined) {
          assertRelayMessageCurrent(message, this.#now());
          const decision = await this.options.authorizeSubscription({
            identityId: message.identity,
            topic: subscription.topic,
            kinds: subscription.kinds,
          });
          if (!this.#connectionOpen(state)) {
            return;
          }
          authorizationNow = this.#now();
          assertRelayMessageCurrent(message, authorizationNow);
          const grantExpiry = subscriptionGrantExpiry(
            decision,
            authorizationNow.getTime(),
            subscriptionExpiresAt,
          );
          if (grantExpiry === false) {
            this.#rejectFrame(
              state,
              'forbidden',
              'A requested subscription is not authorized.',
              false,
            );
            return;
          }
          authorizationExpiries.set(subscription.topic, grantExpiry);
        }
      }
      authorizationNow = this.#now();
      assertRelayMessageCurrent(message, authorizationNow);
      if (
        [...authorizationExpiries.values()].some(
          (expiresAt) => expiresAt !== undefined && expiresAt <= authorizationNow.getTime(),
        )
      ) {
        this.#rejectFrame(
          state,
          'forbidden',
          'A requested subscription authorization expired before installation.',
          true,
        );
        return;
      }
      if (!this.#connectionOpen(state)) {
        return;
      }
      const topics = new Map<
        string,
        Readonly<{
          kinds: ReadonlySet<RelayEventKind>;
          sinceSequence?: number;
          authorizationExpiresAt?: number;
        }>
      >();
      for (const subscription of message.subscriptions) {
        const authorizationExpiresAt = authorizationExpiries.get(subscription.topic);
        topics.set(subscription.topic, {
          kinds: new Set(subscription.kinds),
          ...(subscription.sinceSequence === undefined
            ? {}
            : { sinceSequence: subscription.sinceSequence }),
          ...(authorizationExpiresAt === undefined ? {} : { authorizationExpiresAt }),
        });
      }
      state.subscription = {
        identity: message.identity,
        expiresAt: subscriptionExpiresAt,
        topics,
      };
      state.lastSeenAt = authorizationNow.getTime();
      this.#send(state, {
        op: 'subscribed',
        subscriptionId: verified.subscriptionId,
        topicCount: topics.size,
        expiresAt: message.expiresAt,
      });
      for (const [topic, subscription] of topics) {
        const replayStartedAt = this.#now().getTime();
        if (state.subscription.expiresAt <= replayStartedAt) {
          break;
        }
        for (const retained of this.#retention.replay(
          topic,
          subscription.sinceSequence,
          replayStartedAt,
        )) {
          if (this.#shouldReceive(state, retained.envelope, this.#now().getTime())) {
            this.#send(state, retained);
          }
        }
      }
      this.#logger.info(
        {
          connectionId: state.id,
          subscriptionCount: topics.size,
        },
        'relay subscription authenticated',
      );
    } catch (error) {
      if (!this.#connectionOpen(state)) {
        return;
      }
      this.#metrics.rejectedFrames += 1;
      this.#rejectProtocolError(state, error);
    }
  }

  async #publish(state: ConnectionState, input: unknown, now: Date): Promise<void> {
    if (state.subscription === undefined || state.subscription.expiresAt <= now.getTime()) {
      this.#rejectFrame(state, 'not-subscribed', 'Authenticate a live subscription first.', false);
      return;
    }
    try {
      const verified = await verifyRelayEvent(input, {
        now: this.#now,
        ...(this.options.authorizeKey === undefined
          ? {}
          : { authorize: this.options.authorizeKey }),
      });
      if (!this.#connectionOpen(state)) {
        return;
      }
      const message = verified.envelope.message;
      const acceptedAt = this.#now();
      assertRelayMessageCurrent(message, acceptedAt);
      const activeSubscription = state.subscription;
      if (
        activeSubscription === undefined ||
        activeSubscription.expiresAt <= acceptedAt.getTime()
      ) {
        this.#rejectFrame(
          state,
          'not-subscribed',
          'Authenticate a live subscription first.',
          false,
        );
        return;
      }
      if (message.identity !== activeSubscription.identity) {
        this.#rejectFrame(
          state,
          'forbidden',
          'Publisher identity must match the authenticated connection.',
          false,
        );
        return;
      }
      if (!(await this.#allowIdentityPublish(message.identity, acceptedAt.getTime()))) {
        this.#metrics.rateLimitRejections += 1;
        this.#rejectFrame(
          state,
          'rate-limit',
          'The per-identity publish rate limit was exceeded.',
          true,
        );
        return;
      }
      if (
        !this.#replays.accept(
          message.identity,
          message.nonce,
          Date.parse(message.expiresAt),
          acceptedAt.getTime(),
        )
      ) {
        this.#metrics.replayRejections += 1;
        this.#rejectFrame(state, 'replay', 'Relay event was already accepted.', false);
        return;
      }

      this.#relaySequence += 1;
      const eventFrame: RelayEventFrame = {
        op: 'event',
        relayId: this.#relayId,
        relaySequence: this.#relaySequence,
        receivedAt: acceptedAt.toISOString(),
        retained: false,
        eventId: verified.eventId,
        envelope: verified.envelope,
        advisory: true,
        canonical: false,
        keyAuthorization: this.#wireKeyAuthorization(),
      };
      this.#retention.add(eventFrame, verified.envelope, acceptedAt.getTime());
      this.#metrics.acceptedEvents += 1;
      this.#send(state, {
        op: 'published',
        eventId: verified.eventId,
        relaySequence: this.#relaySequence,
        advisory: true,
        canonical: false,
        keyAuthorization: this.#wireKeyAuthorization(),
      });
      for (const recipient of this.#connections.values()) {
        if (this.#shouldReceive(recipient, verified.envelope, this.#now().getTime())) {
          this.#send(recipient, eventFrame);
        }
      }
      this.#logger.info(
        {
          eventId: verified.eventId,
          eventKind: message.kind,
          relaySequence: this.#relaySequence,
        },
        'advisory relay event accepted',
      );
    } catch (error) {
      if (error instanceof RelayRateLimitDependencyError) {
        throw error;
      }
      if (!this.#connectionOpen(state)) {
        return;
      }
      this.#metrics.rejectedFrames += 1;
      this.#rejectProtocolError(state, error);
    }
  }

  async #allowIpMessage(ip: string, now: number): Promise<boolean> {
    if (this.options.rateLimiter === undefined) {
      return this.#ipLimiter.allow(privacyHash(ip), now);
    }
    try {
      return (
        await this.options.rateLimiter.consume({
          namespace: 'relay:message:ip',
          key: ip,
          limit: RELAY_POLICY.rateLimit.ipMessagesPerMinute,
          windowMs: 60_000,
        })
      ).allowed;
    } catch {
      throw new RelayRateLimitDependencyError();
    }
  }

  async #allowIdentityPublish(identity: string, now: number): Promise<boolean> {
    if (this.options.rateLimiter === undefined) {
      return this.#identityLimiter.allow(privacyHash(identity), now);
    }
    try {
      return (
        await this.options.rateLimiter.consume({
          namespace: 'relay:publish:identity',
          key: identity,
          limit: RELAY_POLICY.rateLimit.identityMessagesPerMinute,
          windowMs: 60_000,
        })
      ).allowed;
    } catch {
      throw new RelayRateLimitDependencyError();
    }
  }

  #shouldReceive(state: ConnectionState, event: SignedRelayEvent, now: number): boolean {
    const subscription = state.subscription;
    if (subscription === undefined || subscription.expiresAt <= now) {
      return false;
    }
    const topic = subscription.topics.get(event.message.topic);
    return (
      topic !== undefined &&
      topic.kinds.has(event.message.kind) &&
      this.#audienceAllows(event, subscription, now)
    );
  }

  #audienceAllows(
    event: SignedRelayEvent,
    subscription: RelaySubscriptionView,
    now: number,
  ): boolean {
    const audience = event.message.audience;
    if (audience.kind === 'public') {
      return true;
    }
    if (audience.kind === 'community') {
      // Opaque topic knowledge is not proof of community membership. A
      // deployment must explicitly authorize subscriptions against its current
      // membership projection before restricted community events can leave the
      // relay.
      const authorizationExpiresAt = subscription.topics.get(
        event.message.topic,
      )?.authorizationExpiresAt;
      return (
        this.options.authorizeSubscription !== undefined &&
        (authorizationExpiresAt === undefined || authorizationExpiresAt > now)
      );
    }
    return (
      event.message.identity === subscription.identity ||
      audience.recipients.includes(subscription.identity)
    );
  }

  #send(state: ConnectionState, frame: RelayServerFrame): boolean {
    if (!this.#connectionOpen(state)) {
      return false;
    }
    if (state.socket.bufferedAmount > RELAY_POLICY.connection.maximumBufferedBytes) {
      this.#metrics.backpressureDisconnects += 1;
      this.#sendErrorDirect(state.socket, {
        op: 'error',
        code: 'backpressure',
        message: 'Connection could not keep up with relay delivery.',
        retryable: true,
      });
      state.socket.close(4008, 'backpressure');
      return false;
    }
    state.socket.send(JSON.stringify(frame));
    return true;
  }

  #rejectProtocolError(state: ConnectionState, error: unknown): void {
    const protocolError = error instanceof RelayProtocolError ? error : undefined;
    this.#logger.warn(
      {
        connectionId: state.id,
        code: protocolError?.code ?? 'verification-failed',
      },
      'relay frame rejected',
    );
    this.#rejectFrame(
      state,
      protocolError?.code === 'key-not-authorized' ? 'forbidden' : 'invalid-signature',
      protocolError === undefined ? 'Relay envelope verification failed.' : protocolError.message,
      protocolError?.code === 'stale-timestamp' || protocolError?.code === 'expired',
    );
  }

  #rejectFrame(
    state: ConnectionState,
    code: RelayErrorCode,
    message: string,
    retryable: boolean,
  ): void {
    state.violations += 1;
    this.#send(state, { op: 'error', code, message, retryable });
    if (!retryable && state.violations >= 3) {
      state.socket.close(4003, 'relay policy violations');
    }
  }

  #sendErrorDirect(socket: WebSocket, frame: RelayErrorFrame): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  }

  #heartbeatConnections(): void {
    const now = this.#now().getTime();
    for (const state of this.#connections.values()) {
      const expiredSubscription =
        state.subscription !== undefined && state.subscription.expiresAt <= now;
      const idle =
        !state.alive || now - state.lastSeenAt > RELAY_POLICY.connection.idleTimeoutMilliseconds;
      if (expiredSubscription || idle) {
        state.socket.close(
          expiredSubscription ? 4001 : 4000,
          expiredSubscription ? 'subscription expired' : 'idle timeout',
        );
        continue;
      }
      state.alive = false;
      state.socket.ping();
    }
  }

  #removeConnection(state: ConnectionState): void {
    state.closed = true;
    state.pendingFrames.length = 0;
    delete state.subscription;
    if (!this.#connections.delete(state.socket)) {
      return;
    }
    const count = (this.#connectionsByIp.get(state.ip) ?? 1) - 1;
    if (count <= 0) {
      this.#connectionsByIp.delete(state.ip);
    } else {
      this.#connectionsByIp.set(state.ip, count);
    }
    this.#metrics.activeConnections = Math.max(0, this.#metrics.activeConnections - 1);
  }

  #connectionOpen(state: ConnectionState): boolean {
    return (
      !state.closed &&
      this.#connections.has(state.socket) &&
      state.socket.readyState === WebSocket.OPEN
    );
  }

  #originAllowed(origin: string | undefined): boolean {
    if (origin === undefined) {
      return true;
    }
    return this.#allowedOrigins.has(origin);
  }

  #wireKeyAuthorization(): 'unverified-local' | 'verified' {
    if (this.#keyAuthorizationMode === 'locked') {
      throw new Error('Locked relay cannot emit WebSocket frames.');
    }
    return this.#keyAuthorizationMode;
  }
}

function subscriptionGrantExpiry(
  decision: RelaySubscriptionAuthorizationDecision,
  now: number,
  signedSubscriptionExpiresAt: number,
): number | undefined | false {
  if (decision === false) {
    return false;
  }
  if (decision === true) {
    // Boolean callbacks remain supported as deployment-owned policy. The
    // shipped HTTP adapter instead returns a time-bounded finalized grant.
    return undefined;
  }
  if (
    decision.authorized !== true ||
    !Number.isFinite(decision.expiresAt) ||
    !Number.isSafeInteger(decision.expiresAt) ||
    decision.expiresAt <= now
  ) {
    return false;
  }
  return Math.min(decision.expiresAt, signedSubscriptionExpiresAt);
}

export interface RelayServerAddress {
  readonly host: string;
  readonly port: number;
  readonly httpUrl: string;
  readonly webSocketUrl: string;
  readonly relayId: string;
}

export function createPrivacySafeJsonLogger(): RelayLogger {
  const write = (
    level: 'error' | 'info' | 'warn',
    context: Readonly<Record<string, unknown>>,
    message: string,
  ) => {
    process.stdout.write(
      `${JSON.stringify({
        level,
        service: '@wokesocial/relay',
        message,
        ...context,
        timestamp: new Date().toISOString(),
      })}\n`,
    );
  };
  return {
    info: (context, message) => write('info', context, message),
    warn: (context, message) => write('warn', context, message),
    error: (context, message) => write('error', context, message),
  };
}

const silentLogger: RelayLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function rawDataBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  return new Uint8Array(data);
}

function safePathname(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl ?? '/', 'http://relay.invalid').pathname;
  } catch {
    return '/__invalid__';
  }
}

function normalizeHost(address: string): string {
  return address === '::' || address === '0.0.0.0' || address === '::1' ? '127.0.0.1' : address;
}

function validateRelayId(relayId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(relayId)) {
    throw new TypeError('Relay ID must be a bounded public identifier.');
  }
  return relayId;
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${String(status)} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${String(Buffer.byteLength(message))}\r\n\r\n${message}`,
  );
  socket.destroy();
}

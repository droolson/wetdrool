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
  RELAY_PATH,
  RELAY_POLICY,
  RELAY_PROTOCOL_VERSION,
  publicRelayPolicy,
  type RelayKeyAuthorizationMode,
} from './policy.js';
import {
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
  ) => boolean | Promise<boolean>;
  readonly readinessCheck?: () => void | Promise<void>;
  readonly now?: () => Date;
}

interface ConnectionState {
  readonly id: string;
  readonly socket: WebSocket;
  readonly ip: string;
  alive: boolean;
  lastSeenAt: number;
  violations: number;
  subscription?: RelaySubscriptionView;
}

export class RelayServer {
  readonly #host: string;
  readonly #port: number;
  readonly #relayId: string;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #keyAuthorizationMode: RelayKeyAuthorizationMode;
  readonly #logger: RelayLogger;
  readonly #now: () => Date;
  readonly #http: HttpServer;
  readonly #webSockets: WebSocketServer;
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
      options.authorizeKey !== undefined &&
      options.dangerouslyAllowUnverifiedLocalMode === true
    ) {
      throw new TypeError(
        'Choose verified key authorization or dangerous local-unverified mode, never both.',
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
    this.#http = createServer((request, response) => {
      void this.#handleHttp(request, response);
    });
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
    if (this.#started) {
      await new Promise<void>((resolve, reject) => {
        this.#http.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
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
        service: '@socially-woke/relay',
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
        const ready = this.#started && !this.#stopping && this.#keyAuthorizationMode !== 'locked';
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
    const ip = clientIp(request);
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

  #acceptConnection(socket: WebSocket, request: IncomingMessage): void {
    const ip = clientIp(request);
    const now = this.#now().getTime();
    const state: ConnectionState = {
      id: randomUUID(),
      socket,
      ip,
      alive: true,
      lastSeenAt: now,
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
      void this.#handleMessage(state, data, isBinary);
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

  async #handleMessage(state: ConnectionState, data: RawData, isBinary: boolean): Promise<void> {
    const now = this.#now();
    state.lastSeenAt = now.getTime();
    if (!this.#ipLimiter.allow(privacyHash(state.ip), now.getTime())) {
      this.#metrics.rateLimitRejections += 1;
      this.#rejectFrame(state, 'rate-limit', 'The per-IP message rate limit was exceeded.', true);
      return;
    }
    const bytes = rawDataBytes(data);
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
      await this.#subscribe(state, frame.data.authorization, now);
    } else {
      await this.#publish(state, frame.data.envelope, now);
    }
  }

  async #subscribe(state: ConnectionState, input: unknown, now: Date): Promise<void> {
    try {
      const verified = await verifySubscription(input, {
        now,
        ...(this.options.authorizeKey === undefined
          ? {}
          : { authorize: this.options.authorizeKey }),
      });
      const message = verified.envelope.message;
      if (
        !this.#replays.accept(
          message.identity,
          message.nonce,
          Date.parse(message.expiresAt),
          now.getTime(),
        )
      ) {
        this.#metrics.replayRejections += 1;
        this.#rejectFrame(state, 'replay', 'Subscription authorization was already used.', false);
        return;
      }
      for (const subscription of message.subscriptions) {
        if (
          this.options.authorizeSubscription !== undefined &&
          !(await this.options.authorizeSubscription({
            identityId: message.identity,
            topic: subscription.topic,
            kinds: subscription.kinds,
          }))
        ) {
          this.#rejectFrame(
            state,
            'forbidden',
            'A requested subscription is not authorized.',
            false,
          );
          return;
        }
      }
      const topics = new Map<
        string,
        Readonly<{ kinds: ReadonlySet<RelayEventKind>; sinceSequence?: number }>
      >();
      for (const subscription of message.subscriptions) {
        topics.set(subscription.topic, {
          kinds: new Set(subscription.kinds),
          ...(subscription.sinceSequence === undefined
            ? {}
            : { sinceSequence: subscription.sinceSequence }),
        });
      }
      state.subscription = {
        identity: message.identity,
        expiresAt: Date.parse(message.expiresAt),
        topics,
      };
      this.#send(state, {
        op: 'subscribed',
        subscriptionId: verified.subscriptionId,
        topicCount: topics.size,
        expiresAt: message.expiresAt,
      });
      for (const [topic, subscription] of topics) {
        for (const retained of this.#retention.replay(
          topic,
          subscription.sinceSequence,
          now.getTime(),
        )) {
          if (
            subscription.kinds.has(retained.envelope.message.kind) &&
            this.#audienceAllows(retained.envelope, state.subscription)
          ) {
            this.#send(state, retained);
          }
        }
      }
      this.#logger.info(
        {
          connectionId: state.id,
          identityHash: privacyHash(message.identity),
          subscriptionCount: topics.size,
        },
        'relay subscription authenticated',
      );
    } catch (error) {
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
        now,
        ...(this.options.authorizeKey === undefined
          ? {}
          : { authorize: this.options.authorizeKey }),
      });
      const message = verified.envelope.message;
      if (message.identity !== state.subscription.identity) {
        this.#rejectFrame(
          state,
          'forbidden',
          'Publisher identity must match the authenticated connection.',
          false,
        );
        return;
      }
      if (!this.#identityLimiter.allow(privacyHash(message.identity), now.getTime())) {
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
          now.getTime(),
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
        receivedAt: now.toISOString(),
        retained: false,
        eventId: verified.eventId,
        envelope: verified.envelope,
        advisory: true,
        canonical: false,
        keyAuthorization: this.#wireKeyAuthorization(),
      };
      this.#retention.add(eventFrame, verified.envelope, now.getTime());
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
        if (this.#shouldReceive(recipient, verified.envelope, now.getTime())) {
          this.#send(recipient, eventFrame);
        }
      }
      this.#logger.info(
        {
          eventId: verified.eventId,
          eventKind: message.kind,
          identityHash: privacyHash(message.identity),
          relaySequence: this.#relaySequence,
        },
        'advisory relay event accepted',
      );
    } catch (error) {
      this.#metrics.rejectedFrames += 1;
      this.#rejectProtocolError(state, error);
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
      this.#audienceAllows(event, subscription)
    );
  }

  #audienceAllows(event: SignedRelayEvent, subscription: RelaySubscriptionView): boolean {
    const audience = event.message.audience;
    if (audience.kind === 'public') {
      return true;
    }
    if (audience.kind === 'community') {
      // Opaque topic knowledge is not proof of community membership. A
      // deployment must explicitly authorize subscriptions against its current
      // membership projection before restricted community events can leave the
      // relay.
      return this.options.authorizeSubscription !== undefined;
    }
    return (
      event.message.identity === subscription.identity ||
      audience.recipients.includes(subscription.identity)
    );
  }

  #send(state: ConnectionState, frame: RelayServerFrame): boolean {
    if (state.socket.readyState !== WebSocket.OPEN) {
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
        service: '@socially-woke/relay',
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

function clientIp(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown';
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

export interface RedisEvalRequest {
  readonly script: string;
  readonly keys: readonly string[];
  readonly arguments: readonly string[];
}

/**
 * Minimal transport boundary. `eval` implementations must propagate the
 * supplied signal to their client command and independently bound socket,
 * queue, offline, and reconnect behavior. The limiter's Promise race alone
 * cannot cancel a Redis command that has already been written to the socket.
 */
export interface RateLimitRedisTransport {
  eval(request: RedisEvalRequest, signal: AbortSignal): Promise<unknown>;
  close(signal: AbortSignal): Promise<void>;
}

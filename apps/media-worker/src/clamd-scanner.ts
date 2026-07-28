import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isIP, type Socket, createConnection } from 'node:net';
import { lookup } from 'node:dns/promises';

import { MediaWorkerError } from './errors.js';
import type { MalwareScanner, ScannerResult } from './types.js';

const instreamCommand = Buffer.from('zINSTREAM\0', 'ascii');
const pingCommand = Buffer.from('zPING\0', 'ascii');
const versionCommand = Buffer.from('zVERSION\0', 'ascii');
const zeroLengthChunk = Buffer.alloc(4);
const maximumResponseBytes = 4_096;
const minimumChunkBytes = 1_024;
const maximumChunkBytes = 1_048_576;
const defaultChunkBytes = 65_536;
const defaultMaximumDatabaseAgeMilliseconds = 3 * 24 * 60 * 60 * 1_000;
const maximumFutureClockSkewMilliseconds = 5 * 60 * 1_000;
const scannerIdentity = 'clamd-instream';
const scannerProtocolVersion = '1';
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface ClamdScannerOptions {
  readonly host: string;
  readonly port?: number;
  readonly connectTimeoutMilliseconds?: number;
  readonly scanTimeoutMilliseconds?: number;
  readonly streamMaximumBytes: number;
  readonly maximumDatabaseAgeMilliseconds?: number;
  readonly chunkBytes?: number;
  readonly clock?: () => Date;
}

/**
 * Streams a file to a privately addressed clamd daemon without exposing the
 * file path or daemon response in operational errors.
 */
export class ClamdScanner implements MalwareScanner {
  readonly name = scannerIdentity;
  readonly available = true;
  readonly #host: string;
  readonly #port: number;
  readonly #connectTimeoutMilliseconds: number;
  readonly #scanTimeoutMilliseconds: number;
  readonly #streamMaximumBytes: number;
  readonly #maximumDatabaseAgeMilliseconds: number;
  readonly #chunkBytes: number;
  readonly #clock: () => Date;

  constructor(options: ClamdScannerOptions) {
    this.#host = validateHost(options.host);
    this.#port = boundedInteger(options.port ?? 3310, 1, 65_535, 'Clamd port');
    this.#connectTimeoutMilliseconds = boundedInteger(
      options.connectTimeoutMilliseconds ?? 5_000,
      1,
      60_000,
      'Clamd connect timeout',
    );
    this.#scanTimeoutMilliseconds = boundedInteger(
      options.scanTimeoutMilliseconds ?? 120_000,
      1,
      299_000,
      'Clamd scan timeout',
    );
    this.#streamMaximumBytes = boundedInteger(
      options.streamMaximumBytes,
      1,
      2_000_000_000,
      'Clamd stream maximum',
    );
    this.#maximumDatabaseAgeMilliseconds = boundedInteger(
      options.maximumDatabaseAgeMilliseconds ?? defaultMaximumDatabaseAgeMilliseconds,
      60 * 60 * 1_000,
      30 * 24 * 60 * 60 * 1_000,
      'Clamd maximum database age',
    );
    this.#chunkBytes = boundedInteger(
      options.chunkBytes ?? defaultChunkBytes,
      minimumChunkBytes,
      maximumChunkBytes,
      'Clamd INSTREAM chunk size',
    );
    this.#clock = options.clock ?? (() => new Date());
  }

  async scan(input: {
    readonly path: string;
    readonly mediaType: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly signal: AbortSignal;
  }): Promise<ScannerResult> {
    if (
      !Number.isSafeInteger(input.byteLength) ||
      input.byteLength < 1 ||
      input.byteLength > this.#streamMaximumBytes
    ) {
      throw scannerFailure();
    }
    const operation = operationSignal(
      input.signal,
      this.#scanTimeoutMilliseconds,
      'The malware scan did not complete within its configured deadline.',
    );
    try {
      const versionBefore = await this.#version(operation.signal);
      const socket = await this.#connect(operation.signal);
      const response = collectTerminatedResponse(socket, operation.signal);
      void response.catch(() => undefined);
      try {
        await streamFile(
          socket,
          input.path,
          input.byteLength,
          input.sha256,
          this.#chunkBytes,
          operation.signal,
        );
        const result = parseScanResponse(await response);
        const versionAfter = await this.#version(operation.signal);
        if (versionAfter !== versionBefore) {
          throw scannerFailure();
        }
        return {
          status: result,
          scanner: this.name,
          scannerVersion: versionAfter,
          checkedAt: this.#clock().toISOString(),
          ...(result === 'failed' ? { detail: 'Malware was detected.' } : {}),
        };
      } catch (error) {
        socket.destroy();
        await response.catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (error instanceof MediaWorkerError && error.code === 'scanner-unavailable') {
        throw error;
      }
      throw scannerFailure();
    } finally {
      operation.dispose();
    }
  }

  async healthCheck(): Promise<boolean> {
    const operation = operationSignal(
      undefined,
      this.#connectTimeoutMilliseconds * 3,
      'The malware scanner health check timed out.',
    );
    try {
      const pong = await this.#command(pingCommand, operation.signal);
      if (!pong.equals(Buffer.from('PONG', 'ascii'))) {
        return false;
      }
      await this.#version(operation.signal);
      return true;
    } catch {
      return false;
    } finally {
      operation.dispose();
    }
  }

  async #version(signal: AbortSignal): Promise<string> {
    const response = await this.#command(versionCommand, signal);
    return parseClamdVersion(response, this.#clock(), this.#maximumDatabaseAgeMilliseconds);
  }

  async #command(command: Buffer, signal: AbortSignal): Promise<Buffer> {
    const socket = await this.#connect(signal);
    const response = collectTerminatedResponse(socket, signal);
    void response.catch(() => undefined);
    try {
      await writeSocket(socket, command, signal);
      return await response;
    } catch (error) {
      socket.destroy();
      await response.catch(() => undefined);
      throw error;
    }
  }

  async #connect(parentSignal: AbortSignal): Promise<Socket> {
    const connection = operationSignal(
      parentSignal,
      this.#connectTimeoutMilliseconds,
      'The malware scanner connection did not complete within its configured deadline.',
    );
    try {
      const address = await this.#resolveAddress(connection.signal);
      return await connectPrivateSocket(
        address,
        this.#port,
        connection.signal,
        this.#connectTimeoutMilliseconds,
      );
    } finally {
      connection.dispose();
    }
  }

  async #resolveAddress(signal: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    if (isIP(this.#host) !== 0) {
      if (!isPrivateAddress(this.#host)) {
        throw scannerFailure();
      }
      return this.#host;
    }
    const resolution = lookup(this.#host, { all: true, verbatim: true });
    const addresses = await abortable(
      resolution,
      signal,
      'The malware scanner address could not be resolved safely.',
    );
    if (addresses.length === 0 || addresses.some(({ address }) => !isPrivateAddress(address))) {
      throw scannerFailure();
    }
    const first = addresses[0];
    if (first === undefined) {
      throw scannerFailure();
    }
    return first.address;
  }
}

async function streamFile(
  socket: Socket,
  path: string,
  expectedBytes: number,
  expectedSha256: string,
  chunkBytes: number,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== expectedBytes) {
      throw scannerFailure();
    }
    await writeSocket(socket, instreamCommand, signal);
    let position = 0;
    const digest = createHash('sha256');
    const chunk = Buffer.allocUnsafe(Math.min(chunkBytes, expectedBytes));
    while (position < expectedBytes) {
      throwIfAborted(signal);
      const requested = Math.min(chunk.byteLength, expectedBytes - position);
      const { bytesRead } = await handle.read(chunk, 0, requested, position);
      if (bytesRead < 1 || bytesRead > requested) {
        throw scannerFailure();
      }
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(bytesRead, 0);
      await writeSocket(socket, length, signal);
      await writeSocket(socket, chunk.subarray(0, bytesRead), signal);
      digest.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      after.size !== expectedBytes ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw scannerFailure();
    }
    if (`u${digest.digest('base64url')}` !== expectedSha256) {
      throw scannerFailure();
    }
    await writeSocket(socket, zeroLengthChunk, signal);
  } finally {
    await handle.close();
  }
}

function collectTerminatedResponse(socket: Socket, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    const finish = (error?: unknown, value?: Buffer) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error === undefined && value !== undefined) {
        resolve(value);
      } else {
        reject(error ?? scannerFailure());
      }
    };
    const onData = (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > maximumResponseBytes) {
        finish(scannerFailure());
        socket.destroy();
        return;
      }
      chunks.push(chunk);
      const combined = Buffer.concat(chunks, totalBytes);
      const terminator = combined.indexOf(0);
      if (terminator === -1) {
        return;
      }
      if (terminator !== combined.byteLength - 1) {
        finish(scannerFailure());
        socket.destroy();
        return;
      }
      finish(undefined, combined.subarray(0, terminator));
      socket.destroy();
    };
    const onEnd = () => finish(scannerFailure());
    const onClose = () => finish(scannerFailure());
    const onError = () => finish(scannerFailure());
    const onAbort = () => {
      finish(scannerFailure());
      socket.destroy();
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('close', onClose);
      socket.off('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    socket.on('data', onData);
    socket.once('end', onEnd);
    socket.once('close', onClose);
    socket.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  });
}

function parseScanResponse(response: Buffer): ScannerResult['status'] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(response);
  } catch {
    throw scannerFailure();
  }
  if (text === 'stream: OK') {
    return 'passed';
  }
  if (/^stream: [\u0021-\u007e]{1,512} FOUND$/u.test(text)) {
    return 'failed';
  }
  throw scannerFailure();
}

function parseClamdVersion(
  response: Buffer,
  now: Date,
  maximumDatabaseAgeMilliseconds: number,
): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(response);
  } catch {
    throw scannerFailure();
  }
  const match = text.match(
    /^ClamAV ([0-9]{1,3}(?:\.[0-9]{1,3}){2}(?:[-+][A-Za-z0-9.-]{1,32})?)\/([1-9][0-9]{0,9})\/(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +([0-9]{1,2}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([0-9]{4})$/u,
  );
  if (match === null) {
    throw scannerFailure();
  }
  const [
    ,
    engineVersion,
    databaseVersion,
    weekday,
    monthName,
    dayText,
    hourText,
    minuteText,
    secondText,
    yearText,
  ] = match;
  const month = months.indexOf(monthName ?? '');
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const year = Number(yearText);
  const databaseTimestamp = Date.UTC(year, month, day, hour, minute, second);
  const databaseDate = new Date(databaseTimestamp);
  if (
    engineVersion === undefined ||
    databaseVersion === undefined ||
    weekday === undefined ||
    month < 0 ||
    !Number.isFinite(now.getTime()) ||
    databaseDate.getUTCFullYear() !== year ||
    databaseDate.getUTCMonth() !== month ||
    databaseDate.getUTCDate() !== day ||
    databaseDate.getUTCHours() !== hour ||
    databaseDate.getUTCMinutes() !== minute ||
    databaseDate.getUTCSeconds() !== second ||
    weekdays[databaseDate.getUTCDay()] !== weekday
  ) {
    throw scannerFailure();
  }
  const age = now.getTime() - databaseTimestamp;
  if (age < -maximumFutureClockSkewMilliseconds || age > maximumDatabaseAgeMilliseconds) {
    throw scannerFailure();
  }
  return `adapter=${scannerProtocolVersion};engine=${engineVersion};db=${databaseVersion};dbAt=${databaseDate.toISOString()}`;
}

async function connectPrivateSocket(
  address: string,
  port: number,
  signal: AbortSignal,
  timeoutMilliseconds: number,
): Promise<Socket> {
  if (!isPrivateAddress(address)) {
    throw scannerFailure();
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: address, port });
    socket.setNoDelay(true);
    let settled = false;
    const timer = setTimeout(() => {
      finish(scannerFailure());
      socket.destroy();
    }, timeoutMilliseconds);
    timer.unref();
    const finish = (error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (error === undefined) {
        resolve(socket);
      } else {
        reject(error);
      }
    };
    const onConnect = () => finish();
    const onError = () => finish(scannerFailure());
    const onAbort = () => {
      finish(scannerFailure());
      socket.destroy();
    };
    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    socket.once('connect', onConnect);
    socket.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  });
}

function writeSocket(socket: Socket, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error === undefined || error === null) {
        resolve();
      } else {
        reject(scannerFailure());
      }
    };
    const onAbort = () => {
      finish(signal.reason);
      socket.destroy();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    socket.write(bytes, (error) => finish(error));
    if (signal.aborted) {
      onAbort();
    }
  });
}

function operationSignal(
  parent: AbortSignal | undefined,
  timeoutMilliseconds: number,
  timeoutMessage: string,
): { readonly signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', onAbort, { once: true });
  if (parent?.aborted === true) {
    onAbort();
  }
  const timer = setTimeout(() => {
    controller.abort(new MediaWorkerError('scanner-unavailable', timeoutMessage));
  }, timeoutMilliseconds);
  timer.unref();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal, message: string): Promise<T> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error === undefined) {
        resolve(value as T);
      } else {
        reject(error);
      }
    };
    const onAbort = () => finish(new MediaWorkerError('scanner-unavailable', message));
    signal.addEventListener('abort', onAbort, { once: true });
    void operation.then(
      (value) => finish(undefined, value),
      (error: unknown) => finish(error),
    );
    if (signal.aborted) {
      onAbort();
    }
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw scannerFailure();
  }
}

function scannerFailure(): MediaWorkerError {
  return new MediaWorkerError(
    'scanner-unavailable',
    'The malware scanner did not complete a valid private INSTREAM scan.',
  );
}

function validateHost(value: string): string {
  const host = value.trim();
  if (
    host.length < 1 ||
    host.length > 253 ||
    [...host].some((character) => character.charCodeAt(0) <= 0x20) ||
    /[/\\@[\]]/u.test(host) ||
    (isIP(host) === 0 &&
      !host
        .split('.')
        .every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u.test(label)))
  ) {
    throw new TypeError('Clamd host must be a valid IP literal or DNS hostname.');
  }
  return host;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${label} must be an integer from ${String(minimum)} to ${String(maximum)}.`,
    );
  }
  return value;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    const first = octets[0];
    const second = octets[1];
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::1') {
      return true;
    }
    if (normalized.startsWith('::ffff:')) {
      return isPrivateAddress(normalized.slice('::ffff:'.length));
    }
    const firstGroup = normalized.split(':')[0];
    if (firstGroup === undefined || firstGroup.length === 0) {
      return false;
    }
    const first = Number.parseInt(firstGroup, 16);
    return (first & 0xfe00) === 0xfc00;
  }
  return false;
}

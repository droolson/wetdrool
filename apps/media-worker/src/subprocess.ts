import { spawn } from 'node:child_process';

import { MediaWorkerError } from './errors.js';

export interface CommandResult {
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

export interface CommandRunnerOptions {
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  readonly maximumDiagnosticBytes?: number;
}

export class CommandRunner {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  readonly #maximumDiagnosticBytes: number;

  constructor(options: CommandRunnerOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.#maximumDiagnosticBytes = options.maximumDiagnosticBytes ?? 64_000;
    if (
      !Number.isInteger(this.#maximumDiagnosticBytes) ||
      this.#maximumDiagnosticBytes < 0 ||
      this.#maximumDiagnosticBytes > 1_000_000
    ) {
      throw new RangeError('Maximum subprocess diagnostic bytes must be between 0 and 1,000,000.');
    }
  }

  ffmpeg(
    arguments_: readonly string[],
    options: { readonly timeoutMilliseconds: number; readonly maximumStdoutBytes?: number },
  ): Promise<CommandResult> {
    return this.run(this.ffmpegPath, arguments_, options);
  }

  ffprobe(
    arguments_: readonly string[],
    options: { readonly timeoutMilliseconds: number; readonly maximumStdoutBytes?: number },
  ): Promise<CommandResult> {
    return this.run(this.ffprobePath, arguments_, options);
  }

  async binaryAvailable(binary: 'ffmpeg' | 'ffprobe'): Promise<boolean> {
    try {
      await this.run(binary === 'ffmpeg' ? this.ffmpegPath : this.ffprobePath, ['-version'], {
        timeoutMilliseconds: 3_000,
        maximumStdoutBytes: 16_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  run(
    executable: string,
    arguments_: readonly string[],
    options: { readonly timeoutMilliseconds: number; readonly maximumStdoutBytes?: number },
  ): Promise<CommandResult> {
    if (options.timeoutMilliseconds < 1 || options.timeoutMilliseconds > 10 * 60 * 1_000) {
      throw new RangeError('Subprocess timeout is outside the supported range.');
    }
    const maximumStdoutBytes = options.maximumStdoutBytes ?? 1_000_000;
    if (
      !Number.isInteger(maximumStdoutBytes) ||
      maximumStdoutBytes < 0 ||
      maximumStdoutBytes > 16_000_000
    ) {
      throw new RangeError('Maximum subprocess stdout bytes must be between 0 and 16,000,000.');
    }
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...arguments_], {
        env: {
          PATH: process.env.PATH,
          LANG: 'C',
          LC_ALL: 'C',
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      const stderr: Buffer[] = [];
      let stderrBytes = 0;
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(error);
      };
      const timer = setTimeout(() => {
        fail(
          new MediaWorkerError(
            'processing-failed',
            `Media subprocess exceeded ${String(options.timeoutMilliseconds)}ms.`,
          ),
        );
      }, options.timeoutMilliseconds);
      timer.unref();

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > maximumStdoutBytes) {
          fail(new MediaWorkerError('output-limit', 'Media subprocess output exceeded its bound.'));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const remaining = this.#maximumDiagnosticBytes - stderrBytes;
        if (remaining > 0) {
          const kept = chunk.subarray(0, remaining);
          stderr.push(kept);
          stderrBytes += kept.byteLength;
        }
      });
      child.once('error', (error) => {
        fail(
          new MediaWorkerError('processing-failed', 'Could not start the media subprocess.', {
            cause: error,
          }),
        );
      });
      child.once('close', (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const diagnostic = Buffer.concat(stderr).toString('utf8').trim();
        if (code !== 0) {
          reject(
            new MediaWorkerError(
              'processing-failed',
              `The media subprocess exited unsuccessfully (${signal ?? String(code)}).`,
              diagnostic ? { cause: new Error(diagnostic) } : undefined,
            ),
          );
          return;
        }
        resolve({
          stdout: new Uint8Array(Buffer.concat(stdout)),
          stderr: diagnostic,
        });
      });
    });
  }
}

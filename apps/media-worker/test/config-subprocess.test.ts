import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMediaWorkerConfig } from '../src/config.js';
import { ensurePrivateWorkingRoot } from '../src/processors/files.js';
import { MediaProcessor } from '../src/processors/index.js';
import { defaultProcessingLimits } from '../src/processors/limits.js';
import { CommandRunner } from '../src/subprocess.js';
import { createTestRoot, removeTestRoot } from './fixtures.js';

const secureEnvironment = {
  MEDIA_WORKER_CLAMD_HOST: '127.0.0.1',
  MEDIA_WORKER_STATIC_BEARER_TOKEN: Buffer.alloc(32, 0xa5).toString('base64url'),
};

describe('media worker configuration', () => {
  it('uses loopback service defaults only after explicit scanner and authorization configuration', () => {
    expect(() => parseMediaWorkerConfig({})).toThrow();
    expect(parseMediaWorkerConfig(secureEnvironment)).toMatchObject({
      host: '127.0.0.1',
      port: 4500,
      allowedOrigins: [],
      cleanupIntervalMilliseconds: 900_000,
      clamdHost: '127.0.0.1',
      clamdPort: 3310,
      clamdConnectTimeoutMilliseconds: 5_000,
      clamdScanTimeoutMilliseconds: 120_000,
      clamdStreamMaximumBytes: 100_000_000,
      clamdMaximumDatabaseAgeMilliseconds: 259_200_000,
    });
  });

  it('accepts exact HTTP origins and rejects credentials or URL components', () => {
    expect(
      parseMediaWorkerConfig({
        ...secureEnvironment,
        MEDIA_WORKER_ALLOWED_ORIGINS: 'https://woke.social:443/,http://localhost:3000',
      }).allowedOrigins,
    ).toEqual(['https://woke.social', 'http://localhost:3000']);
    expect(() =>
      parseMediaWorkerConfig({
        ...secureEnvironment,
        MEDIA_WORKER_ALLOWED_ORIGINS: 'https://user:secret@woke.social',
      }),
    ).toThrow();
    expect(() =>
      parseMediaWorkerConfig({
        ...secureEnvironment,
        MEDIA_WORKER_ALLOWED_ORIGINS: 'https://woke.social/path',
      }),
    ).toThrow();
    expect(() =>
      parseMediaWorkerConfig({
        ...secureEnvironment,
        MEDIA_WORKER_ALLOWED_ORIGINS: 'https://sociallywoke.com',
      }),
    ).toThrow(/legacy redirect host/);
  });

  it('rejects weak tokens and clamd stream limits below the advertised upload maximum', () => {
    const weakSecret = 'weak-secret-that-must-not-be-reflected';
    expect(() =>
      parseMediaWorkerConfig({
        ...secureEnvironment,
        MEDIA_WORKER_STATIC_BEARER_TOKEN: weakSecret,
      }),
    ).toThrow();
    try {
      parseMediaWorkerConfig({
        ...secureEnvironment,
        MEDIA_WORKER_STATIC_BEARER_TOKEN: weakSecret,
      });
      throw new Error('Expected weak token rejection.');
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain(weakSecret);
    }
    expect(() =>
      parseMediaWorkerConfig({
        ...secureEnvironment,
        MEDIA_WORKER_CLAMD_STREAM_MAX_BYTES: '99999999',
      }),
    ).toThrow();
  });
});

describe('bounded argument-array subprocess runner', () => {
  const runner = new CommandRunner();

  it('passes shell metacharacters as literal arguments', async () => {
    const literal = '$(this-must-not-execute);`nor-this`';
    const result = await runner.run(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1])', literal],
      {
        timeoutMilliseconds: 2_000,
        maximumStdoutBytes: 1_000,
      },
    );
    expect(Buffer.from(result.stdout).toString('utf8')).toBe(literal);
  });

  it('kills commands that exceed stdout or time bounds', async () => {
    await expect(
      runner.run(process.execPath, ['-e', 'process.stdout.write("x".repeat(1000))'], {
        timeoutMilliseconds: 2_000,
        maximumStdoutBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'output-limit' });
    await expect(
      runner.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        timeoutMilliseconds: 20,
        maximumStdoutBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'processing-failed' });
  });

  it('does not expose attacker-controlled diagnostics and rejects unbounded options', async () => {
    try {
      await runner.run(
        process.execPath,
        ['-e', 'process.stderr.write("ATTACKER_SECRET"); process.exit(7)'],
        {
          timeoutMilliseconds: 2_000,
          maximumStdoutBytes: 10,
        },
      );
      throw new Error('Expected the subprocess to fail.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'processing-failed' });
      expect(error instanceof Error ? error.message : '').not.toContain('ATTACKER_SECRET');
    }

    expect(
      () =>
        new CommandRunner({
          maximumDiagnosticBytes: Number.POSITIVE_INFINITY,
        }),
    ).toThrow(RangeError);
    expect(() =>
      runner.run(process.execPath, ['-e', ''], {
        timeoutMilliseconds: 2_000,
        maximumStdoutBytes: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(RangeError);
  });

  it('rejects processing limits that cannot fit a protocol media manifest', () => {
    expect(
      () =>
        new MediaProcessor({
          temporaryRoot: '/tmp/wokesocial-media-limit-test',
          limits: {
            ...defaultProcessingLimits,
            maximumHlsSegments: 63,
          },
        }),
    ).toThrow(RangeError);
  });

  it('rejects symbolic-link processor working roots', async () => {
    const root = await createTestRoot();
    try {
      const target = join(root, 'target');
      const linked = join(root, 'linked');
      await mkdir(target, { mode: 0o700 });
      await symlink(target, linked, 'dir');
      await expect(ensurePrivateWorkingRoot(linked)).rejects.toMatchObject({
        code: 'processing-failed',
      });
    } finally {
      await removeTestRoot(root);
    }
  });
});

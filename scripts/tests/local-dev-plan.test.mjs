import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  assertSafeLocalDevelopmentEnvironment,
  LOCAL_DEV_ENVIRONMENT_OVERRIDES,
  localDevTurboArguments,
  removeLocalSetupDatabaseSecrets,
} from '../local-dev-plan.mjs';

const validEnvironment = {
  APP_ENV: 'development',
  NODE_ENV: 'development',
  AUTH_HOST: '127.0.0.1',
  FEED_SERVICE_HOST: 'localhost',
  INDEXER_HOST: '::1',
  MODERATION_HOST: '[::1]',
  RELAY_HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://developer:password@127.0.0.1:5432/wokesocial',
  AUTH_DATABASE_URL: 'postgresql://developer:password@localhost:5432/wokesocial',
  AUTH_DATABASE_MIGRATION_URL: 'postgresql://auth_migration:password@localhost:5432/wokesocial',
  MODERATION_DATABASE_MIGRATION_URL:
    'postgresql://moderation_migration:password@127.0.0.1:5432/wokesocial',
  WOKENET_RPC_URLS: 'http://127.0.0.1:8899,http://localhost:8899',
};

describe('local development plan', () => {
  it('accepts the explicit loopback-only development profile', () => {
    assert.doesNotThrow(() => assertSafeLocalDevelopmentEnvironment(validEnvironment));
  });

  it('rejects production and non-loopback bindings', () => {
    assert.throws(
      () =>
        assertSafeLocalDevelopmentEnvironment({
          ...validEnvironment,
          APP_ENV: 'production',
        }),
      /local-development command/u,
    );
    assert.throws(
      () =>
        assertSafeLocalDevelopmentEnvironment({
          ...validEnvironment,
          RELAY_HOST: '0.0.0.0',
        }),
      /RELAY_HOST must bind to loopback/u,
    );
    assert.throws(
      () =>
        assertSafeLocalDevelopmentEnvironment({
          ...validEnvironment,
          DATABASE_URL: 'postgresql://operator:secret@production-db.example/wokesocial',
        }),
      /DATABASE_URL must target loopback/u,
    );
    assert.throws(
      () =>
        assertSafeLocalDevelopmentEnvironment({
          ...validEnvironment,
          AUTH_DATABASE_MIGRATION_URL:
            'postgresql://auth_migration:secret@production-db.example/wokesocial',
        }),
      /AUTH_DATABASE_MIGRATION_URL must target loopback/u,
    );
    assert.throws(
      () =>
        assertSafeLocalDevelopmentEnvironment({
          ...validEnvironment,
          MODERATION_DATABASE_MIGRATION_URL:
            'postgresql://moderation_migration:secret@production-db.example/wokesocial',
        }),
      /MODERATION_DATABASE_MIGRATION_URL must target loopback/u,
    );
    assert.throws(
      () =>
        assertSafeLocalDevelopmentEnvironment({
          ...validEnvironment,
          WOKENET_RPC_URLS: 'http://127.0.0.1:8899,https://rpc.example',
        }),
      /WOKENET_RPC_URLS must target loopback/u,
    );
  });

  it('defines conspicuous local-only authorization overrides', () => {
    assert.deepEqual(LOCAL_DEV_ENVIRONMENT_OVERRIDES, {
      MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
      RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
    });
  });

  it('removes setup and raw database credentials before launching long-running runtimes', async () => {
    const environment = {
      AUTH_DATABASE_MIGRATION_PASSWORD: 'sentinel-auth-password',
      AUTH_DATABASE_MIGRATION_URL: 'sentinel-auth-url',
      AUTH_DATABASE_RUNTIME_PASSWORD: 'sentinel-auth-runtime-password',
      INDEXER_COMPOSE_DATABASE_MIGRATION_URL: 'sentinel-indexer-override',
      MODERATION_DATABASE_MIGRATION_PASSWORD: 'sentinel-moderation-password',
      PGPASSWORD: 'sentinel-pg-password',
      POSTGRES_PASSWORD: 'sentinel-bootstrap-password',
      SAFE_RUNTIME_VALUE: 'retained',
    };
    removeLocalSetupDatabaseSecrets(environment);
    assert.deepEqual(environment, { SAFE_RUNTIME_VALUE: 'retained' });

    const source = await readFile(new URL('../dev.mjs', import.meta.url), 'utf8');
    const setup = source.indexOf("run('pnpm', ['--dir', directory, 'run', 'setup:local'])");
    const removal = source.indexOf('removeLocalSetupDatabaseSecrets(process.env)');
    const runtime = source.indexOf("run('pnpm', localDevTurboArguments())");
    assert.ok(setup >= 0 && setup < removal && removal < runtime);
  });

  it('does not expose setup-only sentinels to a sanitized child environment', () => {
    const moduleUrl = new URL('../local-dev-plan.mjs', import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { removeLocalSetupDatabaseSecrets } from ${JSON.stringify(moduleUrl)};
         removeLocalSetupDatabaseSecrets(process.env);
         console.log(JSON.stringify({
           bootstrap: 'POSTGRES_PASSWORD' in process.env,
           migrationPassword: 'AUTH_DATABASE_MIGRATION_PASSWORD' in process.env,
           migrationUrl: 'UNEXPECTED_COMPOSE_DATABASE_MIGRATION_URL' in process.env,
           safe: process.env.SAFE_RUNTIME_VALUE
         }));`,
      ],
      {
        encoding: 'utf8',
        env: {
          AUTH_DATABASE_MIGRATION_PASSWORD: 'sentinel-auth-password',
          POSTGRES_PASSWORD: 'sentinel-bootstrap-password',
          SAFE_RUNTIME_VALUE: 'retained',
          UNEXPECTED_COMPOSE_DATABASE_MIGRATION_URL: 'sentinel-migration-url',
        },
      },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      bootstrap: false,
      migrationPassword: false,
      migrationUrl: false,
      safe: 'retained',
    });
    assert.doesNotMatch(child.stdout + child.stderr, /sentinel-/u);
  });

  it('gives a runtime only its explicitly scoped database URL', () => {
    const wrapper = fileURLToPath(new URL('../run-scoped-runtime.mjs', import.meta.url));
    const child = spawnSync(
      process.execPath,
      [
        wrapper,
        'AUTH_DATABASE_URL',
        '--',
        process.execPath,
        '--eval',
        `console.log(JSON.stringify({
          auth: process.env.AUTH_DATABASE_URL,
          moderation: process.env.MODERATION_DATABASE_URL,
          runtimePassword: process.env.AUTH_DATABASE_RUNTIME_PASSWORD,
          bootstrap: process.env.POSTGRES_PASSWORD,
          safe: process.env.SAFE_RUNTIME_VALUE
        }))`,
      ],
      {
        encoding: 'utf8',
        env: {
          AUTH_DATABASE_RUNTIME_PASSWORD: 'sentinel-auth-runtime-password',
          AUTH_DATABASE_URL: 'postgresql://auth:secret@localhost/wokesocial',
          MODERATION_DATABASE_URL: 'postgresql://moderation:secret@localhost/wokesocial',
          POSTGRES_PASSWORD: 'sentinel-bootstrap-password',
          SAFE_RUNTIME_VALUE: 'retained',
        },
      },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      auth: 'postgresql://auth:secret@localhost/wokesocial',
      safe: 'retained',
    });
    assert.doesNotMatch(child.stdout + child.stderr, /sentinel-/u);
  });

  it('passes the selected environment through Turbo and excludes the containerized worker', () => {
    assert.deepEqual(localDevTurboArguments(), [
      'exec',
      'turbo',
      'run',
      'dev',
      '--env-mode=loose',
      '--filter=!@wokesocial/media-worker',
    ]);
  });

  it('guards root setup before it can start infrastructure or run migrations', async () => {
    const source = await readFile(new URL('../setup.mjs', import.meta.url), 'utf8');
    const safetyCheck = source.indexOf('assertSafeLocalDevelopmentEnvironment(process.env)');
    const infrastructureStart = source.indexOf("['scripts/infra.mjs', 'up']");

    assert.notEqual(safetyCheck, -1);
    assert.notEqual(infrastructureStart, -1);
    assert.ok(safetyCheck < infrastructureStart);
  });
});

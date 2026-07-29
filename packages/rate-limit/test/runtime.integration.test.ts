import { randomBytes } from 'node:crypto';

import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createRuntimeRateLimiter,
  deriveRateLimitRedisKey,
  type RateLimiter,
} from '../src/index.js';

const redisUrl =
  process.env['RATE_LIMIT_INTEGRATION_REDIS_URL'] ??
  'redis://:local-development-only@127.0.0.1:6379';
const keySecret = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI';
const suffix = randomBytes(8).toString('hex');
const deploymentId = `integration-${suffix}`;
const otherDeploymentId = `integration-other-${suffix}`;
const serviceId = 'integration-service';
const redisPrefix = `wokesocial:rate-limit:v1:${deploymentId}:${serviceId}`;
const rawClientKey = `203.0.113.42:${suffix}`;
const admin = createClient({
  url: redisUrl,
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 2_000,
    reconnectStrategy: false,
  },
});
const limiters: RateLimiter[] = [];

beforeAll(async () => {
  admin.on('error', () => undefined);
  await admin.connect();
});

afterAll(async () => {
  await Promise.allSettled(limiters.map((limiter) => limiter.close()));
  if (admin.isReady) {
    const keys = await admin.keys(`wokesocial:rate-limit:v1:*${suffix}*:*`);
    if (keys.length > 0) {
      await admin.del(keys);
    }
  }
  if (admin.isOpen) {
    admin.destroy();
  }
});

describe('node-redis runtime integration', () => {
  it('shares limits across replica clients without persisting raw identities', async () => {
    const [replicaA, replicaB] = await Promise.all([
      runtimeLimiter(deploymentId, serviceId),
      runtimeLimiter(deploymentId, serviceId),
    ]);
    limiters.push(replicaA, replicaB);
    const request = {
      namespace: `integration:shared:${suffix}`,
      key: rawClientKey,
      limit: 2,
      windowMs: 2_000,
    } as const;

    await deleteRequestKey(deploymentId, serviceId, request.namespace, request.key);
    expect((await replicaA.consume(request)).allowed).toBe(true);
    expect((await replicaB.consume(request)).allowed).toBe(true);
    const rejected = await replicaA.consume(request);
    expect(rejected).toMatchObject({
      allowed: false,
      count: 3,
      limit: 2,
      remaining: 0,
      reason: 'limit-exceeded',
    });

    const persisted = await admin.keys(`${redisPrefix}:*`);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).not.toContain(rawClientKey);
    expect(persisted[0]).not.toContain(request.namespace);
  });

  it('isolates namespaces, services, and deployment IDs and expires fixed windows', async () => {
    const replica = await runtimeLimiter(deploymentId, serviceId);
    const otherDeployment = await runtimeLimiter(otherDeploymentId, serviceId);
    const otherService = await runtimeLimiter(deploymentId, 'integration-other-service');
    limiters.push(replica, otherDeployment, otherService);
    const namespaceA = `integration:namespace-a:${suffix}`;
    const namespaceB = `integration:namespace-b:${suffix}`;
    const request = {
      namespace: namespaceA,
      key: rawClientKey,
      limit: 1,
      windowMs: 100,
    } as const;
    await Promise.all([
      deleteRequestKey(deploymentId, serviceId, namespaceA, rawClientKey),
      deleteRequestKey(deploymentId, serviceId, namespaceB, rawClientKey),
      deleteRequestKey(otherDeploymentId, serviceId, namespaceA, rawClientKey),
    ]);

    expect((await replica.consume(request)).allowed).toBe(true);
    expect((await replica.consume(request)).allowed).toBe(false);
    expect(
      (
        await replica.consume({
          ...request,
          namespace: namespaceB,
        })
      ).allowed,
    ).toBe(true);
    expect((await otherDeployment.consume(request)).allowed).toBe(true);
    expect((await otherService.consume(request)).allowed).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await replica.consume(request)).allowed).toBe(true);
  });

  it('fails closed after explicit lifecycle shutdown', async () => {
    const limiter = await runtimeLimiter(deploymentId, 'integration-closed');
    limiters.push(limiter);
    await limiter.close();
    await expect(
      limiter.consume({
        namespace: `integration:closed:${suffix}`,
        key: rawClientKey,
        limit: 1,
        windowMs: 1_000,
      }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITER_CLOSED',
      statusCode: 503,
    });
  });

  it('fails closed through a real disconnect and resumes only after Redis authentication recovers', async () => {
    const user = `outage-${suffix}`;
    const password = `Outage-${suffix}-private`;
    const outageDeployment = `outage-${suffix}`;
    const outageService = 'integration-outage';
    const prefix = `wokesocial:rate-limit:v1:${outageDeployment}:${outageService}`;
    await createAclUser(user, password, prefix, [
      '+eval',
      '+get',
      '+set',
      '+incr',
      '+pexpire',
      '+pttl',
      '+del',
    ]);
    let limiter: RateLimiter | undefined;
    const request = {
      namespace: `integration:outage:${suffix}`,
      key: rawClientKey,
      limit: 10,
      windowMs: 2_000,
    } as const;

    try {
      limiter = await runtimeLimiter(
        outageDeployment,
        outageService,
        authenticatedRedisUrl(user, password),
      );
      limiters.push(limiter);
      await admin.sendCommand(['ACL', 'SETUSER', user, 'off']);
      await admin.sendCommand(['CLIENT', 'KILL', 'USER', user]);
      await expect(limiter.consume(request)).rejects.toMatchObject({
        code: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
        statusCode: 503,
      });
      expect(limiter.health()).toMatchObject({
        ready: false,
        status: 'not-ready',
      });

      await admin.sendCommand(['ACL', 'SETUSER', user, 'on']);
      await waitForReady(limiter);
      await expect(limiter.consume(request)).resolves.toMatchObject({
        allowed: true,
        count: 1,
      });
    } finally {
      await limiter?.close().catch(() => undefined);
      await admin.sendCommand(['ACL', 'SETUSER', user, 'on']);
      await admin.sendCommand(['ACL', 'DELUSER', user]);
    }
  }, 10_000);

  it('keeps readiness probe state expiring when PEXPIRE is denied by Redis ACLs', async () => {
    const user = `acl-${suffix}`;
    const password = `Acl-${suffix}-private`;
    const aclDeployment = `acl-${suffix}`;
    const aclService = 'integration-acl';
    const prefix = `wokesocial:rate-limit:v1:${aclDeployment}:${aclService}`;
    await createAclUser(user, password, prefix, [
      '+eval',
      '+get',
      '+set',
      '+incr',
      '+pttl',
      '+del',
    ]);

    try {
      await expect(
        runtimeLimiter(aclDeployment, aclService, authenticatedRedisUrl(user, password)),
      ).rejects.toMatchObject({
        code: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
        statusCode: 503,
      });
      const keys = await admin.keys(`${prefix}:*`);
      expect(keys.length).toBeLessThanOrEqual(1);
      const probeKey = keys[0];
      if (probeKey !== undefined) {
        const ttl = await admin.pTTL(probeKey);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(1_000);
        await delay(1_100);
        expect(await admin.exists(probeKey)).toBe(0);
      }
    } finally {
      await admin.sendCommand(['ACL', 'DELUSER', user]);
    }
  });

  it('keeps a new admission counter expiring when a later script command loses ACL access', async () => {
    const user = `admission-${suffix}`;
    const password = `Admission-${suffix}-private`;
    const aclDeployment = `admission-${suffix}`;
    const aclService = 'integration-admission';
    const prefix = `wokesocial:rate-limit:v1:${aclDeployment}:${aclService}`;
    await createAclUser(user, password, prefix, [
      '+eval',
      '+get',
      '+set',
      '+incr',
      '+pexpire',
      '+pttl',
      '+del',
    ]);
    let limiter: RateLimiter | undefined;
    const request = {
      namespace: `integration:partial-acl:${suffix}`,
      key: rawClientKey,
      limit: 2,
      windowMs: 2_000,
    } as const;

    try {
      limiter = await runtimeLimiter(
        aclDeployment,
        aclService,
        authenticatedRedisUrl(user, password),
      );
      limiters.push(limiter);
      await admin.sendCommand(['ACL', 'SETUSER', user, '-pttl']);
      await expect(limiter.consume(request)).rejects.toMatchObject({
        code: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
        statusCode: 503,
      });

      const redisKey = derivedRequestKey(aclDeployment, aclService, request.namespace, request.key);
      const ttl = await admin.pTTL(redisKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(request.windowMs);
    } finally {
      await limiter?.close().catch(() => undefined);
      await admin.sendCommand(['ACL', 'DELUSER', user]);
    }
  });
});

async function runtimeLimiter(
  deployment: string,
  serviceId: string,
  url = redisUrl,
): Promise<RateLimiter> {
  return createRuntimeRateLimiter({
    config: {
      backend: 'redis',
      deploymentId: deployment,
      keySecret,
      redisUrl: url,
    },
    serviceId,
  });
}

async function deleteRequestKey(
  deployment: string,
  service: string,
  namespace: string,
  key: string,
): Promise<void> {
  await admin.del(derivedRequestKey(deployment, service, namespace, key));
}

function derivedRequestKey(
  deployment: string,
  service: string,
  namespace: string,
  key: string,
): string {
  const secret = Buffer.from(keySecret, 'base64url');
  try {
    return deriveRateLimitRedisKey({
      secret,
      namespace: `deployment:${deployment}:${namespace}`,
      key,
      prefix: `wokesocial:rate-limit:v1:${deployment}:${service}`,
    });
  } finally {
    secret.fill(0);
  }
}

async function createAclUser(
  user: string,
  password: string,
  prefix: string,
  dataCommands: readonly string[],
): Promise<void> {
  await admin.sendCommand([
    'ACL',
    'SETUSER',
    user,
    'reset',
    'on',
    `>${password}`,
    `~${prefix}:*`,
    '+auth',
    '+hello',
    '+ping',
    '+client|setinfo',
    '+client|setname',
    ...dataCommands,
  ]);
}

function authenticatedRedisUrl(user: string, password: string): string {
  const url = new URL(redisUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

async function waitForReady(limiter: RateLimiter): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await limiter.readiness()).ready) {
      return;
    }
    await delay(50);
  }
  throw new Error('Timed out waiting for the Redis rate limiter to recover.');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nextCli = join(appRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const buildId = join(appRoot, '.next', 'BUILD_ID');
const routes = ['/', '/home', '/feeds', '/protocol', '/settings'];
const samplesPerRoute = 3;
let server;
let browser;
let stoppingServer = false;

if (!existsSync(buildId)) {
  throw new Error('Production build is missing. Run `pnpm --filter @wetdrool/web build` first.');
}
if (!existsSync(nextCli)) {
  throw new Error(`Next.js CLI is missing at ${nextCli}.`);
}

try {
  const port = await reservePort();
  const baseURL = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const serverOutput = [];
  server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));
  server.once('exit', (code, signal) => {
    if (!stoppingServer && code !== null && code !== 0) {
      process.stderr.write(
        `Production server exited with code ${code}${signal ? ` (${signal})` : ''}.\n`,
      );
    }
  });
  await waitForServer(baseURL, server, serverOutput);

  browser = await chromium.launch();
  const measurements = [];
  for (const route of routes) {
    const samples = [];
    for (let index = 0; index < samplesPerRoute; index += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(() => {
        globalThis.__wetdroolPerformance = { cls: 0, lcpMs: 0 };
        if (PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const latest = entries.at(-1);
            if (latest) globalThis.__wetdroolPerformance.lcpMs = latest.startTime;
          }).observe({ buffered: true, type: 'largest-contentful-paint' });
        }
        if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) globalThis.__wetdroolPerformance.cls += entry.value;
            }
          }).observe({ buffered: true, type: 'layout-shift' });
        }
      });
      const response = await page.goto(`${baseURL}${route}`, {
        waitUntil: 'load',
        timeout: 30_000,
      });
      if (!response?.ok()) {
        throw new Error(`${route} returned HTTP ${response?.status() ?? 'unknown'}.`);
      }
      await page.waitForTimeout(1_000);
      samples.push(
        await page.evaluate(() => {
          const navigation = performance.getEntriesByType('navigation')[0];
          if (!navigation || !('responseStart' in navigation)) {
            throw new Error('Navigation timing entry is unavailable.');
          }
          return {
            cls: globalThis.__wetdroolPerformance.cls,
            domContentLoadedMs: navigation.domContentLoadedEventEnd,
            lcpMs: globalThis.__wetdroolPerformance.lcpMs,
            loadMs: navigation.loadEventEnd,
            ttfbMs: navigation.responseStart,
          };
        }),
      );
      await context.close();
    }
    measurements.push({
      route,
      median: {
        cls: median(samples.map((sample) => sample.cls)),
        domContentLoadedMs: median(samples.map((sample) => sample.domContentLoadedMs)),
        lcpMs: median(samples.map((sample) => sample.lcpMs)),
        loadMs: median(samples.map((sample) => sample.loadMs)),
        ttfbMs: median(samples.map((sample) => sample.ttfbMs)),
      },
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        classification: 'local-production-build-unthrottled-browser-observation-not-field-vitals',
        environment: {
          arch: process.arch,
          node: process.version,
          platform: process.platform,
        },
        measuredAt: new Date().toISOString(),
        samplesPerRoute,
        measurements,
        limitations: [
          'Loopback networking and an unthrottled headless browser are not representative of users.',
          'LCP and CLS are laboratory observations; INP and field Core Web Vitals are not measured.',
          'No production RPC, indexer, media, storage, or auth provider latency is included.',
        ],
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    stoppingServer = true;
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => server.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Number(value.toFixed(3));
}

async function reservePort() {
  const reservation = createServer();
  await new Promise((resolveListen, rejectListen) => {
    reservation.once('error', rejectListen);
    reservation.listen(0, '127.0.0.1', resolveListen);
  });
  const address = reservation.address();
  if (address === null || typeof address === 'string') {
    reservation.close();
    throw new Error('Unable to reserve a loopback port.');
  }
  await new Promise((resolveClose, rejectClose) =>
    reservation.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
  return address.port;
}

async function waitForServer(baseURL, child, output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Production server stopped before readiness:\n${output.join('')}`);
    }
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
    } catch {
      // The server has not bound its socket yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Production server did not become ready:\n${output.join('')}`);
}

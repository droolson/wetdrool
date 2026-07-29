import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { resolveWokeName } from '@wokesocial/indexer-client';
import { deriveRandomWokeName } from '@wokesocial/protocol';
import bs58 from 'bs58';

const AUTH_URL = localHttpOrigin('PUBLICATION_SLICE_AUTH_URL');
const INDEXER_URL = localHttpOrigin('PUBLICATION_SLICE_INDEXER_URL');
const RPC_URL = localHttpOrigin('PUBLICATION_SLICE_RPC_URL');
const WEB_URL = localHttpOrigin('PLAYWRIGHT_BASE_URL');
const EVIDENCE_PATH = runScopedEvidencePath('PUBLICATION_SLICE_EVIDENCE_PATH');
const FIRST_POST = required('PUBLICATION_SLICE_FIRST_POST');
const SECOND_POST = required('PUBLICATION_SLICE_SECOND_POST');
const INTENT_KEY = 'wokesocial:post-publication-intent:v1';
const EVIDENCE_SCHEMA = 'wokesocial.vertical-slice.publication-evidence.v2';
const MAX_EVIDENCE_BYTES = 32 * 1_024;
const MAX_SECURITY_SURFACE_BYTES = 4 * 1_024 * 1_024;
const MAX_SECURITY_AUDIT_BYTES = 64 * 1_024 * 1_024;
const MAX_SECURITY_SURFACE_COUNT = 4_096;
const SECURITY_CAPTURE_TIMEOUT_MS = 5_000;
const ACCOUNT_SEED_CANARY = Uint8Array.from(
  { length: 32 },
  (_, index) => (0x6d + index * 73) & 0xff,
);

type PublicationPhase = 'first-attempt' | 'first-retry' | 'second-post';

interface SendObservation {
  readonly phase: PublicationPhase;
  readonly signature: string;
  readonly wire: string;
}

interface VisiblePublicationEvidence {
  readonly cid: string;
  readonly identityAddress: string;
  readonly identityDisposition: string;
  readonly identityId: string;
  readonly networkId: string;
  readonly objectId: string;
  readonly payloadHash: string;
  readonly postDisposition: string;
  readonly postReference: string;
  readonly rootAuthority: string;
  readonly transactionSignature: string;
  readonly transactionSource: string;
  readonly finalizedSlot: string;
  readonly indexedCheckpointSlot: string;
}

interface CapturedSecretSnapshot {
  readonly accountSeeds: number[][];
  readonly prfOutputs: number[][];
}

interface SecretVault {
  readonly accountSeeds: Buffer[];
  readonly prfOutputs: Buffer[];
}

type SecuritySurfaceKind =
  | 'browser-console'
  | 'browser-pageerror'
  | 'docker-log'
  | 'http-request'
  | 'http-response'
  | 'service-log';

interface SecuritySurface {
  readonly bytes: Buffer;
  readonly kind: SecuritySurfaceKind;
}

interface SecuritySurfaceAudit {
  readonly requestCount: number;
  readonly responseCount: number;
  readonly surfaces: readonly SecuritySurface[];
  recordCaptureFailure(label: string): void;
  recordHttpResponse(headers: Readonly<Record<string, string>>, body: Buffer | string): void;
  finish(): Promise<void>;
  clear(): void;
}

test('publishes, recovers an ambiguous response, and reuses one passkey identity', async ({
  context,
  page,
}) => {
  const authenticator = await installPrfAuthenticator(context, page);
  const secretCapture = await installInMemorySecretCapture(context, page, ACCOUNT_SEED_CANARY);
  const secretVault: SecretVault = { accountSeeds: [], prfOutputs: [] };
  const securityAudit = observeSecuritySurfaces(page);
  const externalAuditBuffers: Buffer[] = [];
  const forbiddenHttpFields = new Set<string>();
  observeHttpFieldNames(page, forbiddenHttpFields);

  try {
    const sends: SendObservation[] = [];
    let phase: PublicationPhase = 'first-attempt';
    let ambiguousWire: string | undefined;
    let ambiguousSignature: string | undefined;
    let firstAttemptIndexerUnavailableCount = 0;
    let forwardedResponseLossCount = 0;
    let routeFailure: Error | undefined;
    let retrySendTransactionCount = 0;

    await page.route(
      (url) => url.origin === RPC_URL && url.pathname === '/',
      async (route) => {
        try {
          const request = route.request();
          if (request.method() !== 'POST') {
            await route.continue();
            return;
          }
          const rpc = parseRpcRequest(request.postData());
          if (rpc?.method !== 'sendTransaction') {
            const upstream = await route.fetch({ timeout: SECURITY_CAPTURE_TIMEOUT_MS });
            const body = await withDeadline(
              upstream.body(),
              SECURITY_CAPTURE_TIMEOUT_MS,
              'rpc-response-body',
            );
            securityAudit.recordHttpResponse(upstream.headers(), body);
            await route.fulfill({ response: upstream, body });
            return;
          }
          const wire = rpcWire(rpc);

          if (phase === 'first-retry') {
            retrySendTransactionCount += 1;
            await route.abort('failed');
            return;
          }

          const upstream = await route.fetch();
          const responseText = await upstream.text();
          securityAudit.recordHttpResponse(upstream.headers(), responseText);
          const signature = parseSendTransactionResponse(upstream.status(), responseText);
          sends.push({ phase, signature, wire });

          if (phase === 'first-attempt' && sends.length > 1) {
            ambiguousWire ??= wire;
            ambiguousSignature ??= signature;
            if (wire !== ambiguousWire || signature !== ambiguousSignature) {
              throw new Error('The failed first publication substituted its transaction wire.');
            }
            forwardedResponseLossCount += 1;
            await route.abort('connectionreset');
            return;
          }

          await route.fulfill({ response: upstream, body: responseText });
        } catch (error) {
          routeFailure =
            error instanceof Error
              ? error
              : new Error('RPC interception failed.', { cause: error });
          await safelyAbort(route);
        }
      },
    );
    await installResponseAuditRoute(
      page,
      securityAudit,
      (url) => url.origin === INDEXER_URL,
      'indexer',
    );
    await page.route(`${INDEXER_URL}/v1/posts/**`, async (route) => {
      if (phase === 'first-attempt') {
        firstAttemptIndexerUnavailableCount += 1;
        const body = JSON.stringify({
          error: {
            code: 'publication-test-indexer-unavailable',
            message:
              'The first attempt is intentionally held after finality to prove durable resume.',
          },
        });
        securityAudit.recordHttpResponse({ 'content-type': 'application/json' }, body);
        await route.fulfill({
          body,
          contentType: 'application/json',
          status: 503,
        });
        return;
      }
      await route.fallback();
    });
    await installResponseAuditRoute(
      page,
      securityAudit,
      (url) => url.origin === AUTH_URL && url.pathname === '/v1/session',
      'session',
    );
    await installResponseAuditRoute(
      page,
      securityAudit,
      (url) => url.origin === WEB_URL && url.pathname === '/api/localnet/cas',
      'cas',
    );

    await page.goto('/onboarding');
    const createAccount = page.getByRole('button', { name: 'Create a passkey account' });
    await expect(createAccount).toBeEnabled();
    await secretCapture.armAccountSeedCanary();
    await createAccount.click();
    await expect(
      page.getByRole('heading', {
        name: 'Embedded signing material passed its local check.',
      }),
    ).toBeVisible();
    ingestSecretSnapshot(secretVault, await secretCapture.exportAndClear());

    await page.goto('/compose');
    await page.getByLabel('Post text').fill(FIRST_POST);
    const firstPublish = page.getByRole('button', {
      name: 'Publish proof to local validator',
    });
    await expect(firstPublish).toBeEnabled();
    await firstPublish.click();

    const failedPanel = page.locator('.publication-panel[data-outcome="error"]');
    await expect(failedPanel).toBeVisible();
    await expect(
      failedPanel
        .getByRole('alert')
        .getByText(
          'The pipeline ended without complete evidence. The draft is locked to its durable coordinates for an exact retry.',
          {
            exact: true,
          },
        ),
    ).toBeVisible();
    expect(routeFailure).toBeUndefined();
    expect(ambiguousWire).toBeDefined();
    expect(ambiguousSignature).toBeDefined();
    expect(firstAttemptIndexerUnavailableCount).toBeGreaterThan(0);
    ingestSecretSnapshot(secretVault, await secretCapture.exportAndClear());

    const intentBeforeRetry = await durableIntent(page);
    expect(intentBeforeRetry.stage).toBe('finalized');
    const postReferenceBeforeRetry = stringAt(intentBeforeRetry, ['context', 'postPda']);
    expect(stringAt(intentBeforeRetry, ['context', 'content', 'body'])).toBe(FIRST_POST);
    const sendTransactionCountBeforeRetry = sends.length;
    const lostStatus = await waitForFinalizedSignature(RPC_URL, ambiguousSignature ?? '', 60_000);

    phase = 'first-retry';
    await page.reload();
    const durableResume = page.getByTestId('durable-publication-resume');
    await expect(durableResume).toBeVisible();
    await expect(durableResume).toHaveAttribute('data-durable-intent-stage', 'finalized');
    await expect(durableResume).toContainText('A durable publication is ready to resume.');
    await expect(durableResume).toContainText('Editing and discard are locked.');
    await expect(page.getByRole('group', { name: 'Post draft' })).toHaveAttribute('disabled', '');
    await expect(page.getByLabel('Post text')).toBeDisabled();
    await expect(page.getByLabel('Post text')).toHaveValue(FIRST_POST);
    await expect(page.getByRole('button', { name: 'Discard draft' })).toBeDisabled();
    const intentAfterReload = await durableIntent(page);
    expect(intentAfterReload).toEqual(intentBeforeRetry);
    const restoredIntentStage = stringAt(intentAfterReload, ['stage']);
    expect(restoredIntentStage).toBe('finalized');
    expect(stringAt(intentAfterReload, ['context', 'postPda'])).toBe(postReferenceBeforeRetry);
    const resumeExactProof = page.getByRole('button', {
      name: 'Resume exact local proof',
    });
    await expect(resumeExactProof).toBeEnabled();
    await resumeExactProof.click();
    const firstSuccess = page.locator('.publication-panel[data-outcome="success"]');
    await expect(firstSuccess).toBeVisible();
    await expect(
      firstSuccess.getByRole('heading', { name: 'One localnet post is fully evidenced.' }),
    ).toBeVisible();
    await expect(
      firstSuccess
        .getByRole('status')
        .getByText(
          'Verified complete: storage bytes, finalized post reference, and indexer checkpoint agree.',
          { exact: true },
        ),
    ).toBeVisible();
    expect(routeFailure).toBeUndefined();
    expect(retrySendTransactionCount).toBe(0);
    expect(sends).toHaveLength(sendTransactionCountBeforeRetry);

    const firstEvidence = await visiblePublicationEvidence(firstSuccess);
    expect(firstEvidence.postReference).toBe(postReferenceBeforeRetry);
    expect(firstEvidence.transactionSignature).toBe(ambiguousSignature);
    expect(firstEvidence.finalizedSlot).toBe(String(lostStatus.slot));
    expect(firstEvidence.identityDisposition).toBe('Reconciled');
    expect(firstEvidence.postDisposition).toBe('Reconciled');
    expect(firstEvidence.transactionSource).toBe('Durable intent');
    expect(firstEvidence.objectId).toBe(stringAt(intentBeforeRetry, ['signed', 'objectId']));
    expect(firstEvidence.cid).toBe(stringAt(intentBeforeRetry, ['signed', 'cid']));
    expect(firstEvidence.payloadHash).toBe(stringAt(intentBeforeRetry, ['signed', 'payloadHash']));
    expect(await page.evaluate((key) => window.localStorage.getItem(key), INTENT_KEY)).toBeNull();
    await expect(firstSuccess).not.toContainText(/archived|retained/iu);
    ingestSecretSnapshot(secretVault, await secretCapture.exportAndClear());

    const identitySend = sends[0];
    expect(identitySend?.phase).toBe('first-attempt');
    expect(identitySend?.wire).not.toBe(ambiguousWire);
    const identityStatus = await waitForFinalizedSignature(
      RPC_URL,
      identitySend?.signature ?? '',
      60_000,
    );
    const firstIndexedPost = await indexedPost(INDEXER_URL, firstEvidence.objectId);
    assertIndexedEvidence(firstIndexedPost, firstEvidence, FIRST_POST);

    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Sign out of service session' }).click();
    await expect(
      page.getByText('The authentication-service session was closed in this browser.'),
    ).toBeVisible();
    await page.goto('/signin');
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(
      page.getByRole('heading', {
        name: 'Embedded signing material passed its local check.',
      }),
    ).toBeVisible();
    ingestSecretSnapshot(secretVault, await secretCapture.exportAndClear());

    phase = 'second-post';
    const sendsBeforeSecondPost = sends.length;
    await page.goto('/compose');
    await page.getByLabel('Post text').fill(SECOND_POST);
    const secondPublish = page.getByRole('button', {
      name: 'Publish proof to local validator',
    });
    await expect(secondPublish).toBeEnabled();
    await secondPublish.click();

    const secondSuccess = page.locator('.publication-panel[data-outcome="success"]');
    await expect(secondSuccess).toBeVisible();
    const secondEvidence = await visiblePublicationEvidence(secondSuccess);
    expect(secondEvidence.networkId).toBe(firstEvidence.networkId);
    expect(secondEvidence.rootAuthority).toBe(firstEvidence.rootAuthority);
    expect(secondEvidence.identityId).toBe(firstEvidence.identityId);
    expect(secondEvidence.identityAddress).toBe(firstEvidence.identityAddress);
    expect(secondEvidence.identityDisposition).toBe('Reconciled');
    expect(secondEvidence.postDisposition).toBe('Published locally');
    expect(secondEvidence.transactionSource).toBe('Current execution');
    expect(secondEvidence.objectId).not.toBe(firstEvidence.objectId);
    expect(secondEvidence.postReference).not.toBe(firstEvidence.postReference);
    expect(sends).toHaveLength(sendsBeforeSecondPost + 1);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), INTENT_KEY)).toBeNull();
    await expect(secondSuccess).not.toContainText(/archived|retained/iu);
    ingestSecretSnapshot(secretVault, await secretCapture.exportAndClear());

    const secondSend = sends.at(-1);
    expect(secondSend?.phase).toBe('second-post');
    expect(secondSend?.signature).toBe(secondEvidence.transactionSignature);
    const secondStatus = await waitForFinalizedSignature(
      RPC_URL,
      secondEvidence.transactionSignature,
      60_000,
    );
    expect(secondEvidence.finalizedSlot).toBe(String(secondStatus.slot));
    const secondIndexedPost = await indexedPost(INDEXER_URL, secondEvidence.objectId);
    assertIndexedEvidence(secondIndexedPost, secondEvidence, SECOND_POST);

    const security = await indexedIdentity(INDEXER_URL, secondEvidence.identityId);
    expect(security.identity.identityId).toBe(secondEvidence.identityId);
    expect(security.identity.rootAuthority).toBe(secondEvidence.rootAuthority);
    expect(security.identity.active).toBe(true);
    expect(security.identity.identitySequence).toBe('3');
    const randomWokeName = deriveRandomWokeName(firstEvidence.rootAuthority);
    const wokeNameResolution = await resolveWokeName(
      {
        baseUrl: INDEXER_URL,
        deadlineMs: 5_000,
        fetch,
      },
      {
        name: randomWokeName.name,
        network: firstEvidence.networkId,
      },
    );
    expect(wokeNameResolution.kind).toBe('ready');
    if (wokeNameResolution.kind !== 'ready') {
      throw new Error('The atomic registration did not produce a resolvable .woke name.');
    }
    expect(wokeNameResolution.value.name).toBe(randomWokeName.name);
    expect(wokeNameResolution.value.handle).toBe(randomWokeName.handle);
    expect(wokeNameResolution.value.destination.address).toBe(firstEvidence.rootAuthority);
    expect(wokeNameResolution.value.destination.nativeAddress).toBe(false);
    expect(wokeNameResolution.value.identity.identityId).toBe(firstEvidence.identityId);
    expect(wokeNameResolution.value.identity.identityAddress).toBe(firstEvidence.identityAddress);
    expect(wokeNameResolution.value.identity.identitySequence).toBe('3');
    expect(wokeNameResolution.value.claim.identitySequence).toBe('1');
    expect(BigInt(wokeNameResolution.value.claim.claimedSlot)).toBe(BigInt(identityStatus.slot));
    expect(BigInt(wokeNameResolution.value.meta.checkpointSlot ?? -1)).toBeGreaterThanOrEqual(
      BigInt(secondEvidence.indexedCheckpointSlot),
    );
    expect(authenticator.assertedCredentialCount).toBeGreaterThanOrEqual(3);
    expect(secretVault.accountSeeds).toHaveLength(1);
    expect(secretVault.prfOutputs.length).toBeGreaterThanOrEqual(5);
    const canaryRootAuthority = bs58.encode(ed25519.getPublicKey(ACCOUNT_SEED_CANARY));
    expect(firstEvidence.rootAuthority).toBe(canaryRootAuthority);
    expect(secondEvidence.rootAuthority).toBe(canaryRootAuthority);

    const uniqueWires = new Set(sends.map((send) => send.wire));
    expect(uniqueWires.size).toBe(3);
    expect(forbiddenHttpFields.size).toBe(0);

    await securityAudit.finish();
    const serviceLogs = await readRunServiceLogSurfaces(EVIDENCE_PATH);
    const dockerLog = readDockerLogSurface(required('PUBLICATION_SLICE_POSTGRES_CONTAINER'));
    externalAuditBuffers.push(
      ...serviceLogs.surfaces.map((surface) => surface.bytes),
      dockerLog.bytes,
    );
    const securityScan = scanSecretSurfaces(
      [...securityAudit.surfaces, ...serviceLogs.surfaces, dockerLog],
      secretVault,
    );
    expect(securityScan.totalMatchCount).toBe(0);

    const evidence = {
      schema: EVIDENCE_SCHEMA,
      generatedAt: new Date().toISOString(),
      networkId: firstEvidence.networkId,
      programId: firstEvidence.networkId.split(':').at(-1),
      identity: {
        identityId: firstEvidence.identityId,
        identityAddress: firstEvidence.identityAddress,
        rootAuthority: firstEvidence.rootAuthority,
        creationTransactionSignature: identitySend?.signature,
        creationFinalizedSlot: String(identityStatus.slot),
        identityCreationSendTransactionCount: 1,
      },
      wokeName: {
        name: wokeNameResolution.value.name,
        handle: wokeNameResolution.value.handle,
        handleClaimAddress: wokeNameResolution.value.claim.handleClaimAddress,
        handleHash: wokeNameResolution.value.claim.handleHash,
        identitySequence: wokeNameResolution.value.claim.identitySequence,
        claimedSlot: wokeNameResolution.value.claim.claimedSlot,
        resolutionCheckpointSlot: String(wokeNameResolution.value.meta.checkpointSlot),
      },
      posts: [
        syntheticPostEvidence(firstEvidence, FIRST_POST),
        syntheticPostEvidence(secondEvidence, SECOND_POST),
      ],
      ambiguousRetry: {
        firstAttemptIndexerUnavailableCount,
        forwardedResponseLossCount,
        wireSha256: createHash('sha256')
          .update(ambiguousWire ?? '')
          .digest('hex'),
        transactionSignature: ambiguousSignature,
        postReferenceBeforeRetry,
        postReferenceAfterRetry: firstEvidence.postReference,
        sendTransactionCountBeforeRetry,
        sendTransactionCountAfterRetry: sends.length - 1,
        reloadCount: 1,
        restoredIntentStage,
        draftLockedAfterReload: true,
        uniqueTransactionWireCount: uniqueWires.size,
      },
      security: {
        accountSeedCanaryCaptureCount: secretVault.accountSeeds.length,
        accountSeedCanarySha256: createHash('sha256').update(ACCOUNT_SEED_CANARY).digest('hex'),
        browserDiagnosticSecretMatchCount: securityScan.browserDiagnosticMatchCount,
        capturedPrfOutputCount: secretVault.prfOutputs.length,
        dockerLogSecretMatchCount: securityScan.dockerLogMatchCount,
        forbiddenHttpFieldNameCount: forbiddenHttpFields.size,
        httpRequestCount: securityAudit.requestCount,
        httpRequestSecretMatchCount: securityScan.httpRequestMatchCount,
        httpResponseCount: securityAudit.responseCount,
        httpResponseSecretMatchCount: securityScan.httpResponseMatchCount,
        scannedDockerLogBytes: dockerLog.bytes.byteLength,
        scannedHttpAndBrowserBytes: securityScan.httpAndBrowserBytes,
        scannedServiceLogBytes: serviceLogs.byteLength,
        serviceLogCount: serviceLogs.surfaces.length,
        serviceLogSecretMatchCount: securityScan.serviceLogMatchCount,
        zeroSecretMatches: securityScan.totalMatchCount === 0,
      },
    };
    expect(evidence.programId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/u);
    expect(evidence.ambiguousRetry.sendTransactionCountAfterRetry).toBe(
      sendTransactionCountBeforeRetry,
    );
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(MAX_EVIDENCE_BYTES);
    await writeFile(EVIDENCE_PATH, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } finally {
    await secretCapture.dispose();
    clearSecretVault(secretVault);
    securityAudit.clear();
    for (const bytes of externalAuditBuffers) bytes.fill(0);
    externalAuditBuffers.length = 0;
    ACCOUNT_SEED_CANARY.fill(0);
  }
});

async function installPrfAuthenticator(
  context: BrowserContext,
  page: Page,
): Promise<{ readonly assertedCredentialCount: number }> {
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      hasPrf: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      defaultBackupEligibility: false,
      defaultBackupState: false,
    },
  });
  const observed = { count: 0 };
  client.on('WebAuthn.credentialAsserted', () => {
    observed.count += 1;
  });
  return {
    get assertedCredentialCount() {
      return observed.count;
    },
  };
}

async function installInMemorySecretCapture(
  context: BrowserContext,
  page: Page,
  accountSeedCanary: Uint8Array,
): Promise<{
  armAccountSeedCanary(): Promise<void>;
  dispose(): Promise<void>;
  exportAndClear(): Promise<CapturedSecretSnapshot>;
}> {
  const canary = [...accountSeedCanary];
  await context.addInitScript(
    ({ seedCanary }: { readonly seedCanary: readonly number[] }) => {
      const captureKey = '__wokesocialE2eSecretAudit';
      const state: {
        accountSeedArmed: boolean;
        accountSeeds: Uint8Array[];
        prfOutputs: Uint8Array[];
      } = {
        accountSeedArmed: false,
        accountSeeds: [],
        prfOutputs: [],
      };
      const cryptoPrototype = Object.getPrototypeOf(globalThis.crypto) as Crypto;
      const originalRandomValues = cryptoPrototype.getRandomValues;
      const credentialPrototype = globalThis.PublicKeyCredential.prototype;
      const originalExtensionResults = credentialPrototype.getClientExtensionResults;

      function copyBufferSource(value: BufferSource): Uint8Array {
        if (value instanceof ArrayBuffer) return new Uint8Array(value).slice();
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
      }

      function clearCaptured(): void {
        for (const bytes of [...state.accountSeeds, ...state.prfOutputs]) bytes.fill(0);
        state.accountSeeds = [];
        state.prfOutputs = [];
        state.accountSeedArmed = false;
      }

      Object.defineProperty(cryptoPrototype, 'getRandomValues', {
        configurable: true,
        writable: true,
        value: function getRandomValues<T extends ArrayBufferView | null>(
          this: Crypto,
          array: T,
        ): T {
          if (
            state.accountSeedArmed &&
            state.accountSeeds.length === 0 &&
            array instanceof Uint8Array &&
            array.byteLength === 32
          ) {
            array.set(seedCanary);
            state.accountSeeds.push(array.slice());
            state.accountSeedArmed = false;
            return array;
          }
          return Reflect.apply(originalRandomValues, this, [array]) as T;
        },
      });
      Object.defineProperty(credentialPrototype, 'getClientExtensionResults', {
        configurable: true,
        writable: true,
        value: function getClientExtensionResults(this: PublicKeyCredential) {
          const results = originalExtensionResults.call(this);
          const first = results.prf?.results?.first;
          if (first !== undefined) state.prfOutputs.push(copyBufferSource(first));
          return results;
        },
      });

      const api = {
        armAccountSeedCanary(): true {
          if (state.accountSeedArmed || state.accountSeeds.length !== 0) {
            throw new Error('The account-seed canary was armed more than once in one document.');
          }
          state.accountSeedArmed = true;
          return true;
        },
        dispose(): true {
          clearCaptured();
          Object.defineProperty(cryptoPrototype, 'getRandomValues', {
            configurable: true,
            writable: true,
            value: originalRandomValues,
          });
          Object.defineProperty(credentialPrototype, 'getClientExtensionResults', {
            configurable: true,
            writable: true,
            value: originalExtensionResults,
          });
          Reflect.deleteProperty(globalThis, captureKey);
          return true;
        },
        exportAndClear(): CapturedSecretSnapshot {
          const snapshot = {
            accountSeeds: state.accountSeeds.map((bytes) => [...bytes]),
            prfOutputs: state.prfOutputs.map((bytes) => [...bytes]),
          };
          clearCaptured();
          return snapshot;
        },
      };
      Object.defineProperty(globalThis, captureKey, {
        configurable: true,
        enumerable: false,
        value: api,
        writable: false,
      });
    },
    { seedCanary: canary },
  );
  canary.fill(0);
  const client = await context.newCDPSession(page);

  async function evaluate<Result>(method: string): Promise<Result> {
    const response = await client.send('Runtime.evaluate', {
      expression: `globalThis.__wokesocialE2eSecretAudit?.${method}()`,
      returnByValue: true,
    });
    if (response.exceptionDetails !== undefined || response.result.value === undefined) {
      throw new Error(`The in-memory browser secret capture could not ${method}.`);
    }
    return response.result.value as Result;
  }

  return {
    async armAccountSeedCanary() {
      if ((await evaluate<unknown>('armAccountSeedCanary')) !== true) {
        throw new Error('The in-memory account-seed canary could not be armed.');
      }
    },
    async dispose() {
      try {
        await evaluate<unknown>('dispose');
      } catch {
        // The page or its execution context may already be gone after a test failure.
      }
      await client.detach().catch(() => undefined);
    },
    async exportAndClear() {
      const value = await evaluate<unknown>('exportAndClear');
      return capturedSecretSnapshot(value);
    },
  };
}

function ingestSecretSnapshot(vault: SecretVault, snapshot: CapturedSecretSnapshot): void {
  ingest(snapshot.accountSeeds, vault.accountSeeds, 'account seed');
  ingest(snapshot.prfOutputs, vault.prfOutputs, 'PRF output');

  function ingest(values: number[][], destination: Buffer[], label: string): void {
    if (values.length > 16) {
      throw new Error(`The in-memory ${label} capture exceeded its per-document bound.`);
    }
    for (const value of values) {
      if (
        value.length !== 32 ||
        value.some((byte) => !Number.isSafeInteger(byte) || byte < 0 || byte > 255)
      ) {
        value.fill(0);
        throw new Error(`The in-memory ${label} capture was not one exact 32-byte value.`);
      }
      destination.push(Buffer.from(value));
      value.fill(0);
    }
  }
}

function capturedSecretSnapshot(value: unknown): CapturedSecretSnapshot {
  if (
    !isRecord(value) ||
    !Array.isArray(value['accountSeeds']) ||
    !Array.isArray(value['prfOutputs']) ||
    Object.keys(value).sort().join('\0') !== 'accountSeeds\0prfOutputs'
  ) {
    throw new Error('The CDP-only secret observation channel returned an invalid snapshot.');
  }
  return {
    accountSeeds: value['accountSeeds'] as number[][],
    prfOutputs: value['prfOutputs'] as number[][],
  };
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMilliseconds: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`The bounded ${label} capture exceeded its deadline.`));
        }, timeoutMilliseconds);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function installResponseAuditRoute(
  page: Page,
  securityAudit: SecuritySurfaceAudit,
  matches: (url: URL) => boolean,
  label: string,
): Promise<void> {
  await page.route(matches, async (route) => {
    try {
      const upstream = await route.fetch({ timeout: SECURITY_CAPTURE_TIMEOUT_MS });
      const body = await withDeadline(
        upstream.body(),
        SECURITY_CAPTURE_TIMEOUT_MS,
        `${label}-response-body`,
      );
      securityAudit.recordHttpResponse(upstream.headers(), body);
      await route.fulfill({ response: upstream, body });
    } catch {
      securityAudit.recordCaptureFailure(`${label}-response-route-unreadable`);
      await safelyAbort(route);
    }
  });
}

function observeSecuritySurfaces(page: Page): SecuritySurfaceAudit {
  const surfaces: SecuritySurface[] = [];
  const pending = new Set<Promise<void>>();
  const captureFailures = new Set<string>();
  const responseBodyDigests = new Set<string>();
  let byteLength = 0;
  let requestCount = 0;
  let responseCount = 0;

  function retain(kind: SecuritySurfaceKind, value: Buffer | string, label: string): void {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    if (bytes.byteLength > MAX_SECURITY_SURFACE_BYTES) {
      bytes.fill(0);
      captureFailures.add(`${label}-oversized`);
      return;
    }
    if (
      surfaces.length >= MAX_SECURITY_SURFACE_COUNT ||
      byteLength + bytes.byteLength > MAX_SECURITY_AUDIT_BYTES
    ) {
      bytes.fill(0);
      captureFailures.add('aggregate-bound-exceeded');
      return;
    }
    byteLength += bytes.byteLength;
    surfaces.push({ bytes, kind });
  }

  function retainResponseBody(value: Buffer | string): void {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (responseBodyDigests.has(digest)) {
      bytes.fill(0);
      return;
    }
    responseBodyDigests.add(digest);

    const chunkCount = Math.max(1, Math.ceil(bytes.byteLength / MAX_SECURITY_SURFACE_BYTES));
    if (
      surfaces.length + chunkCount > MAX_SECURITY_SURFACE_COUNT ||
      byteLength + bytes.byteLength > MAX_SECURITY_AUDIT_BYTES
    ) {
      bytes.fill(0);
      captureFailures.add('aggregate-bound-exceeded');
      return;
    }
    if (bytes.byteLength === 0) {
      surfaces.push({ bytes, kind: 'http-response' });
      return;
    }
    for (let offset = 0; offset < bytes.byteLength; offset += MAX_SECURITY_SURFACE_BYTES) {
      const chunk = Buffer.from(bytes.subarray(offset, offset + MAX_SECURITY_SURFACE_BYTES));
      byteLength += chunk.byteLength;
      surfaces.push({ bytes: chunk, kind: 'http-response' });
    }
    bytes.fill(0);
  }

  function queue(label: string, operation: () => Promise<void>): void {
    const task = withDeadline(operation(), SECURITY_CAPTURE_TIMEOUT_MS, label)
      .catch(() => {
        captureFailures.add(`${label}-unreadable`);
      })
      .finally(() => {
        pending.delete(task);
      });
    pending.add(task);
  }

  page.on('request', (request) => {
    if (!/^https?:$/u.test(new URL(request.url()).protocol)) return;
    requestCount += 1;
    queue('request', async () => {
      retain(
        'http-request',
        JSON.stringify(Object.entries(await request.allHeaders()).sort()),
        'request-headers',
      );
      const url = new URL(request.url());
      retain(
        'http-request',
        JSON.stringify({
          decoded: [...url.searchParams.entries()],
          raw: url.search,
        }),
        'request-query',
      );
      const body = request.postDataBuffer();
      if (body !== null) retain('http-request', body, 'request-body');
    });
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (!/^https?:$/u.test(url.protocol)) return;
    responseCount += 1;
    retain(
      'http-response',
      JSON.stringify(Object.entries(response.headers()).sort()),
      'response-headers',
    );
  });
  page.on('console', (message) => {
    retain('browser-console', message.text(), 'browser-console');
  });
  page.on('pageerror', (error) => {
    retain('browser-pageerror', error.stack ?? error.message, 'browser-pageerror');
  });

  return {
    get requestCount() {
      return requestCount;
    },
    get responseCount() {
      return responseCount;
    },
    get surfaces() {
      return surfaces;
    },
    recordCaptureFailure(label) {
      captureFailures.add(label);
    },
    recordHttpResponse(headers, body) {
      responseCount += 1;
      retain(
        'http-response',
        JSON.stringify(Object.entries(headers).sort()),
        'manually-forwarded-response-headers',
      );
      retainResponseBody(body);
    },
    async finish() {
      await page.waitForTimeout(100);
      const finishDeadline = Date.now() + SECURITY_CAPTURE_TIMEOUT_MS;
      while (pending.size > 0 && Date.now() < finishDeadline) {
        await Promise.race([
          Promise.allSettled([...pending]),
          new Promise<void>((resolve) => setTimeout(resolve, 25)),
        ]);
      }
      if (pending.size > 0) captureFailures.add('pending-capture-timeout');
      if (captureFailures.size > 0) {
        throw new Error(
          `The bounded secret audit failed closed for ${[...captureFailures].sort().join(', ')}.`,
        );
      }
    },
    clear() {
      for (const surface of surfaces) surface.bytes.fill(0);
      surfaces.length = 0;
      byteLength = 0;
      responseBodyDigests.clear();
    },
  };
}

async function readRunServiceLogSurfaces(evidencePath: string): Promise<{
  readonly byteLength: number;
  readonly surfaces: readonly SecuritySurface[];
}> {
  const logDirectory = join(dirname(evidencePath), 'logs');
  const entries = (await readdir(logDirectory, { withFileTypes: true }))
    .filter((entry) => entry.name.endsWith('.log'))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) {
    throw new Error('The run-scoped service-log audit found no retained service logs.');
  }
  const surfaces: SecuritySurface[] = [];
  let byteLength = 0;
  try {
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error('The run-scoped service-log audit refuses non-regular log targets.');
      }
      const path = join(logDirectory, entry.name);
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_SECURITY_SURFACE_BYTES) {
        throw new Error('A run-scoped service log exceeded the closed audit bound.');
      }
      const bytes = await readFile(path);
      if (
        bytes.byteLength > MAX_SECURITY_SURFACE_BYTES ||
        byteLength + bytes.byteLength > MAX_SECURITY_AUDIT_BYTES
      ) {
        bytes.fill(0);
        throw new Error('The run-scoped service logs exceeded the closed aggregate audit bound.');
      }
      byteLength += bytes.byteLength;
      surfaces.push({ bytes, kind: 'service-log' });
    }
    return { byteLength, surfaces };
  } catch (error) {
    for (const surface of surfaces) surface.bytes.fill(0);
    throw error;
  }
}

function readDockerLogSurface(containerName: string): SecuritySurface {
  if (!/^wokesocial-vertical-[0-9]+-[a-f0-9]{8}$/u.test(containerName)) {
    throw new Error('The Docker-log secret audit received an invalid disposable container name.');
  }
  const result = spawnSync('docker', ['logs', containerName], {
    encoding: 'buffer',
    maxBuffer: MAX_SECURITY_SURFACE_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
    result.stdout?.fill(0);
    result.stderr?.fill(0);
    throw new Error('The disposable PostgreSQL logs were unavailable to the secret audit.');
  }
  const bytes = Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]);
  result.stdout?.fill(0);
  result.stderr?.fill(0);
  if (bytes.byteLength > MAX_SECURITY_SURFACE_BYTES) {
    bytes.fill(0);
    throw new Error('The disposable PostgreSQL logs exceeded the closed audit bound.');
  }
  return { bytes, kind: 'docker-log' };
}

function scanSecretSurfaces(
  surfaces: readonly SecuritySurface[],
  vault: SecretVault,
): {
  readonly browserDiagnosticMatchCount: number;
  readonly dockerLogMatchCount: number;
  readonly httpAndBrowserBytes: number;
  readonly httpRequestMatchCount: number;
  readonly httpResponseMatchCount: number;
  readonly serviceLogMatchCount: number;
  readonly totalMatchCount: number;
} {
  const patterns = secretPatterns([...vault.accountSeeds, ...vault.prfOutputs]);
  let browserDiagnosticMatchCount = 0;
  let dockerLogMatchCount = 0;
  let httpAndBrowserBytes = 0;
  let httpRequestMatchCount = 0;
  let httpResponseMatchCount = 0;
  let serviceLogMatchCount = 0;
  try {
    for (const surface of surfaces) {
      if (
        surface.kind === 'http-request' ||
        surface.kind === 'http-response' ||
        surface.kind === 'browser-console' ||
        surface.kind === 'browser-pageerror'
      ) {
        httpAndBrowserBytes += surface.bytes.byteLength;
      }
      for (const pattern of patterns) {
        let offset = 0;
        while (offset <= surface.bytes.byteLength - pattern.byteLength) {
          const match = surface.bytes.indexOf(pattern, offset);
          if (match === -1) break;
          if (surface.kind === 'http-request') httpRequestMatchCount += 1;
          else if (surface.kind === 'http-response') httpResponseMatchCount += 1;
          else if (surface.kind === 'service-log') serviceLogMatchCount += 1;
          else if (surface.kind === 'docker-log') dockerLogMatchCount += 1;
          else browserDiagnosticMatchCount += 1;
          offset = match + pattern.byteLength;
        }
      }
    }
  } finally {
    for (const pattern of patterns) pattern.fill(0);
  }
  return {
    browserDiagnosticMatchCount,
    dockerLogMatchCount,
    httpAndBrowserBytes,
    httpRequestMatchCount,
    httpResponseMatchCount,
    serviceLogMatchCount,
    totalMatchCount:
      browserDiagnosticMatchCount +
      dockerLogMatchCount +
      httpRequestMatchCount +
      httpResponseMatchCount +
      serviceLogMatchCount,
  };
}

function secretPatterns(secrets: readonly Buffer[]): Buffer[] {
  const patterns: Buffer[] = [];
  const seen = new Set<string>();
  for (const secret of secrets) {
    const base64 = secret.toString('base64');
    const base64Url = base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    const decimal = [...secret];
    const candidates: (Buffer | string)[] = [
      secret,
      secret.toString('hex'),
      secret.toString('hex').toUpperCase(),
      base64,
      base64.replace(/=+$/u, ''),
      base64Url,
      `${base64Url}${'='.repeat((4 - (base64Url.length % 4)) % 4)}`,
      JSON.stringify(decimal),
      `[${decimal.join(', ')}]`,
      decimal.join(','),
      decimal.join(', '),
      encodeURIComponent(base64),
      encodeURIComponent(base64Url),
    ];
    for (const candidate of candidates) {
      const bytes =
        typeof candidate === 'string' ? Buffer.from(candidate, 'utf8') : Buffer.from(candidate);
      const fingerprint = createHash('sha256').update(bytes).digest('hex');
      if (seen.has(fingerprint)) {
        bytes.fill(0);
      } else {
        seen.add(fingerprint);
        patterns.push(bytes);
      }
    }
  }
  return patterns;
}

function clearSecretVault(vault: SecretVault): void {
  for (const secret of [...vault.accountSeeds, ...vault.prfOutputs]) secret.fill(0);
  vault.accountSeeds.length = 0;
  vault.prfOutputs.length = 0;
}

function observeHttpFieldNames(page: Page, forbidden: Set<string>): void {
  const forbiddenField =
    /^(?:prf(?:output|results?)?|accountkeyseed|privatekey|plaintextkey|seed|secretkey|recoverysecret)$/iu;
  page.on('request', (request) => {
    if (!/^https?:$/u.test(new URL(request.url()).protocol)) return;
    for (const name of Object.keys(request.headers())) {
      if (forbiddenField.test(normalizeField(name))) forbidden.add(name);
    }
    const url = new URL(request.url());
    for (const name of url.searchParams.keys()) {
      if (forbiddenField.test(normalizeField(name))) forbidden.add(name);
    }
    const data = request.postData();
    if (data === null) return;
    try {
      findForbiddenFields(JSON.parse(data), forbiddenField, forbidden);
    } catch {
      // Non-JSON bodies have no structured field names. The CAS request is
      // canonical JSON bytes and is parsed by this branch in the acceptance run.
    }
  });
}

function findForbiddenFields(
  value: unknown,
  pattern: RegExp,
  forbidden: Set<string>,
  depth = 0,
): void {
  if (depth > 32 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) findForbiddenFields(item, pattern, forbidden, depth + 1);
    return;
  }
  for (const [name, nested] of Object.entries(value)) {
    if (pattern.test(normalizeField(name))) forbidden.add(name);
    findForbiddenFields(nested, pattern, forbidden, depth + 1);
  }
}

function normalizeField(value: string): string {
  return value.replace(/[^a-z]/giu, '');
}

function parseRpcRequest(data: string | null): Record<string, unknown> | undefined {
  if (data === null || Buffer.byteLength(data) > 2_000_000) return undefined;
  try {
    const value = JSON.parse(data);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function rpcWire(request: Record<string, unknown>): string {
  const params = request['params'];
  const wire = Array.isArray(params) ? params[0] : undefined;
  if (typeof wire !== 'string' || wire.length < 100 || wire.length > 100_000) {
    throw new Error('sendTransaction did not carry one bounded encoded transaction wire.');
  }
  return wire;
}

function parseSendTransactionResponse(status: number, value: string): string {
  if (status !== 200 || Buffer.byteLength(value) > 16_384) {
    throw new Error(`Local sendTransaction returned HTTP ${String(status)}.`);
  }
  const parsed = JSON.parse(value) as unknown;
  if (
    !isRecord(parsed) ||
    typeof parsed['result'] !== 'string' ||
    !/^[1-9A-HJ-NP-Za-km-z]{64,128}$/u.test(parsed['result'])
  ) {
    throw new Error('Local sendTransaction returned an invalid signature.');
  }
  return parsed['result'];
}

async function safelyAbort(route: Route): Promise<void> {
  try {
    await route.abort('failed');
  } catch {
    // The route may already have been resolved by the failing branch.
  }
}

async function durableIntent(page: Page): Promise<Record<string, unknown>> {
  const serialized = await page.evaluate((key) => window.localStorage.getItem(key), INTENT_KEY);
  expect(serialized).not.toBeNull();
  expect(Buffer.byteLength(serialized ?? '')).toBeLessThanOrEqual(128 * 1_024);
  const value = JSON.parse(serialized ?? 'null') as unknown;
  expect(isRecord(value)).toBe(true);
  return value as Record<string, unknown>;
}

async function visiblePublicationEvidence(
  panel: ReturnType<Page['locator']>,
): Promise<VisiblePublicationEvidence> {
  const entries = await panel
    .locator('dl[aria-label="Verified localnet publication evidence"] > div')
    .evaluateAll((rows) =>
      Object.fromEntries(
        rows.map((row) => [
          row.querySelector('dt')?.textContent?.trim() ?? '',
          row.querySelector('dd')?.textContent?.trim() ?? '',
        ]),
      ),
    );
  const value = (label: string) => {
    const candidate = entries[label];
    expect(candidate, `${label} evidence`).toBeTruthy();
    return candidate ?? '';
  };
  return {
    networkId: value('WokeNet deployment'),
    rootAuthority: value('Root authority'),
    identityDisposition: value('Identity disposition'),
    identityId: value('WokeSocial identity ID'),
    identityAddress: value('Identity account'),
    postDisposition: value('Post disposition'),
    postReference: value('Post reference account'),
    objectId: value('Object ID'),
    cid: value('Content CID'),
    payloadHash: value('Canonical payload hash'),
    transactionSignature: value('Finalized post transaction'),
    finalizedSlot: value('Finalized post slot'),
    transactionSource: value('Transaction evidence'),
    indexedCheckpointSlot: value('Indexed checkpoint slot'),
  };
}

function stringAt(value: unknown, path: readonly string[]): string {
  let current = value;
  for (const part of path) {
    if (!isRecord(current)) throw new Error(`Missing durable intent field ${path.join('.')}.`);
    current = current[part];
  }
  if (typeof current !== 'string' || current.length === 0) {
    throw new Error(`Invalid durable intent field ${path.join('.')}.`);
  }
  return current;
}

async function waitForFinalizedSignature(
  rpcUrl: string,
  signature: string,
  timeoutMilliseconds: number,
): Promise<{ readonly slot: number }> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/u.test(signature)) {
    throw new Error('Cannot poll an invalid local transaction signature.');
  }
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'getSignatureStatuses',
        params: [[signature], { searchTransactionHistory: true }],
      }),
      signal: AbortSignal.timeout(3_000),
    });
    const value = (await response.json()) as unknown;
    const status =
      isRecord(value) && isRecord(value['result']) && Array.isArray(value['result']['value'])
        ? value['result']['value'][0]
        : undefined;
    if (isRecord(status) && status['err'] !== null) {
      throw new Error(`Local transaction failed: ${JSON.stringify(status['err'])}`);
    }
    if (
      isRecord(status) &&
      status['confirmationStatus'] === 'finalized' &&
      Number.isSafeInteger(status['slot'])
    ) {
      return { slot: status['slot'] as number };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Local transaction did not reach finalized status within the acceptance bound.');
}

async function indexedPost(baseUrl: string, objectId: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/v1/posts/${encodeURIComponent(objectId)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });
  expect(response.ok).toBe(true);
  const value = (await response.json()) as unknown;
  expect(isRecord(value)).toBe(true);
  return value as Record<string, unknown>;
}

function assertIndexedEvidence(
  response: Record<string, unknown>,
  evidence: VisiblePublicationEvidence,
  body: string,
): void {
  const post = recordAt(response, 'post');
  const verification = recordAt(post, 'verification');
  const anchor = recordAt(verification, 'anchor');
  const meta = recordAt(response, 'meta');
  expect(post['id']).toBe(evidence.objectId);
  expect(post['body']).toBe(body);
  expect(verification['state']).toBe('verified');
  expect(verification['contentHash']).toBe(evidence.payloadHash);
  expect(verification['manifestUri']).toBe(`ipfs://${evidence.cid}`);
  expect(anchor['finality']).toBe('finalized');
  expect(anchor['transaction']).toBe(evidence.transactionSignature);
  expect(anchor['slot']).toBe(Number(evidence.finalizedSlot));
  expect(Number(meta['checkpointSlot'])).toBeGreaterThanOrEqual(
    Number(evidence.indexedCheckpointSlot),
  );
}

async function indexedIdentity(
  baseUrl: string,
  identityId: string,
): Promise<{
  readonly identity: {
    readonly active: boolean;
    readonly identityId: string;
    readonly identitySequence: string;
    readonly rootAuthority: string;
  };
}> {
  const response = await fetch(
    `${baseUrl}/v1/identities/${encodeURIComponent(identityId)}/security`,
    {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    },
  );
  expect(response.ok).toBe(true);
  return (await response.json()) as {
    identity: {
      active: boolean;
      identityId: string;
      identitySequence: string;
      rootAuthority: string;
    };
  };
}

function syntheticPostEvidence(evidence: VisiblePublicationEvidence, body: string) {
  return {
    body,
    objectId: evidence.objectId,
    postReference: evidence.postReference,
    cid: evidence.cid,
    payloadHash: evidence.payloadHash,
    transactionSignature: evidence.transactionSignature,
    finalizedSlot: evidence.finalizedSlot,
    indexedCheckpointSlot: evidence.indexedCheckpointSlot,
  };
}

function recordAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = value[key];
  if (!isRecord(nested)) throw new Error(`Expected ${key} to be an object.`);
  return nested;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function localHttpOrigin(name: string): string {
  const value = required(name);
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== value
  ) {
    throw new Error(`${name} must be an exact loopback HTTP origin.`);
  }
  return url.origin;
}

function runScopedEvidencePath(name: string): string {
  const value = required(name);
  const parent = dirname(value);
  if (
    !isAbsolute(value) ||
    basename(value) !== 'publication-evidence.json' ||
    !/^run-[A-Za-z0-9._-]+$/u.test(basename(parent)) ||
    basename(dirname(parent)) !== 'vertical-slice'
  ) {
    throw new Error(`${name} must be the run-scoped publication evidence path.`);
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for browser publication verification.`);
  return value;
}

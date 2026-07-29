import { readFile, stat } from 'node:fs/promises';

export const PUBLICATION_EVIDENCE_SCHEMA = 'wokesocial.vertical-slice.publication-evidence.v2';
export const BASELINE_DURABLE_EVENT_COUNT = 10;
export const MAX_PUBLICATION_EVIDENCE_BYTES = 32 * 1_024;

const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

export async function readPublicationEvidence(path, expected = {}) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 2 || info.size > MAX_PUBLICATION_EVIDENCE_BYTES) {
    throw new Error('Publication evidence must be one bounded regular JSON file.');
  }
  let value;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error('Publication evidence is not valid UTF-8 JSON.', { cause: error });
  }
  return assertPublicationEvidence(value, expected);
}

export function assertPublicationEvidence(value, expected = {}) {
  exactRecord(value, [
    'ambiguousRetry',
    'generatedAt',
    'identity',
    'networkId',
    'posts',
    'programId',
    'schema',
    'security',
    'wokeName',
  ]);
  if (
    value.schema !== PUBLICATION_EVIDENCE_SCHEMA ||
    !timestamp(value.generatedAt) ||
    !bounded(value.networkId, 256) ||
    !publicKey(value.programId) ||
    (expected.networkId !== undefined && value.networkId !== expected.networkId) ||
    (expected.programId !== undefined && value.programId !== expected.programId)
  ) {
    throw new Error('Publication evidence deployment coordinates are invalid.');
  }

  exactRecord(value.identity, [
    'creationFinalizedSlot',
    'creationTransactionSignature',
    'identityAddress',
    'identityCreationSendTransactionCount',
    'identityId',
    'rootAuthority',
  ]);
  if (
    !bounded(value.identity.identityId, 512) ||
    !value.identity.identityId.endsWith(`:${value.identity.identityAddress}`) ||
    !value.identity.identityId.includes(`:${value.networkId}:`) ||
    !publicKey(value.identity.identityAddress) ||
    !publicKey(value.identity.rootAuthority) ||
    !transactionSignature(value.identity.creationTransactionSignature) ||
    !decimal(value.identity.creationFinalizedSlot) ||
    value.identity.identityCreationSendTransactionCount !== 1
  ) {
    throw new Error('Publication evidence identity proof is invalid.');
  }

  exactRecord(value.wokeName, [
    'claimedSlot',
    'handle',
    'handleClaimAddress',
    'handleHash',
    'identitySequence',
    'name',
    'resolutionCheckpointSlot',
  ]);
  if (
    !/^anon_[0-9a-hjkmnp-tv-z]{16}$/u.test(value.wokeName.handle) ||
    value.wokeName.name !== `${value.wokeName.handle}.woke` ||
    !publicKey(value.wokeName.handleClaimAddress) ||
    !/^u[A-Za-z0-9_-]{43}$/u.test(value.wokeName.handleHash) ||
    value.wokeName.identitySequence !== '1' ||
    !decimal(value.wokeName.claimedSlot) ||
    value.wokeName.claimedSlot !== value.identity.creationFinalizedSlot ||
    !decimal(value.wokeName.resolutionCheckpointSlot) ||
    BigInt(value.wokeName.resolutionCheckpointSlot) < BigInt(value.wokeName.claimedSlot)
  ) {
    throw new Error('Publication evidence .woke name proof is invalid.');
  }

  if (!Array.isArray(value.posts) || value.posts.length !== 2) {
    throw new Error('Publication evidence must describe exactly two browser-authored posts.');
  }
  const objectIds = new Set();
  const postReferences = new Set();
  const transactionSignatures = new Set();
  for (const post of value.posts) {
    exactRecord(post, [
      'body',
      'cid',
      'finalizedSlot',
      'indexedCheckpointSlot',
      'objectId',
      'payloadHash',
      'postReference',
      'transactionSignature',
    ]);
    if (
      !bounded(post.body, 2_000) ||
      !bounded(post.cid, 256) ||
      !bounded(post.objectId, 512) ||
      !post.objectId.startsWith('wokesocialobj:v1:post:') ||
      !bounded(post.payloadHash, 256) ||
      !publicKey(post.postReference) ||
      !transactionSignature(post.transactionSignature) ||
      !decimal(post.finalizedSlot) ||
      !decimal(post.indexedCheckpointSlot) ||
      BigInt(post.indexedCheckpointSlot) < BigInt(post.finalizedSlot)
    ) {
      throw new Error('Publication evidence contains an invalid post proof.');
    }
    objectIds.add(post.objectId);
    postReferences.add(post.postReference);
    transactionSignatures.add(post.transactionSignature);
  }
  if (
    objectIds.size !== value.posts.length ||
    postReferences.size !== value.posts.length ||
    transactionSignatures.size !== value.posts.length
  ) {
    throw new Error('Publication evidence posts must have distinct durable coordinates.');
  }

  exactRecord(value.ambiguousRetry, [
    'draftLockedAfterReload',
    'firstAttemptIndexerUnavailableCount',
    'forwardedResponseLossCount',
    'postReferenceAfterRetry',
    'postReferenceBeforeRetry',
    'reloadCount',
    'restoredIntentStage',
    'sendTransactionCountAfterRetry',
    'sendTransactionCountBeforeRetry',
    'transactionSignature',
    'uniqueTransactionWireCount',
    'wireSha256',
  ]);
  if (
    !Number.isSafeInteger(value.ambiguousRetry.forwardedResponseLossCount) ||
    value.ambiguousRetry.forwardedResponseLossCount < 1 ||
    !positiveInteger(value.ambiguousRetry.firstAttemptIndexerUnavailableCount) ||
    value.ambiguousRetry.postReferenceBeforeRetry !==
      value.ambiguousRetry.postReferenceAfterRetry ||
    value.ambiguousRetry.postReferenceAfterRetry !== value.posts[0].postReference ||
    value.ambiguousRetry.transactionSignature !== value.posts[0].transactionSignature ||
    value.ambiguousRetry.sendTransactionCountAfterRetry !==
      value.ambiguousRetry.sendTransactionCountBeforeRetry ||
    value.ambiguousRetry.reloadCount !== 1 ||
    value.ambiguousRetry.restoredIntentStage !== 'finalized' ||
    value.ambiguousRetry.draftLockedAfterReload !== true ||
    value.ambiguousRetry.uniqueTransactionWireCount !== 3 ||
    typeof value.ambiguousRetry.wireSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.ambiguousRetry.wireSha256)
  ) {
    throw new Error('Publication evidence does not prove an idempotent ambiguous-response retry.');
  }

  exactRecord(value.security, [
    'accountSeedCanaryCaptureCount',
    'accountSeedCanarySha256',
    'browserDiagnosticSecretMatchCount',
    'capturedPrfOutputCount',
    'dockerLogSecretMatchCount',
    'forbiddenHttpFieldNameCount',
    'httpRequestCount',
    'httpRequestSecretMatchCount',
    'httpResponseCount',
    'httpResponseSecretMatchCount',
    'scannedDockerLogBytes',
    'scannedHttpAndBrowserBytes',
    'scannedServiceLogBytes',
    'serviceLogCount',
    'serviceLogSecretMatchCount',
    'zeroSecretMatches',
  ]);
  if (
    value.security.accountSeedCanaryCaptureCount !== 1 ||
    typeof value.security.accountSeedCanarySha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.security.accountSeedCanarySha256) ||
    !Number.isSafeInteger(value.security.capturedPrfOutputCount) ||
    value.security.capturedPrfOutputCount < 5 ||
    value.security.forbiddenHttpFieldNameCount !== 0 ||
    !positiveInteger(value.security.httpRequestCount) ||
    !positiveInteger(value.security.httpResponseCount) ||
    !positiveInteger(value.security.serviceLogCount) ||
    !nonnegativeInteger(value.security.scannedDockerLogBytes) ||
    !positiveInteger(value.security.scannedHttpAndBrowserBytes) ||
    !positiveInteger(value.security.scannedServiceLogBytes) ||
    value.security.browserDiagnosticSecretMatchCount !== 0 ||
    value.security.dockerLogSecretMatchCount !== 0 ||
    value.security.httpRequestSecretMatchCount !== 0 ||
    value.security.httpResponseSecretMatchCount !== 0 ||
    value.security.serviceLogSecretMatchCount !== 0 ||
    value.security.zeroSecretMatches !== true
  ) {
    throw new Error('Publication evidence did not preserve the HTTP secret-boundary assertion.');
  }

  return value;
}

export function publicationAdditiveEventCount(evidence) {
  const transactionSignatures = new Set([
    evidence.identity.creationTransactionSignature,
    ...evidence.posts.map((post) => post.transactionSignature),
  ]);
  if (transactionSignatures.size !== evidence.posts.length + 1) {
    throw new Error('Atomic registration and each browser post must use distinct transactions.');
  }
  return transactionSignatures.size + 1;
}

function exactRecord(value, keys) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')
  ) {
    throw new Error(`Publication evidence record keys must be exactly ${keys.join(', ')}.`);
  }
}

function bounded(value, maximumLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function publicKey(value) {
  return typeof value === 'string' && BASE58_PATTERN.test(value) && value.length <= 64;
}

function transactionSignature(value) {
  return typeof value === 'string' && BASE58_PATTERN.test(value) && value.length >= 64;
}

function decimal(value) {
  return typeof value === 'string' && DECIMAL_PATTERN.test(value);
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function timestamp(value) {
  return bounded(value, 64) && Number.isFinite(Date.parse(value));
}

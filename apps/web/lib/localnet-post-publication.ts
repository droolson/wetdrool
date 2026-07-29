import type { PostResponse } from '@wokesocial/indexer-client';
import {
  canonicalizeEnvelope,
  decodeMultibaseBase64Url,
  identityIdSchema,
  networkIdSchema,
  signPayloadWithSigner,
  signingKeyIdFor,
  solanaPublicKeySchema,
  transactionSignatureSchema,
} from '@wokesocial/protocol';
import {
  buildCreatePrimaryWokeIdentityInstruction,
  buildPublishWokePostInstruction,
  createWokeIdentitySimulationVerifier,
  createWokePostSimulationVerifier,
  derivePrimaryWokeIdentityCoordinates,
  deriveWokePostReferenceAddress,
  executeWokeInstruction,
  reconcileWokeIdentityCreation,
  reconcileWokePostPublication,
  verifyFreshWokeIdentityAccount,
  verifyWokeIdentityAccount,
  verifyWokePostReferenceAccount,
  WOKE_IDENTITY_ACCOUNT_SPACE,
  WOKE_POST_REFERENCE_ACCOUNT_SPACE,
  type BuiltCreateWokeIdentityInstruction,
  type BuiltPublishWokePostInstruction,
  type WokeIdentityAccountRecord,
  type WokeIdentityCoordinates,
  type WokeProgramAccountReader,
  type WokeProgramAccountSnapshot,
  type WokePostReferenceAccountRecord,
  type WokeTransactionExecutionResult,
  type WokeTransactionSigner,
} from '@wokesocial/sdk';
import bs58 from 'bs58';

import type { BrowserAuthClient, PasskeyOperationSigner } from './auth/browser-auth-client';
import { encodeBase64Url } from './auth/passkey-codec';
import type { ComposerDraft } from './composer-draft';
import { LocalCasBrowserClient } from './local-cas-client';
import { LOCAL_CAS_RECEIPT_SCHEMA, type LocalCasWriteResult } from './local-cas-contract';
import { ensureLocalnetSignerBalance, type LocalnetFundingResult } from './localnet-faucet';
import {
  waitForIndexedIdentity,
  waitForIndexedPost,
  type IndexedIdentityProof,
} from './localnet-indexer-reconciliation';
import { LocalnetProgramAccountReader } from './localnet-program-account-reader';
import type { LocalnetPublicationRuntime } from './localnet-publication-config';
import {
  buildPostPayloadForIntent,
  loadPostPublicationIntent,
  preparePostPublicationIntent,
  recordFinalizedPostTransaction,
  recordPostStorageReceipt,
  recordSignedPostEnvelope,
  type FinalizedPostPublicationIntent,
  type PostPublicationIntent,
  type PostPublicationIntentStorage,
  type PostPublicationStorageReceipt,
} from './post-publication-intent';

const MAXIMUM_LOCALNET_TARGET_LAMPORTS = 1_000_000_000;
const MAXIMUM_RECOVERY_RESPONSE_BYTES = 2 * 1_024 * 1_024;
const MAXIMUM_RECOVERY_SIGNATURES = 100;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const U64_MAX = 18_446_744_073_709_551_615n;

export type LocalnetTextPostPublicationStage =
  | 'authenticating'
  | 'deriving-identity'
  | 'reconciling-identity'
  | 'funding'
  | 'creating-identity'
  | 'indexing-identity'
  | 'preparing-post'
  | 'signing-post'
  | 'storing-post'
  | 'reconciling-post'
  | 'publishing-post'
  | 'verifying-finality'
  | 'indexing-post'
  | 'verifying-content'
  | 'complete';

export interface LocalnetTextPostPublicationProgress {
  readonly stage: LocalnetTextPostPublicationStage;
}

export type LocalnetTextPostPublicationErrorCode =
  | 'aborted'
  | 'dependency-failure'
  | 'finality-conflict'
  | 'identity-conflict'
  | 'invalid-input'
  | 'invalid-runtime'
  | 'invalid-signer'
  | 'transaction-recovery-failed';

export class LocalnetTextPostPublicationError extends Error {
  override readonly name = 'LocalnetTextPostPublicationError';

  constructor(
    readonly code: LocalnetTextPostPublicationErrorCode,
    readonly stage: LocalnetTextPostPublicationStage,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type LocalnetFinalityRecoveryErrorCode =
  | 'aborted'
  | 'ambiguous'
  | 'invalid-input'
  | 'invalid-response'
  | 'network-mismatch'
  | 'rpc-failure';

export class LocalnetFinalityRecoveryError extends Error {
  override readonly name = 'LocalnetFinalityRecoveryError';

  constructor(
    readonly code: LocalnetFinalityRecoveryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface RecoveredFinalizedPostTransaction {
  readonly signature: string;
  readonly slot: bigint;
}

export interface RecoverFinalizedPostTransactionInput {
  readonly built: BuiltPublishWokePostInstruction;
  readonly post: WokePostReferenceAccountRecord;
  readonly fetch?: typeof globalThis.fetch;
  readonly abortSignal?: AbortSignal;
}

export interface LocalnetTextPostPublicationResult {
  readonly networkId: string;
  readonly rootAuthority: string;
  readonly funding: LocalnetFundingResult;
  readonly identity: {
    readonly address: string;
    readonly id: string;
    readonly sequence: bigint;
    readonly finalizedSlot: bigint;
    readonly disposition: 'created' | 'existing';
    readonly transaction: WokeTransactionExecutionResult | null;
    readonly rentExemptLamports: bigint | null;
    readonly indexed: IndexedIdentityProof;
  };
  readonly post: {
    readonly address: string;
    readonly objectId: string;
    readonly cid: string;
    readonly payloadHash: string;
    readonly body: string;
    readonly disposition: 'published' | 'reconciled';
    readonly storageDisposition: 'stored' | 'already-present' | 'durable-receipt';
    readonly storageReceipt: PostPublicationStorageReceipt;
    readonly transaction: {
      readonly signature: string;
      readonly slot: bigint;
      readonly observedAuthorSequence: bigint;
      readonly source: 'execution' | 'durable-intent' | 'rpc-recovery';
    };
    readonly execution: WokeTransactionExecutionResult | null;
    readonly rentExemptLamports: bigint | null;
    readonly indexed: PostResponse;
  };
  /**
   * Exact immutable evidence retained for the caller. The active intent remains
   * durable until a serialized UI boundary clears the matching draft and then
   * acknowledges this exact state.
   */
  readonly finalizedIntent: FinalizedPostPublicationIntent;
}

export interface LocalnetTextPostPublicationInput {
  readonly runtime: LocalnetPublicationRuntime;
  readonly authClient: Pick<BrowserAuthClient, 'withFreshPasskeySigner'>;
  readonly storage: PostPublicationIntentStorage;
  readonly draft: ComposerDraft;
  readonly abortSignal?: AbortSignal;
  readonly onProgress?: (progress: LocalnetTextPostPublicationProgress) => void;
  readonly dependencies?: LocalnetTextPostPublicationDependencies;
}

/**
 * Test and host-adapter seams. Production callers should omit this object.
 * Every default is the strict implementation imported above.
 */
export interface LocalnetTextPostPublicationDependencies {
  readonly accountReader?: WokeProgramAccountReader;
  readonly now?: () => Date;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly putContent?: (
    bytes: Uint8Array,
    expectedCid: string,
    abortSignal?: AbortSignal,
  ) => Promise<LocalCasWriteResult>;
  readonly ensureSignerBalance?: typeof ensureLocalnetSignerBalance;
  readonly waitForIdentity?: typeof waitForIndexedIdentity;
  readonly waitForPost?: typeof waitForIndexedPost;
  readonly deriveIdentity?: typeof derivePrimaryWokeIdentityCoordinates;
  readonly buildIdentity?: typeof buildCreatePrimaryWokeIdentityInstruction;
  readonly reconcileIdentity?: typeof reconcileWokeIdentityCreation;
  readonly verifyIdentity?: typeof verifyWokeIdentityAccount;
  readonly verifyFreshIdentity?: typeof verifyFreshWokeIdentityAccount;
  readonly createIdentitySimulationVerifier?: typeof createWokeIdentitySimulationVerifier;
  readonly derivePostAddress?: typeof deriveWokePostReferenceAddress;
  readonly buildPost?: typeof buildPublishWokePostInstruction;
  readonly reconcilePost?: typeof reconcileWokePostPublication;
  readonly verifyPost?: typeof verifyWokePostReferenceAccount;
  readonly createPostSimulationVerifier?: typeof createWokePostSimulationVerifier;
  readonly executeInstruction?: typeof executeWokeInstruction;
  readonly recoverFinalizedPostTransaction?: (
    input: RecoverFinalizedPostTransactionInput,
  ) => Promise<RecoveredFinalizedPostTransaction>;
}

/**
 * Executes the complete passkey-first public text-post proof against one exact
 * local validator. All signing, CAS use, chain execution, reconciliation, and
 * indexed-checkpoint verification remain inside the fresh passkey callback.
 */
export async function publishLocalnetTextPost(
  input: LocalnetTextPostPublicationInput,
): Promise<LocalnetTextPostPublicationResult> {
  let stage: LocalnetTextPostPublicationStage = 'authenticating';
  const progress = (next: LocalnetTextPostPublicationStage): void => {
    stage = next;
    try {
      input.onProgress?.(Object.freeze({ stage: next }));
    } catch {
      // Progress reporting is observational and cannot change publication safety.
    }
  };

  try {
    const runtime = parseRuntime(input.runtime);
    const dependencies = input.dependencies ?? {};
    assertInputAdapters(input);
    assertActive(input.abortSignal, stage);
    progress('authenticating');

    return await input.authClient.withFreshPasskeySigner(async (passkeySigner) => {
      const publicKey = validatePasskeySigner(passkeySigner, stage);
      try {
        assertActive(input.abortSignal, stage);
        progress('deriving-identity');
        const rootAuthority = bs58.encode(publicKey);
        const parsedRoot = solanaPublicKeySchema.safeParse(rootAuthority);
        if (!parsedRoot.success) {
          throw publicationError(
            'invalid-signer',
            stage,
            'The verified passkey root is not a canonical Solana authority.',
          );
        }

        const deriveIdentity = dependencies.deriveIdentity ?? derivePrimaryWokeIdentityCoordinates;
        const buildIdentity =
          dependencies.buildIdentity ?? buildCreatePrimaryWokeIdentityInstruction;
        const identityCoordinates = await deriveIdentity(runtime.context, rootAuthority);
        const builtIdentity = await buildIdentity(runtime.context, {
          payer: rootAuthority,
          rootAuthority,
        });
        assertIdentityBuildersAgree(identityCoordinates, builtIdentity, rootAuthority, stage);

        const identityId = identityIdSchema.parse(
          `wokesocialid:v1:${runtime.networkId}:${identityCoordinates.identityAddress}`,
        );
        const rootSigningKey = signingKeyIdFor(identityId, publicKey, 'root');
        if (rootSigningKey !== `${identityId}#root/${rootAuthority}`) {
          throw publicationError(
            'invalid-signer',
            stage,
            'The portable-object root key does not match the Solana root authority.',
          );
        }

        const reader =
          dependencies.accountReader ??
          new LocalnetProgramAccountReader({ abortSignal: input.abortSignal });
        const reconcileIdentity = dependencies.reconcileIdentity ?? reconcileWokeIdentityCreation;
        progress('reconciling-identity');
        const identityReconciliation = await reconcileIdentity(builtIdentity, reader);

        progress('funding');
        const ensureBalance = dependencies.ensureSignerBalance ?? ensureLocalnetSignerBalance;
        const funding = await ensureBalance(
          {
            endpoint: runtime.context.endpoint,
            expectedGenesisHash: runtime.context.genesisHash,
          },
          rootAuthority,
          runtime.targetBalanceLamports,
          input.abortSignal,
        );

        let identityTransaction: WokeTransactionExecutionResult | null = null;
        if (identityReconciliation.status === 'absent') {
          progress('creating-identity');
          identityTransaction = await (dependencies.executeInstruction ?? executeWokeInstruction)({
            context: builtIdentity.context,
            instruction: builtIdentity.instruction,
            feePayer: rootAuthority,
            signer: transactionSignerFor(
              passkeySigner,
              builtIdentity.context,
              rootAuthority,
              stage,
            ),
            verifySimulation: (
              dependencies.createIdentitySimulationVerifier ?? createWokeIdentitySimulationVerifier
            )(builtIdentity),
            rentExemptionSpaces: [builtIdentity.rentExemptionSpace],
            ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
          });
        }

        progress('reconciling-identity');
        const finalizedIdentityAccount = await requireFinalizedAccount(
          reader,
          builtIdentity.context,
          builtIdentity.identityAddress,
          'identity',
        );
        const identity =
          identityReconciliation.status === 'absent'
            ? (dependencies.verifyFreshIdentity ?? verifyFreshWokeIdentityAccount)(
                builtIdentity,
                finalizedIdentityAccount,
                'finalized',
              )
            : (dependencies.verifyIdentity ?? verifyWokeIdentityAccount)(
                identityCoordinates,
                finalizedIdentityAccount,
                'finalized',
              );
        assertUsableIdentity(identity, rootAuthority, stage);
        if (identityTransaction !== null && identity.createdAtSlot !== identityTransaction.slot) {
          throw publicationError(
            'identity-conflict',
            stage,
            'The finalized Identity creation slot does not match its transaction.',
          );
        }

        progress('indexing-identity');
        const indexedIdentity = await (dependencies.waitForIdentity ?? waitForIndexedIdentity)(
          { baseUrl: runtime.indexerUrl },
          {
            identityId,
            minimumSequence: identity.sequence,
            minimumSlot: identity.createdAtSlot,
            rootAuthority,
          },
          input.abortSignal,
        );

        progress('preparing-post');
        const existingIntent = await loadPostPublicationIntent(input.storage);
        const expectedAuthorSequence =
          existingIntent === null
            ? identity.sequence
            : parsePersistedSequence(existingIntent.context.expectedAuthorSequence, stage);
        const derivePostAddress = dependencies.derivePostAddress ?? deriveWokePostReferenceAddress;
        let intent: PostPublicationIntent;
        if (existingIntent?.stage === 'finalized') {
          if (
            existingIntent.context.network !== runtime.networkId ||
            existingIntent.context.identity !== identityId ||
            existingIntent.context.rootSigningKey !== rootSigningKey ||
            existingIntent.context.storagePolicy !== 'provider-default'
          ) {
            throw publicationError(
              'finality-conflict',
              stage,
              'The finalized durable intent does not belong to this localnet identity and storage policy.',
            );
          }
          intent = existingIntent;
        } else {
          intent = await preparePostPublicationIntent(
            input.storage,
            {
              draft: input.draft,
              network: runtime.networkId,
              identity: identityId,
              rootSigningKey,
              expectedAuthorSequence,
            },
            {
              derivePostPda: ({ network, identity: author, postNonce }) => {
                if (network !== runtime.networkId || author !== identityId) {
                  throw publicationError(
                    'invalid-input',
                    stage,
                    'The durable post intent substituted its network or author.',
                  );
                }
                return derivePostAddress(
                  runtime.context,
                  identityCoordinates.identityAddress,
                  postNonce,
                );
              },
              ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
              ...(dependencies.randomBytes === undefined
                ? {}
                : { randomBytes: dependencies.randomBytes }),
            },
          );
        }

        let envelopeBytes: Uint8Array;
        if (intent.stage === 'prepared') {
          progress('signing-post');
          const payload = buildPostPayloadForIntent(intent);
          const envelope = await signPayloadWithSigner(payload, (request) => {
            assertActive(input.abortSignal, stage);
            if (
              request.purpose !== 'wokesocial-portable-object-v1' ||
              request.algorithm !== 'Ed25519' ||
              request.keyId !== rootSigningKey
            ) {
              throw publicationError(
                'invalid-signer',
                stage,
                'The payload signer request did not match the prepared root-authorized post.',
              );
            }
            return passkeySigner.sign(request.message);
          });
          envelopeBytes = canonicalizeEnvelope(envelope);
          intent = await recordSignedPostEnvelope(input.storage, envelopeBytes);
        } else {
          envelopeBytes = decodeMultibaseBase64Url(intent.signed.envelopeBytes);
        }
        if (intent.stage === 'prepared') {
          throw publicationError(
            'dependency-failure',
            stage,
            'The signed publication intent did not advance.',
          );
        }

        const putContent =
          dependencies.putContent ??
          ((bytes: Uint8Array, cid: string, signal?: AbortSignal) =>
            new LocalCasBrowserClient().put(bytes, cid, { signal }));
        progress('storing-post');
        const stored = await putContent(envelopeBytes, intent.signed.cid, input.abortSignal);
        assertExactLocalCasWrite(stored, envelopeBytes, intent.signed.cid, stage);
        let storageDisposition: 'stored' | 'already-present' | 'durable-receipt' = stored.outcome;
        if (intent.stage === 'signed') {
          intent = await recordPostStorageReceipt(
            input.storage,
            storageReceiptFor(stored, intent, dependencies.now),
          );
        }
        if (intent.stage === 'signed' || intent.stage === 'prepared') {
          throw publicationError(
            'dependency-failure',
            stage,
            'The publication intent lacks verified content-storage evidence.',
          );
        }

        const builtPost = await (dependencies.buildPost ?? buildPublishWokePostInstruction)(
          runtime.context,
          {
            authorIdentity: identityCoordinates.identityAddress,
            expectedAuthorSequence: parsePersistedSequence(
              intent.context.expectedAuthorSequence,
              stage,
            ),
            manifestHash: decodeMultibaseBase64Url(intent.signed.payloadHash, 32),
            manifestUri: `ipfs://${intent.signed.cid}`,
            payer: rootAuthority,
            postNonce: decodeMultibaseBase64Url(intent.context.postNonce, 16),
            rootAuthority,
          },
        );
        if (
          builtPost.postReferenceAddress !== intent.context.postPda ||
          builtPost.authorIdentity !== identityCoordinates.identityAddress
        ) {
          throw publicationError(
            'finality-conflict',
            stage,
            'The post instruction does not match the durable publication coordinates.',
          );
        }

        progress('reconciling-post');
        const postReconciliation = await (
          dependencies.reconcilePost ?? reconcileWokePostPublication
        )(builtPost, identityCoordinates, reader);
        if (intent.stage === 'finalized' && postReconciliation.status !== 'existing') {
          throw publicationError(
            'finality-conflict',
            stage,
            'Durable finalized evidence exists but the exact post account does not.',
          );
        }

        let postDisposition: 'published' | 'reconciled';
        let postExecution: WokeTransactionExecutionResult | null = null;
        let transactionSource: 'execution' | 'durable-intent' | 'rpc-recovery';
        let transactionSignature: string;
        let transactionSlot: bigint;
        let post: WokePostReferenceAccountRecord;

        if (postReconciliation.status === 'ready') {
          progress('publishing-post');
          const execution = await (dependencies.executeInstruction ?? executeWokeInstruction)({
            context: builtPost.context,
            instruction: builtPost.instruction,
            feePayer: rootAuthority,
            signer: transactionSignerFor(passkeySigner, builtPost.context, rootAuthority, stage),
            verifySimulation: (
              dependencies.createPostSimulationVerifier ?? createWokePostSimulationVerifier
            )(builtPost),
            rentExemptionSpaces: [builtPost.rentExemptionSpace],
            ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
          });
          postExecution = execution;
          progress('verifying-finality');
          const account = await requireFinalizedAccount(
            reader,
            builtPost.context,
            builtPost.postReferenceAddress,
            'post',
          );
          post = (dependencies.verifyPost ?? verifyWokePostReferenceAccount)(
            builtPost,
            account,
            'finalized',
          );
          if (post.createdAtSlot !== execution.slot) {
            throw publicationError(
              'finality-conflict',
              stage,
              'The finalized PostReference slot does not match its transaction.',
            );
          }
          postDisposition = 'published';
          transactionSource = 'execution';
          transactionSignature = execution.signature;
          transactionSlot = execution.slot;
        } else {
          progress('verifying-finality');
          const account = await requireFinalizedAccount(
            reader,
            builtPost.context,
            builtPost.postReferenceAddress,
            'post',
          );
          post = (dependencies.verifyPost ?? verifyWokePostReferenceAccount)(
            builtPost,
            account,
            'finalized',
          );
          postDisposition = 'reconciled';
          if (intent.stage === 'finalized') {
            transactionSource = 'durable-intent';
            transactionSignature = intent.finalizedTransaction.transactionSignature;
            transactionSlot = parsePersistedSequence(
              intent.finalizedTransaction.finalizedSlot,
              stage,
            );
          } else {
            transactionSource = 'rpc-recovery';
            const recovered = await (
              dependencies.recoverFinalizedPostTransaction ?? recoverFinalizedPostTransaction
            )({
              built: builtPost,
              post,
              ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
            });
            transactionSignature = recovered.signature;
            transactionSlot = recovered.slot;
          }
          if (transactionSlot !== post.createdAtSlot) {
            throw publicationError(
              'finality-conflict',
              stage,
              'Recovered transaction evidence does not match the finalized PostReference slot.',
            );
          }
        }

        intent = await recordFinalizedPostTransaction(input.storage, {
          commitment: 'finalized',
          transactionSignature,
          finalizedSlot: transactionSlot,
          observedAuthorSequence: post.authorSequence,
          postPda: builtPost.postReferenceAddress,
          objectId: intent.signed.objectId,
          cid: intent.signed.cid,
          payloadHash: intent.signed.payloadHash,
        });
        if (intent.stage !== 'finalized') {
          throw publicationError(
            'dependency-failure',
            stage,
            'The publication intent did not retain finalized transaction evidence.',
          );
        }

        const publishedBody = intent.context.content.body;
        if (
          typeof publishedBody !== 'string' ||
          publishedBody.length === 0 ||
          intent.context.content.language !== 'und'
        ) {
          throw publicationError(
            'finality-conflict',
            stage,
            'The finalized publication no longer contains the prepared text body.',
          );
        }
        progress('indexing-post');
        const indexedPost = await (dependencies.waitForPost ?? waitForIndexedPost)(
          { baseUrl: runtime.indexerUrl },
          {
            authorIdentityId: identityId,
            body: publishedBody,
            cid: intent.signed.cid,
            finalizedSlot: transactionSlot,
            language: 'und',
            objectId: intent.signed.objectId,
            payloadHash: intent.signed.payloadHash,
            transactionSignature,
          },
          input.abortSignal,
        );

        progress('verifying-content');
        const finalStorage = await putContent(envelopeBytes, intent.signed.cid, input.abortSignal);
        assertExactLocalCasWrite(finalStorage, envelopeBytes, intent.signed.cid, stage);
        if (finalStorage.outcome === 'stored') {
          storageDisposition = 'stored';
        }

        const result: LocalnetTextPostPublicationResult = Object.freeze({
          networkId: runtime.networkId,
          rootAuthority,
          funding,
          identity: Object.freeze({
            address: identityCoordinates.identityAddress,
            id: identityId,
            sequence: identity.sequence,
            finalizedSlot: finalizedIdentityAccount.slot,
            disposition: identityReconciliation.status === 'absent' ? 'created' : 'existing',
            transaction: identityTransaction,
            rentExemptLamports: rentExemptLamports(
              identityTransaction,
              WOKE_IDENTITY_ACCOUNT_SPACE,
            ),
            indexed: indexedIdentity,
          }),
          post: Object.freeze({
            address: builtPost.postReferenceAddress,
            objectId: intent.signed.objectId,
            cid: intent.signed.cid,
            payloadHash: intent.signed.payloadHash,
            body: publishedBody,
            disposition: postDisposition,
            storageDisposition,
            storageReceipt: intent.storageReceipt,
            transaction: Object.freeze({
              signature: transactionSignature,
              slot: transactionSlot,
              observedAuthorSequence: post.authorSequence,
              source: transactionSource,
            }),
            execution: postExecution,
            rentExemptLamports: rentExemptLamports(
              postExecution,
              WOKE_POST_REFERENCE_ACCOUNT_SPACE,
            ),
            indexed: indexedPost,
          }),
          finalizedIntent: intent,
        });

        progress('complete');
        return result;
      } finally {
        publicKey.fill(0);
      }
    });
  } catch (error) {
    if (error instanceof LocalnetTextPostPublicationError) throw error;
    if (input.abortSignal?.aborted === true || isAbortError(error)) {
      throw publicationError('aborted', stage, 'Localnet publication was cancelled.', error);
    }
    if (error instanceof LocalnetFinalityRecoveryError) {
      throw publicationError(
        'transaction-recovery-failed',
        stage,
        'The finalized post transaction could not be recovered exactly.',
        error,
      );
    }
    throw publicationError(
      'dependency-failure',
      stage,
      `Localnet publication failed during ${stage}.`,
      error,
    );
  }
}

/**
 * Recovers only the transaction that created one already-verified finalized
 * PostReference. It rejects ambiguous slots, remote endpoints, provider
 * changes, additional signers, or any instruction/account/data substitution.
 */
export async function recoverFinalizedPostTransaction(
  input: RecoverFinalizedPostTransactionInput,
): Promise<RecoveredFinalizedPostTransaction> {
  const { built, post } = input;
  if (
    built.rootAuthority !== built.payer ||
    post.createdAtSlot <= 0n ||
    post.createdAtSlot > U64_MAX
  ) {
    throw recoveryError(
      'invalid-input',
      'Recovery requires one root-funded post with a valid finalized creation slot.',
    );
  }
  const endpoint = recoveryEndpoint(built.context.endpoint);
  const request = input.fetch ?? globalThis.fetch;
  assertRecoveryActive(input.abortSignal);
  await assertRecoveryGenesis(request, endpoint, built.context.genesisHash, input.abortSignal);

  const signatures = await recoveryRpc<unknown>(
    request,
    endpoint,
    'getSignaturesForAddress',
    [built.postReferenceAddress, { commitment: 'finalized', limit: MAXIMUM_RECOVERY_SIGNATURES }],
    input.abortSignal,
  );
  if (!Array.isArray(signatures) || signatures.length > MAXIMUM_RECOVERY_SIGNATURES) {
    throw recoveryError(
      'invalid-response',
      'The local validator returned an invalid finalized-signature list.',
    );
  }
  const candidates = signatures.filter((candidate) => {
    if (!isRecord(candidate)) return false;
    return rpcSlot(candidate.slot) === post.createdAtSlot;
  });
  if (candidates.length !== 1) {
    throw recoveryError(
      'ambiguous',
      'The finalized PostReference creation slot did not select one transaction.',
    );
  }
  const candidate = candidates[0];
  if (
    !isRecord(candidate) ||
    candidate.err !== null ||
    candidate.confirmationStatus !== 'finalized' ||
    (candidate.memo !== null && candidate.memo !== undefined) ||
    typeof candidate.signature !== 'string' ||
    !transactionSignatureSchema.safeParse(candidate.signature).success
  ) {
    throw recoveryError(
      'invalid-response',
      'The selected PostReference transaction candidate is not exact finalized evidence.',
    );
  }
  const signature = candidate.signature;

  const transaction = await recoveryRpc<unknown>(
    request,
    endpoint,
    'getTransaction',
    [
      signature,
      {
        commitment: 'finalized',
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
      },
    ],
    input.abortSignal,
  );
  verifyRecoveredTransaction(transaction, signature, built, post.createdAtSlot);
  await assertRecoveryGenesis(request, endpoint, built.context.genesisHash, input.abortSignal);
  return Object.freeze({ signature, slot: post.createdAtSlot });
}

function parseRuntime(runtime: LocalnetPublicationRuntime): LocalnetPublicationRuntime {
  if (!isRecord(runtime) || !isRecord(runtime.context)) {
    throw publicationError(
      'invalid-runtime',
      'authenticating',
      'A validated localnet publication runtime is required.',
    );
  }
  const endpoint = loopbackHttpUrl(runtime.context.endpoint);
  const indexer = loopbackHttpUrl(runtime.indexerUrl);
  const auth = loopbackHttpUrl(runtime.authServiceUrl);
  const genesis = solanaPublicKeySchema.safeParse(runtime.context.genesisHash);
  const program = solanaPublicKeySchema.safeParse(runtime.context.programAddress);
  const network = networkIdSchema.safeParse(runtime.networkId);
  if (
    endpoint === null ||
    indexer === null ||
    auth === null ||
    !genesis.success ||
    !program.success ||
    !network.success ||
    network.data !== `wokenet:v1:${genesis.data}:${program.data}` ||
    !Number.isSafeInteger(runtime.targetBalanceLamports) ||
    runtime.targetBalanceLamports < 1 ||
    runtime.targetBalanceLamports > MAXIMUM_LOCALNET_TARGET_LAMPORTS
  ) {
    throw publicationError(
      'invalid-runtime',
      'authenticating',
      'The publication runtime is not an exact bounded loopback WokeNet deployment.',
    );
  }
  return Object.freeze({
    authServiceUrl: auth.toString(),
    context: Object.freeze({
      endpoint: endpoint.toString(),
      genesisHash: genesis.data,
      programAddress: program.data,
    }),
    indexerUrl: indexer.toString(),
    networkId: network.data,
    targetBalanceLamports: runtime.targetBalanceLamports,
  });
}

function assertInputAdapters(input: LocalnetTextPostPublicationInput): void {
  if (
    !isRecord(input.authClient) ||
    typeof input.authClient.withFreshPasskeySigner !== 'function' ||
    !isRecord(input.storage) ||
    typeof input.storage.getItem !== 'function' ||
    typeof input.storage.setItem !== 'function' ||
    typeof input.storage.removeItem !== 'function' ||
    !isRecord(input.draft) ||
    input.draft.storagePolicy !== 'provider-default' ||
    (input.onProgress !== undefined && typeof input.onProgress !== 'function')
  ) {
    throw publicationError(
      'invalid-input',
      'authenticating',
      'Publication requires exact authentication, durable browser storage, and the verified provider-default local CAS policy.',
    );
  }
}

function validatePasskeySigner(
  signer: PasskeyOperationSigner,
  stage: LocalnetTextPostPublicationStage,
): Uint8Array {
  if (
    !isRecord(signer) ||
    typeof signer.credentialId !== 'string' ||
    signer.credentialId.length === 0 ||
    typeof signer.publicKey !== 'string' ||
    !(signer.publicKeyBytes instanceof Uint8Array) ||
    signer.publicKeyBytes.byteLength !== 32 ||
    encodeBase64Url(signer.publicKeyBytes) !== signer.publicKey ||
    typeof signer.sign !== 'function'
  ) {
    throw publicationError(
      'invalid-signer',
      stage,
      'The passkey callback did not expose one exact verified Ed25519 root.',
    );
  }
  return Uint8Array.from(signer.publicKeyBytes);
}

function assertIdentityBuildersAgree(
  coordinates: WokeIdentityCoordinates,
  built: BuiltCreateWokeIdentityInstruction,
  rootAuthority: string,
  stage: LocalnetTextPostPublicationStage,
): void {
  if (
    coordinates.context.endpoint !== built.context.endpoint ||
    coordinates.context.genesisHash !== built.context.genesisHash ||
    coordinates.context.programAddress !== built.context.programAddress ||
    coordinates.identityAddress !== built.identityAddress ||
    coordinates.configAddress !== built.configAddress ||
    coordinates.identityBump !== built.identityBump ||
    coordinates.originAuthority !== rootAuthority ||
    built.rootAuthority !== rootAuthority ||
    built.payer !== rootAuthority
  ) {
    throw publicationError(
      'identity-conflict',
      stage,
      'The deterministic Identity derivation and creation instruction disagree.',
    );
  }
}

function assertUsableIdentity(
  identity: WokeIdentityAccountRecord,
  rootAuthority: string,
  stage: LocalnetTextPostPublicationStage,
): void {
  if (
    !identity.active ||
    identity.rootAuthority !== rootAuthority ||
    identity.sequence < 0n ||
    identity.sequence >= U64_MAX
  ) {
    throw publicationError(
      'identity-conflict',
      stage,
      'The finalized Identity is inactive, controlled by another root, or exhausted.',
    );
  }
}

async function requireFinalizedAccount(
  reader: WokeProgramAccountReader,
  context: BuiltCreateWokeIdentityInstruction['context'],
  address: string,
  label: 'identity' | 'post',
): Promise<WokeProgramAccountSnapshot> {
  const account = await reader.readAccount({
    endpoint: context.endpoint,
    genesisHash: context.genesisHash,
    programAddress: context.programAddress,
    address,
    commitment: 'finalized',
  });
  if (account === null) {
    throw publicationError(
      'finality-conflict',
      label === 'identity' ? 'reconciling-identity' : 'verifying-finality',
      `The exact ${label} account was not visible at finalized commitment.`,
    );
  }
  return account;
}

function transactionSignerFor(
  passkeySigner: PasskeyOperationSigner,
  context: BuiltCreateWokeIdentityInstruction['context'],
  rootAuthority: string,
  operationStage: LocalnetTextPostPublicationStage,
): WokeTransactionSigner {
  return (request) => {
    if (request.abortSignal.aborted) {
      throw publicationError(
        'aborted',
        operationStage,
        'Localnet publication was cancelled before transaction signing.',
      );
    }
    if (
      request.purpose !== 'wokenet-transaction-v1' ||
      request.context.endpoint !== context.endpoint ||
      request.context.genesisHash !== context.genesisHash ||
      request.context.programAddress !== context.programAddress ||
      request.instructionProgramAddress !== context.programAddress ||
      request.feePayer !== rootAuthority ||
      request.requiredSignerAddresses.length !== 1 ||
      request.requiredSignerAddresses[0] !== rootAuthority
    ) {
      throw new LocalnetTextPostPublicationError(
        'invalid-signer',
        operationStage,
        'The Solana transaction signing request did not match the approved localnet operation.',
      );
    }
    return Object.freeze([
      Object.freeze({
        address: rootAuthority,
        signature: passkeySigner.sign(request.messageBytes),
      }),
    ]);
  };
}

function storageReceiptFor(
  result: LocalCasWriteResult,
  intent: Exclude<PostPublicationIntent, { stage: 'prepared' }>,
  now: (() => Date) | undefined,
): PostPublicationStorageReceipt {
  const observed = now?.() ?? new Date();
  const createdAt = Date.parse(intent.context.createdAt);
  if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) {
    throw new TypeError('The content receipt clock is invalid.');
  }
  return {
    cid: result.receipt.cid,
    provider: result.receipt.provider,
    providerVersion: result.receipt.providerVersion,
    locator: result.receipt.locator,
    byteLength: result.receipt.byteLength,
    publishedAt: new Date(Math.max(observed.getTime(), createdAt)).toISOString(),
    policy: result.receipt.policy,
    verified: true,
  };
}

function assertExactLocalCasWrite(
  result: LocalCasWriteResult,
  envelopeBytes: Uint8Array,
  expectedCid: string,
  stage: LocalnetTextPostPublicationStage,
): void {
  if (
    !isRecord(result) ||
    (result.outcome !== 'stored' && result.outcome !== 'already-present') ||
    !isRecord(result.receipt) ||
    result.receipt.schema !== LOCAL_CAS_RECEIPT_SCHEMA ||
    result.receipt.cid !== expectedCid ||
    result.receipt.byteLength !== envelopeBytes.byteLength ||
    result.receipt.locator !== `local://${expectedCid}` ||
    result.receipt.provider !== 'local-filesystem' ||
    result.receipt.providerVersion !== '1' ||
    result.receipt.verified !== true ||
    !isRecord(result.receipt.policy) ||
    result.receipt.policy.permanence !== 'deletion-compatible'
  ) {
    throw publicationError(
      'dependency-failure',
      stage,
      'The local content store did not revalidate the exact canonical envelope bytes.',
    );
  }
}

function parsePersistedSequence(value: string, stage: LocalnetTextPostPublicationStage): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw publicationError(
      'invalid-input',
      stage,
      'The durable publication sequence is not canonical.',
    );
  }
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > U64_MAX) {
    throw publicationError(
      'invalid-input',
      stage,
      'The durable publication sequence is out of range.',
    );
  }
  return parsed;
}

function rentExemptLamports(
  execution: WokeTransactionExecutionResult | null,
  accountSpace: number,
): bigint | null {
  if (execution === null) return null;
  return execution.minimumRentExemptBalances[String(accountSpace)] ?? null;
}

function verifyRecoveredTransaction(
  value: unknown,
  signature: string,
  built: BuiltPublishWokePostInstruction,
  expectedSlot: bigint,
): void {
  if (!isRecord(value) || rpcSlot(value.slot) !== expectedSlot || value.version !== 'legacy') {
    throw recoveryError(
      'invalid-response',
      'The recovered legacy transaction does not match the PostReference slot.',
    );
  }
  const meta = record(value.meta, 'transaction metadata');
  if (meta.err !== null) {
    throw recoveryError('invalid-response', 'The recovered transaction did not succeed.');
  }
  const transaction = record(value.transaction, 'transaction');
  if (
    !Array.isArray(transaction.signatures) ||
    transaction.signatures.length !== 1 ||
    transaction.signatures[0] !== signature
  ) {
    throw recoveryError(
      'invalid-response',
      'The recovered transaction signatures were substituted or ambiguous.',
    );
  }
  const message = record(transaction.message, 'transaction message');
  if (!Array.isArray(message.accountKeys) || !Array.isArray(message.instructions)) {
    throw recoveryError('invalid-response', 'The recovered transaction message is invalid.');
  }
  const accountKeys = message.accountKeys.map((entry) => {
    const account = record(entry, 'transaction account key');
    if (
      typeof account.pubkey !== 'string' ||
      !solanaPublicKeySchema.safeParse(account.pubkey).success ||
      typeof account.signer !== 'boolean' ||
      typeof account.writable !== 'boolean'
    ) {
      throw recoveryError(
        'invalid-response',
        'The recovered transaction account metadata is invalid.',
      );
    }
    return {
      pubkey: account.pubkey,
      signer: account.signer,
      writable: account.writable,
    };
  });
  const expectedAccountKeys = new Set([
    built.rootAuthority,
    ...built.instruction.accounts.map((account) => String(account.address)),
    built.context.programAddress,
  ]);
  const observedAccountKeys = new Set(accountKeys.map((account) => account.pubkey));
  if (
    accountKeys.length === 0 ||
    accountKeys.length !== observedAccountKeys.size ||
    observedAccountKeys.size !== expectedAccountKeys.size ||
    [...expectedAccountKeys].some((account) => !observedAccountKeys.has(account)) ||
    accountKeys[0]?.pubkey !== built.rootAuthority ||
    accountKeys[0]?.signer !== true ||
    accountKeys[0]?.writable !== true ||
    accountKeys.filter((account) => account.signer).length !== 1 ||
    accountKeys.filter((account) => account.pubkey === built.rootAuthority).length !== 1
  ) {
    throw recoveryError(
      'invalid-response',
      'The recovered fee payer or root signer flags do not match the passkey root.',
    );
  }
  if (message.instructions.length !== 1) {
    throw recoveryError(
      'invalid-response',
      'The recovered transaction must contain one top-level WokeSocial instruction.',
    );
  }
  const instruction = record(message.instructions[0], 'transaction instruction');
  const expectedAccounts = built.instruction.accounts.map((account) => String(account.address));
  if (
    instruction.programId !== built.context.programAddress ||
    instruction.data !== bs58.encode(built.instruction.data) ||
    !Array.isArray(instruction.accounts) ||
    instruction.accounts.length !== expectedAccounts.length ||
    instruction.accounts.some((account, index) => account !== expectedAccounts[index])
  ) {
    throw recoveryError(
      'invalid-response',
      'The recovered program instruction differs from the exact publication instruction.',
    );
  }
}

function recoveryEndpoint(value: string): URL {
  const endpoint = loopbackHttpUrl(value);
  if (endpoint === null) {
    throw recoveryError(
      'invalid-input',
      'Finality recovery is restricted to an exact loopback HTTP validator.',
    );
  }
  return endpoint;
}

async function assertRecoveryGenesis(
  request: typeof globalThis.fetch,
  endpoint: URL,
  expected: string,
  signal?: AbortSignal,
): Promise<void> {
  const observed = await recoveryRpc<unknown>(request, endpoint, 'getGenesisHash', [], signal);
  if (observed !== expected) {
    throw recoveryError(
      'network-mismatch',
      'The local validator genesis changed during transaction recovery.',
    );
  }
}

async function recoveryRpc<T>(
  request: typeof globalThis.fetch,
  endpoint: URL,
  method: string,
  params: readonly unknown[],
  signal?: AbortSignal,
): Promise<T> {
  assertRecoveryActive(signal);
  const id = `wokesocial-finality-recovery-${method}`;
  let response: Response;
  try {
    response = await request(endpoint, {
      body: JSON.stringify({ id, jsonrpc: '2.0', method, params }),
      cache: 'no-store',
      credentials: 'omit',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) {
      throw recoveryError('aborted', 'Transaction recovery was cancelled.', error);
    }
    throw recoveryError('rpc-failure', 'The local validator recovery request failed.', error);
  }
  if (!response.ok) {
    await cancelBody(response.body);
    throw recoveryError(
      'rpc-failure',
      `The local validator returned HTTP ${String(response.status)} during recovery.`,
    );
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (contentType !== 'application/json') {
    await cancelBody(response.body);
    throw recoveryError('invalid-response', 'The local validator recovery response was not JSON.');
  }
  const text = await readBoundedRecoveryText(response);
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    throw recoveryError(
      'invalid-response',
      'The local validator recovery response was invalid JSON.',
      error,
    );
  }
  if (
    !isRecord(decoded) ||
    decoded.jsonrpc !== '2.0' ||
    decoded.id !== id ||
    decoded.error !== undefined ||
    !('result' in decoded)
  ) {
    throw recoveryError(
      'invalid-response',
      'The local validator recovery RPC envelope was invalid or substituted.',
    );
  }
  return decoded.result as T;
}

async function readBoundedRecoveryText(response: Response): Promise<string> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > MAXIMUM_RECOVERY_RESPONSE_BYTES)
  ) {
    await cancelBody(response.body);
    throw recoveryError(
      'invalid-response',
      'The local validator recovery response exceeded its byte limit.',
    );
  }
  if (response.body === null) {
    throw recoveryError(
      'invalid-response',
      'The local validator recovery response body was empty.',
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAXIMUM_RECOVERY_RESPONSE_BYTES) {
        await reader.cancel();
        throw recoveryError(
          'invalid-response',
          'The local validator recovery response exceeded its byte limit.',
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw recoveryError(
      'invalid-response',
      'The local validator recovery response was not UTF-8.',
      error,
    );
  }
}

function rpcSlot(value: unknown): bigint | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? BigInt(value)
    : null;
}

function loopbackHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const endpoint = new URL(value);
    if (
      endpoint.protocol !== 'http:' ||
      !LOOPBACK_HOSTS.has(endpoint.hostname.toLowerCase()) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      return null;
    }
    endpoint.pathname = endpoint.pathname.endsWith('/')
      ? endpoint.pathname
      : `${endpoint.pathname}/`;
    return endpoint;
  } catch {
    return null;
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw recoveryError('invalid-response', `The recovered ${label} is invalid.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertActive(
  signal: AbortSignal | undefined,
  stage: LocalnetTextPostPublicationStage,
): void {
  if (signal?.aborted === true) {
    throw publicationError('aborted', stage, 'Localnet publication was cancelled.');
  }
}

function assertRecoveryActive(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw recoveryError('aborted', 'Transaction recovery was cancelled.');
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (isRecord(error) && (error.name === 'AbortError' || error.code === 'aborted'))
  );
}

function publicationError(
  code: LocalnetTextPostPublicationErrorCode,
  stage: LocalnetTextPostPublicationStage,
  message: string,
  cause?: unknown,
): LocalnetTextPostPublicationError {
  return new LocalnetTextPostPublicationError(
    code,
    stage,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function recoveryError(
  code: LocalnetFinalityRecoveryErrorCode,
  message: string,
  cause?: unknown,
): LocalnetFinalityRecoveryError {
  return new LocalnetFinalityRecoveryError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Best effort after rejecting the response.
  }
}

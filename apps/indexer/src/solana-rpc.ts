import { address, createSolanaRpc, signature, type ClusterUrl } from '@solana/kit';

export interface FinalizedSignature {
  readonly signature: string;
  readonly slot: bigint;
  readonly blockTime: number | null;
  readonly failed: boolean;
  readonly confirmationStatus: string | null;
  readonly transactionIndex?: number;
}

export interface FinalizedTransaction {
  readonly signature: string;
  readonly slot: bigint;
  readonly blockTime: number | null;
  readonly failed: boolean;
  readonly logMessages: readonly string[];
}

export interface FinalizedSolanaRpc {
  initialize(): Promise<void>;
  finalizedSlot(): Promise<bigint>;
  signaturesForProgram(input: {
    readonly programId: string;
    readonly before?: string;
    readonly limit: number;
  }): Promise<readonly FinalizedSignature[]>;
  transaction(transactionSignature: string): Promise<FinalizedTransaction | null>;
}

export interface SolanaRpcEndpoint {
  readonly url: string;
  genesisHash(): Promise<string>;
  programIsExecutable(programId: string): Promise<boolean>;
  finalizedSlot(): Promise<bigint>;
  signaturesForProgram(input: {
    readonly programId: string;
    readonly before?: string;
    readonly limit: number;
  }): Promise<readonly FinalizedSignature[]>;
  transaction(transactionSignature: string): Promise<FinalizedTransaction | null>;
}

export class SolanaRpcValidationError extends Error {
  override readonly name = 'SolanaRpcValidationError';
}

export class SolanaRpcUnavailableError extends Error {
  override readonly name = 'SolanaRpcUnavailableError';
}

export class KitSolanaRpcEndpoint implements SolanaRpcEndpoint {
  readonly #rpc;

  constructor(readonly url: string) {
    this.#rpc = createSolanaRpc(url as ClusterUrl);
  }

  async genesisHash(): Promise<string> {
    return String(await this.#rpc.getGenesisHash().send());
  }

  async programIsExecutable(programId: string): Promise<boolean> {
    const response = await this.#rpc
      .getAccountInfo(address(programId), {
        commitment: 'finalized',
        dataSlice: { offset: 0, length: 0 },
        encoding: 'base64',
      })
      .send();
    return response.value?.executable === true;
  }

  async finalizedSlot(): Promise<bigint> {
    return BigInt(await this.#rpc.getSlot({ commitment: 'finalized' }).send());
  }

  async signaturesForProgram(input: {
    readonly programId: string;
    readonly before?: string;
    readonly limit: number;
  }): Promise<readonly FinalizedSignature[]> {
    const common = {
      commitment: 'finalized' as const,
      limit: input.limit,
    };
    const response =
      input.before === undefined
        ? await this.#rpc.getSignaturesForAddress(address(input.programId), common).send()
        : await this.#rpc
            .getSignaturesForAddress(address(input.programId), {
              ...common,
              before: signature(input.before),
            })
            .send();
    return response.map((item) => ({
      signature: String(item.signature),
      slot: BigInt(item.slot),
      blockTime: item.blockTime === null ? null : Number(item.blockTime),
      failed: item.err !== null,
      confirmationStatus: item.confirmationStatus,
      ...(item.transactionIndex === undefined ? {} : { transactionIndex: item.transactionIndex }),
    }));
  }

  async transaction(transactionSignature: string): Promise<FinalizedTransaction | null> {
    const response = await this.#rpc
      .getTransaction(signature(transactionSignature), {
        commitment: 'finalized',
        encoding: 'json',
        maxSupportedTransactionVersion: 0,
      })
      .send();
    if (response === null) {
      return null;
    }
    return {
      signature: transactionSignature,
      slot: BigInt(response.slot),
      blockTime: response.blockTime === null ? null : Number(response.blockTime),
      failed: response.meta?.err !== null,
      logMessages: response.meta?.logMessages ?? [],
    };
  }
}

export class FailoverSolanaRpc implements FinalizedSolanaRpc {
  readonly #validated: SolanaRpcEndpoint[] = [];
  #nextEndpoint = 0;
  #initialized = false;

  constructor(
    private readonly endpoints: readonly SolanaRpcEndpoint[],
    private readonly expectedGenesisHash: string,
    private readonly expectedProgramId: string,
  ) {
    if (endpoints.length === 0) {
      throw new SolanaRpcValidationError('At least one WokeNet RPC endpoint is required.');
    }
  }

  static fromUrls(
    urls: readonly string[],
    expectedGenesisHash: string,
    expectedProgramId: string,
  ): FailoverSolanaRpc {
    return new FailoverSolanaRpc(
      urls.map((url) => new KitSolanaRpcEndpoint(url)),
      expectedGenesisHash,
      expectedProgramId,
    );
  }

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    const failures: string[] = [];
    for (const endpoint of this.endpoints) {
      try {
        const genesisHash = await endpoint.genesisHash();
        if (genesisHash !== this.expectedGenesisHash) {
          failures.push(
            `${endpoint.url}: expected genesis ${this.expectedGenesisHash}, received ${genesisHash}`,
          );
          continue;
        }
        if (!(await endpoint.programIsExecutable(this.expectedProgramId))) {
          failures.push(
            `${endpoint.url}: program ${this.expectedProgramId} is absent or not executable`,
          );
          continue;
        }
        this.#validated.push(endpoint);
      } catch (error) {
        failures.push(`${endpoint.url}: ${errorMessage(error)}`);
      }
    }

    if (this.#validated.length === 0) {
      throw new SolanaRpcValidationError(
        `No RPC endpoint passed network and program validation. ${failures.join('; ')}`,
      );
    }
    this.#initialized = true;
  }

  async finalizedSlot(): Promise<bigint> {
    return this.#execute((endpoint) => endpoint.finalizedSlot());
  }

  async signaturesForProgram(input: {
    readonly programId: string;
    readonly before?: string;
    readonly limit: number;
  }): Promise<readonly FinalizedSignature[]> {
    if (input.programId !== this.expectedProgramId) {
      throw new SolanaRpcValidationError(
        `Requested program ${input.programId} does not match configured program ${this.expectedProgramId}.`,
      );
    }
    return this.#execute((endpoint) => endpoint.signaturesForProgram(input));
  }

  async transaction(transactionSignature: string): Promise<FinalizedTransaction | null> {
    return this.#execute((endpoint) => endpoint.transaction(transactionSignature), true);
  }

  async #execute<T>(
    operation: (endpoint: SolanaRpcEndpoint) => Promise<T>,
    retryNull = false,
  ): Promise<T> {
    await this.initialize();
    const failures: string[] = [];
    for (let offset = 0; offset < this.#validated.length; offset += 1) {
      const index = (this.#nextEndpoint + offset) % this.#validated.length;
      const endpoint = this.#validated[index];
      if (endpoint === undefined) {
        continue;
      }
      try {
        const result = await operation(endpoint);
        if (retryNull && result === null) {
          failures.push(`${endpoint.url}: finalized transaction is unavailable`);
          continue;
        }
        this.#nextEndpoint = (index + 1) % this.#validated.length;
        return result;
      } catch (error) {
        failures.push(`${endpoint.url}: ${errorMessage(error)}`);
      }
    }
    throw new SolanaRpcUnavailableError(`All WokeNet RPC endpoints failed. ${failures.join('; ')}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { describe, expect, it, vi } from 'vitest';

import { ensureLocalnetSignerBalance } from '../lib/localnet-faucet';

const GENESIS = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB';
const ADDRESS = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const SIGNATURE = '1'.repeat(64);

interface RpcCall {
  readonly method: string;
  readonly params: readonly unknown[];
}

function rpcFixture(
  options: {
    readonly airdropFailures?: number;
    readonly balances?: readonly number[];
    readonly finalizeAfter?: number;
    readonly genesis?: string | readonly string[];
    readonly responseId?: string;
    readonly status?: 'confirmed' | 'finalized';
  } = {},
) {
  const calls: RpcCall[] = [];
  const balances = [...(options.balances ?? [0, 100_000_000])];
  const genesis = Array.isArray(options.genesis)
    ? [...options.genesis]
    : [options.genesis ?? GENESIS];
  let statusCalls = 0;
  let airdropCalls = 0;
  const fetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as RpcCall & { readonly id: string };
    calls.push(request);
    if (request.method === 'requestAirdrop' && airdropCalls++ < (options.airdropFailures ?? 0)) {
      return new Response(
        JSON.stringify({
          id: request.id,
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error' },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    const result = (() => {
      switch (request.method) {
        case 'getGenesisHash':
          return genesis.shift() ?? genesis.at(-1) ?? GENESIS;
        case 'getBalance':
          return { context: { slot: 1 }, value: balances.shift() ?? 0 };
        case 'requestAirdrop':
          return SIGNATURE;
        case 'getSignatureStatuses':
          statusCalls += 1;
          return {
            context: { slot: 2 },
            value: [
              {
                confirmationStatus:
                  options.finalizeAfter !== undefined && statusCalls < options.finalizeAfter
                    ? 'confirmed'
                    : (options.status ?? 'finalized'),
                confirmations: null,
                err: null,
                slot: 2,
              },
            ],
          };
        default:
          throw new Error(`unexpected method ${request.method}`);
      }
    })();
    return new Response(
      JSON.stringify({
        id: options.responseId ?? request.id,
        jsonrpc: '2.0',
        result,
      }),
      {
        headers: { 'content-type': 'application/json' },
      },
    );
  });
  return { calls, fetch };
}

describe('hard-localnet faucet', () => {
  it('requests only the missing lamports and verifies finality, genesis, and resulting balance', async () => {
    const fixture = rpcFixture({ balances: [25_000_000, 100_000_000] });

    await expect(
      ensureLocalnetSignerBalance(
        {
          endpoint: 'http://127.0.0.1:8899',
          expectedGenesisHash: GENESIS,
          fetch: fixture.fetch,
          pollDelayMilliseconds: 0,
        },
        ADDRESS,
        100_000_000,
      ),
    ).resolves.toEqual({
      airdropSignature: SIGNATURE,
      balanceLamports: 100_000_000,
      fundedLamports: 75_000_000,
      genesisHash: GENESIS,
    });
    expect(fixture.calls.find(({ method }) => method === 'requestAirdrop')?.params).toEqual([
      ADDRESS,
      75_000_000,
      { commitment: 'finalized' },
    ]);
    expect(fixture.calls.filter(({ method }) => method === 'getGenesisHash')).toHaveLength(2);
  });

  it('rechecks network and balance before retrying a temporarily unready local faucet', async () => {
    const fixture = rpcFixture({
      airdropFailures: 2,
      balances: [0, 0, 0, 100_000_000],
    });

    await expect(
      ensureLocalnetSignerBalance(
        {
          endpoint: 'http://127.0.0.1:8899',
          expectedGenesisHash: GENESIS,
          fetch: fixture.fetch,
          pollDelayMilliseconds: 0,
          sleep: async () => undefined,
        },
        ADDRESS,
        100_000_000,
      ),
    ).resolves.toMatchObject({
      airdropSignature: SIGNATURE,
      balanceLamports: 100_000_000,
      fundedLamports: 100_000_000,
    });
    expect(fixture.calls.filter(({ method }) => method === 'requestAirdrop')).toHaveLength(3);
    expect(fixture.calls.filter(({ method }) => method === 'getGenesisHash')).toHaveLength(4);
  });

  it('does not request an airdrop when the finalized balance already covers the target', async () => {
    const fixture = rpcFixture({ balances: [150_000_000] });
    const result = await ensureLocalnetSignerBalance(
      {
        endpoint: 'http://localhost:8899',
        expectedGenesisHash: GENESIS,
        fetch: fixture.fetch,
      },
      ADDRESS,
      100_000_000,
    );

    expect(result).toMatchObject({ airdropSignature: null, fundedLamports: 0 });
    expect(fixture.calls.some(({ method }) => method === 'requestAirdrop')).toBe(false);
    expect(fixture.calls.filter(({ method }) => method === 'getGenesisHash')).toHaveLength(2);
  });

  it.each([
    ['a remote endpoint', { endpoint: 'https://api.devnet.solana.com' }],
    ['embedded credentials', { endpoint: 'http://user:secret@localhost:8899' }],
  ])('rejects %s before any request', async (_label, override) => {
    const fixture = rpcFixture();
    await expect(
      ensureLocalnetSignerBalance(
        {
          expectedGenesisHash: GENESIS,
          fetch: fixture.fetch,
          ...override,
        },
        ADDRESS,
        100_000_000,
      ),
    ).rejects.toMatchObject({ code: 'invalid-config' });
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it('rejects a substituted network before requesting funds', async () => {
    const fixture = rpcFixture({ genesis: ADDRESS });
    await expect(
      ensureLocalnetSignerBalance(
        {
          endpoint: 'http://127.0.0.1:8899',
          expectedGenesisHash: GENESIS,
          fetch: fixture.fetch,
        },
        ADDRESS,
        100_000_000,
      ),
    ).rejects.toMatchObject({ code: 'network-mismatch' });
    expect(fixture.calls.some(({ method }) => method === 'requestAirdrop')).toBe(false);
  });

  it('rechecks genesis before returning an already-funded balance', async () => {
    const fixture = rpcFixture({
      balances: [150_000_000],
      genesis: [GENESIS, ADDRESS],
    });
    await expect(
      ensureLocalnetSignerBalance(
        {
          endpoint: 'http://127.0.0.1:8899',
          expectedGenesisHash: GENESIS,
          fetch: fixture.fetch,
        },
        ADDRESS,
        100_000_000,
      ),
    ).rejects.toMatchObject({ code: 'network-mismatch' });
    expect(fixture.calls.some(({ method }) => method === 'requestAirdrop')).toBe(false);
  });

  it('uses the bounded 120-attempt default for real-validator finality variance', async () => {
    const fixture = rpcFixture({ finalizeAfter: 41 });
    await expect(
      ensureLocalnetSignerBalance(
        {
          endpoint: 'http://127.0.0.1:8899',
          expectedGenesisHash: GENESIS,
          fetch: fixture.fetch,
          sleep: async () => undefined,
        },
        ADDRESS,
        100_000_000,
      ),
    ).resolves.toMatchObject({ airdropSignature: SIGNATURE });
    expect(fixture.calls.filter(({ method }) => method === 'getSignatureStatuses')).toHaveLength(
      41,
    );
  });

  it('rejects a substituted JSON-RPC response id', async () => {
    const fixture = rpcFixture({ responseId: 'another-request' });
    await expect(
      ensureLocalnetSignerBalance(
        {
          endpoint: 'http://127.0.0.1:8899',
          expectedGenesisHash: GENESIS,
          fetch: fixture.fetch,
        },
        ADDRESS,
        100_000_000,
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('times out without treating confirmed status as finalized', async () => {
    const fixture = rpcFixture({ status: 'confirmed' });
    await expect(
      ensureLocalnetSignerBalance(
        {
          endpoint: 'http://127.0.0.1:8899',
          expectedGenesisHash: GENESIS,
          fetch: fixture.fetch,
          maximumPollAttempts: 2,
          pollDelayMilliseconds: 0,
        },
        ADDRESS,
        100_000_000,
      ),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('fails when a finalized transaction does not produce the expected balance', async () => {
    const fixture = rpcFixture({ balances: [0, 99_999_999] });
    await expect(
      ensureLocalnetSignerBalance(
        {
          endpoint: 'http://127.0.0.1:8899',
          expectedGenesisHash: GENESIS,
          fetch: fixture.fetch,
          pollDelayMilliseconds: 0,
        },
        ADDRESS,
        100_000_000,
      ),
    ).rejects.toMatchObject({ code: 'balance-mismatch' });
  });
});

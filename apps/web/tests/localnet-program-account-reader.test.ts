import { describe, expect, it, vi } from 'vitest';

import { LocalnetProgramAccountReader } from '../lib/localnet-program-account-reader';

const GENESIS = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB';
const PROGRAM = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const ACCOUNT = '8qbHbw2BbbTHBW1sbeqakYXVzPpQ2R2moVnuhjXGhfE';

function request(overrides: Record<string, unknown> = {}) {
  return {
    address: ACCOUNT,
    commitment: 'finalized' as const,
    endpoint: 'http://127.0.0.1:8899',
    genesisHash: GENESIS,
    programAddress: PROGRAM,
    ...overrides,
  };
}

function rpcFetch(
  options: {
    readonly account?: unknown;
    readonly genesis?: string | readonly string[];
    readonly responseId?: string;
    readonly slot?: unknown;
  } = {},
) {
  const methods: string[] = [];
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  let genesisRead = 0;
  const fetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id: string;
      method: string;
    };
    methods.push(body.method);
    const genesis =
      typeof options.genesis === 'string'
        ? options.genesis
        : (options.genesis?.[genesisRead] ?? GENESIS);
    if (body.method === 'getGenesisHash') genesisRead += 1;
    const result =
      body.method === 'getGenesisHash'
        ? genesis
        : {
            context: { slot: options.slot ?? 42 },
            value:
              options.account === undefined
                ? {
                    data: [btoa(String.fromCharCode(...bytes)), 'base64'],
                    executable: false,
                    lamports: 1_000_000,
                    owner: PROGRAM,
                    space: bytes.byteLength,
                  }
                : options.account,
          };
    return new Response(
      JSON.stringify({
        id: options.responseId ?? body.id,
        jsonrpc: '2.0',
        result,
      }),
      {
        headers: { 'content-type': 'application/json' },
      },
    );
  });
  return { bytes, fetch, methods };
}

describe('localnet DroolNet account reader', () => {
  it('verifies genesis and returns exact account bytes with RPC evidence', async () => {
    const fixture = rpcFetch();
    const reader = new LocalnetProgramAccountReader({ fetch: fixture.fetch });

    await expect(reader.readAccount(request())).resolves.toEqual({
      address: ACCOUNT,
      commitment: 'finalized',
      data: fixture.bytes,
      owner: PROGRAM,
      slot: 42n,
    });
    expect(fixture.methods).toEqual(['getGenesisHash', 'getAccountInfo', 'getGenesisHash']);
    expect(fixture.fetch).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:8899/'),
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      }),
    );
  });

  it('returns null only for an explicit absent account value', async () => {
    const fixture = rpcFetch({ account: null });
    const reader = new LocalnetProgramAccountReader({ fetch: fixture.fetch });

    await expect(reader.readAccount(request({ commitment: 'processed' }))).resolves.toBeNull();
  });

  it('rejects a substituted genesis before reading account state', async () => {
    const fixture = rpcFetch({ genesis: ACCOUNT });
    const reader = new LocalnetProgramAccountReader({ fetch: fixture.fetch });

    await expect(reader.readAccount(request())).rejects.toMatchObject({
      code: 'network-mismatch',
    });
    expect(fixture.methods).toEqual(['getGenesisHash']);
  });

  it('rejects a provider that changes genesis after the account response', async () => {
    const fixture = rpcFetch({ genesis: [GENESIS, ACCOUNT] });
    const reader = new LocalnetProgramAccountReader({ fetch: fixture.fetch });

    await expect(reader.readAccount(request())).rejects.toMatchObject({
      code: 'network-mismatch',
    });
    expect(fixture.methods).toEqual(['getGenesisHash', 'getAccountInfo', 'getGenesisHash']);
  });

  it.each([
    ['remote endpoint', { endpoint: 'https://api.devnet.solana.com' }],
    ['credentialed endpoint', { endpoint: 'http://user:secret@localhost:8899' }],
    ['bad address', { address: 'not-an-address' }],
    ['bad commitment', { commitment: 'optimistic' }],
  ])('rejects %s before any request', async (_label, override) => {
    const fixture = rpcFetch();
    const reader = new LocalnetProgramAccountReader({ fetch: fixture.fetch });

    await expect(
      reader.readAccount(request(override) as ReturnType<typeof request>),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'executable account',
      {
        data: ['AQIDBA==', 'base64'],
        executable: true,
        lamports: 1,
        owner: PROGRAM,
        space: 4,
      },
    ],
    [
      'wrong space',
      {
        data: ['AQIDBA==', 'base64'],
        executable: false,
        lamports: 1,
        owner: PROGRAM,
        space: 5,
      },
    ],
    [
      'noncanonical data',
      {
        data: ['AQIDBA', 'base64'],
        executable: false,
        lamports: 1,
        owner: PROGRAM,
        space: 4,
      },
    ],
  ])('rejects an invalid %s envelope', async (_label, account) => {
    const fixture = rpcFetch({ account });
    const reader = new LocalnetProgramAccountReader({ fetch: fixture.fetch });

    await expect(reader.readAccount(request())).rejects.toMatchObject({
      code: 'invalid-response',
    });
  });

  it('honors cancellation before touching the RPC endpoint', async () => {
    const fixture = rpcFetch();
    const controller = new AbortController();
    controller.abort('user cancelled');
    const reader = new LocalnetProgramAccountReader({
      abortSignal: controller.signal,
      fetch: fixture.fetch,
    });

    await expect(reader.readAccount(request())).rejects.toMatchObject({ code: 'aborted' });
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it('rejects a substituted JSON-RPC response id', async () => {
    const fixture = rpcFetch({ responseId: 'another-request' });
    const reader = new LocalnetProgramAccountReader({ fetch: fixture.fetch });

    await expect(reader.readAccount(request())).rejects.toMatchObject({
      code: 'invalid-response',
    });
  });
});

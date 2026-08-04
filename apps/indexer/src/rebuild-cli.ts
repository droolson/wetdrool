import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { networkIdSchema } from '@wetdrool/protocol';

import { readIndexerConfig } from './config.js';
import { rebuildFromDurableLedger } from './rebuild.js';

export const INDEXER_REBUILD_HELP = `Usage:
  pnpm --filter @wetdrool/indexer rebuild:projection --network <network-id>
  pnpm --filter @wetdrool/indexer rebuild:projection --network <network-id> --apply --confirm <token>

The default is a read-only dry run. Apply mode validates the complete durable
raw-event ledger in an isolated in-memory projection before atomically replacing
the live materialized projection. This in-memory path refuses ledgers above
50,000 events; a streaming shadow-projection rebuild remains required for
production-scale history. The confirmation token is:
  rebuild:<network-id>
`;

export interface RebuildCliOptions {
  readonly help: boolean;
  readonly networkId?: string;
  readonly apply: boolean;
}

export function rebuildConfirmationToken(networkId: string): string {
  return `rebuild:${networkIdSchema.parse(networkId)}`;
}

export function parseRebuildCliArguments(arguments_: readonly string[]): RebuildCliOptions {
  if (arguments_.includes('--help') || arguments_.includes('-h')) {
    if (arguments_.length !== 1) {
      throw new TypeError('--help cannot be combined with rebuild options.');
    }
    return { help: true, apply: false };
  }

  let networkId: string | undefined;
  let confirmation: string | undefined;
  let apply = false;
  let explicitDryRun = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--network') {
      networkId = optionValue(arguments_, (index += 1), '--network');
    } else if (argument === '--confirm') {
      confirmation = optionValue(arguments_, (index += 1), '--confirm');
    } else if (argument === '--apply') {
      apply = true;
    } else if (argument === '--dry-run') {
      explicitDryRun = true;
    } else {
      throw new TypeError(`Unknown indexer rebuild option: ${argument ?? '<missing>'}`);
    }
  }
  if (networkId === undefined) {
    throw new TypeError('Indexer rebuild requires --network <network-id>.');
  }
  const parsedNetworkId = networkIdSchema.parse(networkId);
  if (apply && explicitDryRun) {
    throw new TypeError('--apply and --dry-run cannot be combined.');
  }
  if (!apply && confirmation !== undefined) {
    throw new TypeError('--confirm is accepted only with --apply.');
  }
  if (apply && confirmation !== rebuildConfirmationToken(parsedNetworkId)) {
    throw new TypeError(
      `Apply mode requires --confirm ${rebuildConfirmationToken(parsedNetworkId)}.`,
    );
  }
  return { help: false, networkId: parsedNetworkId, apply };
}

export async function runRebuildCli(arguments_: readonly string[]): Promise<void> {
  const options = parseRebuildCliArguments(arguments_);
  if (options.help) {
    process.stdout.write(INDEXER_REBUILD_HELP);
    return;
  }
  if (options.networkId === undefined) {
    throw new TypeError('Indexer rebuild network was not resolved.');
  }

  const config = readIndexerConfig();
  const summary = await rebuildFromDurableLedger({
    databaseUrl: config.databaseUrl,
    contentStoragePath: config.contentStoragePath,
    networkId: options.networkId,
    apply: options.apply,
    profileSchemaV2ActivationSlot: config.profileSchemaV2ActivationSlot,
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

function optionValue(arguments_: readonly string[], index: number, option: string): string {
  const value = arguments_[index];
  if (value === undefined || value.startsWith('--')) {
    throw new TypeError(`${option} requires a value.`);
  }
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runRebuildCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown indexer rebuild failure.';
    process.stderr.write(`Indexer rebuild failed: ${message}\n`);
    process.exitCode = 1;
  });
}

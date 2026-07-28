import { delimiter, join } from 'node:path';

import { repositoryRoot } from './workspaces.mjs';

export const toolchainRoot = join(repositoryRoot, '.local', 'toolchains');
export const cargoHome = join(toolchainRoot, 'cargo');
export const rustupHome = join(toolchainRoot, 'rustup');
export const agaveRoot = join(toolchainRoot, 'agave', '2.3.0', 'solana-release');
export const anchorRoot = join(toolchainRoot, 'anchor', '0.32.1');

export function chainEnvironment(baseEnvironment = process.env) {
  return {
    ...baseEnvironment,
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
    PATH: [
      join(anchorRoot, 'bin'),
      join(agaveRoot, 'bin'),
      join(cargoHome, 'bin'),
      baseEnvironment.PATH,
    ]
      .filter(Boolean)
      .join(delimiter),
  };
}

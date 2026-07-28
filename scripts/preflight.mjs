import { spawnSync } from 'node:child_process';

const expectedNode = '22.23.1';
const expectedPnpm = '11.2.2';
const requireDocker = process.argv.includes('--with-docker');

function fail(message) {
  console.error(`preflight: ${message}`);
  process.exitCode = 1;
}

function version(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error || result.status !== 0) {
    return undefined;
  }

  return result.stdout.trim();
}

const actualNode = process.versions.node;
if (actualNode !== expectedNode) {
  fail(`Node ${expectedNode} is required; found ${actualNode}.`);
} else {
  console.log(`preflight: Node ${actualNode}`);
}

const actualPnpm = version('pnpm', ['--version']);
if (actualPnpm !== expectedPnpm) {
  fail(`pnpm ${expectedPnpm} is required; found ${actualPnpm ?? 'not installed'}.`);
} else {
  console.log(`preflight: pnpm ${actualPnpm}`);
}

if (requireDocker) {
  const dockerVersion = version('docker', ['--version']);
  const composeVersion = version('docker', ['compose', 'version']);
  const daemonVersion = version('docker', ['info', '--format', '{{.ServerVersion}}']);

  if (!dockerVersion || !composeVersion || !daemonVersion) {
    fail('a running Docker daemon with Docker Compose is required for local infrastructure.');
  } else {
    console.log(`preflight: ${dockerVersion}`);
    console.log(`preflight: ${composeVersion}`);
    console.log(`preflight: Docker daemon ${daemonVersion}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

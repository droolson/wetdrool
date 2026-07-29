import { spawn } from 'node:child_process';

const separatorIndex = process.argv.indexOf('--', 2);
if (separatorIndex < 0 || separatorIndex === process.argv.length - 1) {
  console.error(
    'usage: node scripts/run-scoped-runtime.mjs [--rate-limit] [ALLOWED_DATABASE_URL_NAME] -- <command> [args...]',
  );
  process.exit(2);
}

const scopeArguments = process.argv.slice(2, separatorIndex);
const allowRateLimitSecrets = scopeArguments.includes('--rate-limit');
const allowedRuntimeUrls = new Set(
  scopeArguments.filter((argument) => argument !== '--rate-limit'),
);
if (
  scopeArguments.filter((argument) => argument === '--rate-limit').length > 1 ||
  allowedRuntimeUrls.size > 1 ||
  [...allowedRuntimeUrls].some((name) => !/^(?:[A-Z][A-Z0-9]*_)*DATABASE_URL$/u.test(name))
) {
  console.error('run-scoped-runtime: the optional runtime scope is invalid');
  process.exit(2);
}

const environment = { ...process.env };
for (const name of Object.keys(environment)) {
  const isRawDatabaseCredential = /(?:^|_)DATABASE_(?:MIGRATION|RUNTIME)_(?:PASSWORD|URL)$/u.test(
    name,
  );
  const isBootstrapCredential = [
    'PGPASSWORD',
    'PGPASSFILE',
    'POSTGRES_PASSWORD',
    'POSTGRES_PASSWORD_FILE',
  ].includes(name);
  const isUnscopedRuntimeUrl = /(?:^|_)DATABASE_URL$/u.test(name) && !allowedRuntimeUrls.has(name);
  const isUnscopedRateLimitSecret =
    !allowRateLimitSecrets && ['RATE_LIMIT_KEY_SECRET', 'REDIS_URL'].includes(name);
  if (
    isRawDatabaseCredential ||
    isBootstrapCredential ||
    isUnscopedRuntimeUrl ||
    isUnscopedRateLimitSecret
  ) {
    Reflect.deleteProperty(environment, name);
  }
}

const [command, ...arguments_] = process.argv.slice(separatorIndex + 1);
const child = spawn(command, arguments_, {
  env: environment,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.once('error', (error) => {
  console.error(`run-scoped-runtime: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal !== null) {
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    return;
  }
  process.exitCode = code ?? 1;
});

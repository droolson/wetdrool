import { parseRelayConfig } from './config.js';
import { combineRelayReadinessChecks } from './http-authorizer-client.js';
import { HttpRelayKeyAuthorizer } from './http-key-authorizer.js';
import { HttpRelaySubscriptionAuthorizer } from './http-subscription-authorizer.js';
import { RelayServer } from './relay-server.js';

const config = parseRelayConfig(process.env);
const {
  keyAuthorizer: keyAuthorizerConfig,
  subscriptionAuthorizer: subscriptionAuthorizerConfig,
  ...serverConfig
} = config;
const keyAuthorizer =
  keyAuthorizerConfig === undefined ? undefined : new HttpRelayKeyAuthorizer(keyAuthorizerConfig);
const subscriptionAuthorizer =
  subscriptionAuthorizerConfig === undefined
    ? undefined
    : new HttpRelaySubscriptionAuthorizer(subscriptionAuthorizerConfig);
const readinessCheck = combineRelayReadinessChecks([
  keyAuthorizer?.readinessCheck,
  subscriptionAuthorizer?.readinessCheck,
]);
const relay = new RelayServer({
  ...serverConfig,
  ...(keyAuthorizer === undefined ? {} : { authorizeKey: keyAuthorizer.authorize }),
  ...(subscriptionAuthorizer === undefined
    ? {}
    : { authorizeSubscription: subscriptionAuthorizer.authorize }),
  ...(readinessCheck === undefined ? {} : { readinessCheck }),
});

const shutdown = async (signal: NodeJS.Signals) => {
  process.stderr.write(`[relay] ${signal} received; shutting down.\n`);
  await relay.stop();
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await relay.start();
} catch {
  process.stderr.write('[relay] startup failed.\n');
  process.exitCode = 1;
  await relay.stop();
}

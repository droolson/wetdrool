import { parseRelayConfig } from './config.js';
import { RelayServer } from './relay-server.js';

const config = parseRelayConfig(process.env);
const relay = new RelayServer(config);

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

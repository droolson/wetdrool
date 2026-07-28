import { buildFeedServiceApp } from './app.js';
import { parseFeedServiceConfig } from './config.js';

const config = parseFeedServiceConfig(process.env);
const app = await buildFeedServiceApp({
  allowedOrigins: config.allowedOrigins,
});

const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, 'Stopping feed service');
  await app.close();
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ error }, 'Feed service failed to start');
  process.exitCode = 1;
  await app.close();
}

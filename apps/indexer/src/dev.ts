import { removeIndexerSetupOnlyVariables } from './config.js';

removeIndexerSetupOnlyVariables(process.env);

await import('./server.js');

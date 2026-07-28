import { EnvironmentValidationError, parseServerEnvironment, summarizeEnvironment } from './env.ts';

try {
  const environment = parseServerEnvironment(process.env);
  console.log(JSON.stringify(summarizeEnvironment(environment), null, 2));
} catch (error) {
  if (error instanceof EnvironmentValidationError) {
    console.error(error.message);
  } else {
    console.error('Environment validation failed with an unexpected error.');
  }
  process.exitCode = 1;
}

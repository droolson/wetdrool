import { z } from 'zod';

const legacyRedirectHostnames = new Set(['sociallywoke.com', 'www.sociallywoke.com']);
const originSchema = z
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      !legacyRedirectHostnames.has(parsed.hostname.toLowerCase())
    );
  }, 'Feed CORS origins must be credential-free HTTP(S) origins and cannot use the legacy redirect host.')
  .transform((value) => new URL(value).origin);

const environmentSchema = z.strictObject({
  FEED_SERVICE_HOST: z.string().trim().min(1).default('127.0.0.1'),
  FEED_SERVICE_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  FEED_SERVICE_CORS_ORIGINS: z.string().default(''),
});

export interface FeedServiceConfig {
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
}

export function parseFeedServiceConfig(
  environment: Readonly<Record<string, string | undefined>>,
): FeedServiceConfig {
  const parsed = environmentSchema.parse({
    FEED_SERVICE_HOST: environment.FEED_SERVICE_HOST,
    FEED_SERVICE_PORT: environment.FEED_SERVICE_PORT,
    FEED_SERVICE_CORS_ORIGINS: environment.FEED_SERVICE_CORS_ORIGINS,
  });
  return {
    host: parsed.FEED_SERVICE_HOST,
    port: parsed.FEED_SERVICE_PORT,
    allowedOrigins: [
      ...new Set(
        parsed.FEED_SERVICE_CORS_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0)
          .map((origin) => originSchema.parse(origin)),
      ),
    ],
  };
}

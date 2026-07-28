import { z } from 'zod';

const legacyRedirectHostnames = new Set(['sociallywoke.com', 'www.sociallywoke.com']);
const hostSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !/[\s/\\]/u.test(value), 'Relay host must not contain whitespace or paths.');
const relayIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u);
const originSchema = z
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      parsed.username === '' &&
      parsed.password === '' &&
      !legacyRedirectHostnames.has(parsed.hostname.toLowerCase())
    );
  }, 'Relay origins must be credential-free HTTP(S) URLs and cannot use the legacy redirect host.')
  .transform((value) => new URL(value).origin);

const environmentSchema = z
  .object({
    RELAY_HOST: hostSchema.default('127.0.0.1'),
    RELAY_PORT: z.coerce.number().int().min(1).max(65_535).default(4200),
    RELAY_ID: relayIdSchema.default('socially-woke-relay'),
    RELAY_ALLOWED_ORIGINS: z.string().default(''),
    RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: z.enum(['0', '1']).default('0'),
  })
  .transform((environment) => ({
    host: environment.RELAY_HOST,
    port: environment.RELAY_PORT,
    relayId: environment.RELAY_ID,
    allowedOrigins: parseOrigins(environment.RELAY_ALLOWED_ORIGINS),
    dangerouslyAllowUnverifiedLocalMode:
      environment.RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE === '1',
  }));

export interface RelayConfig {
  readonly host: string;
  readonly port: number;
  readonly relayId: string;
  readonly allowedOrigins: readonly string[];
  readonly dangerouslyAllowUnverifiedLocalMode: boolean;
}

export function parseRelayConfig(
  environment: Readonly<Record<string, string | undefined>>,
): RelayConfig {
  return environmentSchema.parse(environment);
}

function parseOrigins(value: string): readonly string[] {
  if (value.trim() === '') {
    return [];
  }
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => originSchema.parse(item)),
    ),
  ];
}

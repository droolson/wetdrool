import { z } from 'zod';

import {
  assertNodeTlsVerificationPolicy,
  assertNoMigrationCredentials,
  isLocalOrUnspecifiedHostname,
  isLoopbackHostname,
} from '@wokesocial/config';
import { parseTrustedProxyCidrs } from '@wokesocial/config/trusted-proxy';

const legacyRedirectHostnames = new Set(['sociallywoke.com', 'www.sociallywoke.com']);

function isLegacyRedirectHostname(hostname: string): boolean {
  return legacyRedirectHostnames.has(hostname.toLowerCase().replace(/\.+$/u, ''));
}

function isLoopbackHost(hostname: string): boolean {
  return isLoopbackHostname(hostname);
}

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
      !isLegacyRedirectHostname(parsed.hostname)
    );
  }, 'Relay origins must be credential-free HTTP(S) URLs and cannot use the legacy redirect host.')
  .transform((value) => new URL(value).origin);
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalAuthorizerUrlSchema = z.preprocess(
  emptyToUndefined,
  z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        url.username === '' &&
        url.password === '' &&
        url.hash === ''
      );
    }, 'Relay authorizer URLs must be credential-free HTTP(S) URLs without fragments.')
    .optional(),
);
const optionalBearerTokenSchema = z.preprocess(
  emptyToUndefined,
  z.string().min(32).max(512).optional(),
);

const environmentSchema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    NODE_TLS_REJECT_UNAUTHORIZED: z.string().optional(),
    RELAY_HOST: hostSchema.default('127.0.0.1'),
    RELAY_PORT: z.coerce.number().int().min(1).max(65_535).default(4200),
    RELAY_ID: relayIdSchema.default('wokesocial-relay'),
    RELAY_ALLOWED_ORIGINS: z.string().default(''),
    RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: z.enum(['0', '1']).default('0'),
    RELAY_KEY_AUTHORIZER_URL: optionalAuthorizerUrlSchema,
    RELAY_KEY_AUTHORIZER_READINESS_URL: optionalAuthorizerUrlSchema,
    RELAY_KEY_AUTHORIZER_BEARER_TOKEN: optionalBearerTokenSchema,
    RELAY_KEY_AUTHORIZER_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
    RELAY_SUBSCRIPTION_AUTHORIZER_URL: optionalAuthorizerUrlSchema,
    RELAY_SUBSCRIPTION_AUTHORIZER_READINESS_URL: optionalAuthorizerUrlSchema,
    RELAY_SUBSCRIPTION_AUTHORIZER_BEARER_TOKEN: optionalBearerTokenSchema,
    RELAY_SUBSCRIPTION_AUTHORIZER_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(10_000)
      .default(2_000),
    TRUSTED_PROXY_CIDRS: z.string().optional(),
  })
  .superRefine((environment, context) => {
    const tlsRequired =
      environment.APP_ENV === 'staging' ||
      environment.APP_ENV === 'production' ||
      environment.NODE_ENV === 'production';
    try {
      assertNodeTlsVerificationPolicy(environment.NODE_TLS_REJECT_UNAUTHORIZED, { tlsRequired });
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'TLS verification policy is invalid.',
        path: ['NODE_TLS_REJECT_UNAUTHORIZED'],
      });
    }
    if (
      environment.RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE === '1' &&
      (tlsRequired || !isLoopbackHost(environment.RELAY_HOST))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Unverified relay authorization is restricted to loopback development.',
        path: ['RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE'],
      });
    }
    if (
      environment.RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE === '1' &&
      (environment.RELAY_KEY_AUTHORIZER_URL !== undefined ||
        environment.RELAY_SUBSCRIPTION_AUTHORIZER_URL !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Verified authorization adapters and unverified local mode are mutually exclusive.',
        path: [
          environment.RELAY_KEY_AUTHORIZER_URL === undefined
            ? 'RELAY_SUBSCRIPTION_AUTHORIZER_URL'
            : 'RELAY_KEY_AUTHORIZER_URL',
        ],
      });
    }
    if (
      environment.RELAY_KEY_AUTHORIZER_URL === undefined &&
      (environment.RELAY_KEY_AUTHORIZER_READINESS_URL !== undefined ||
        environment.RELAY_KEY_AUTHORIZER_BEARER_TOKEN !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A key-authorizer URL is required for authorizer readiness or credentials.',
        path: ['RELAY_KEY_AUTHORIZER_URL'],
      });
    }
    if (
      environment.RELAY_SUBSCRIPTION_AUTHORIZER_URL === undefined &&
      (environment.RELAY_SUBSCRIPTION_AUTHORIZER_READINESS_URL !== undefined ||
        environment.RELAY_SUBSCRIPTION_AUTHORIZER_BEARER_TOKEN !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A subscription-authorizer URL is required for authorizer readiness or credentials.',
        path: ['RELAY_SUBSCRIPTION_AUTHORIZER_URL'],
      });
    }
    if (tlsRequired) {
      for (const candidate of environment.RELAY_ALLOWED_ORIGINS.split(',')
        .map((value) => value.trim())
        .filter(Boolean)) {
        const parsedOrigin = originSchema.safeParse(candidate);
        if (parsedOrigin.success) {
          const url = new URL(parsedOrigin.data);
          if (url.protocol !== 'https:' || isLocalOrUnspecifiedHostname(url.hostname)) {
            context.addIssue({
              code: 'custom',
              message: 'Relay origins must use non-local HTTPS outside local development.',
              path: ['RELAY_ALLOWED_ORIGINS'],
            });
          }
        }
      }
      for (const [path, value] of [
        ['RELAY_KEY_AUTHORIZER_URL', environment.RELAY_KEY_AUTHORIZER_URL],
        ['RELAY_KEY_AUTHORIZER_READINESS_URL', environment.RELAY_KEY_AUTHORIZER_READINESS_URL],
        ['RELAY_SUBSCRIPTION_AUTHORIZER_URL', environment.RELAY_SUBSCRIPTION_AUTHORIZER_URL],
        [
          'RELAY_SUBSCRIPTION_AUTHORIZER_READINESS_URL',
          environment.RELAY_SUBSCRIPTION_AUTHORIZER_READINESS_URL,
        ],
      ] as const) {
        if (value !== undefined) {
          const url = new URL(value);
          if (url.protocol === 'https:' && !isLocalOrUnspecifiedHostname(url.hostname)) {
            continue;
          }
          context.addIssue({
            code: 'custom',
            message: 'must use non-local HTTPS when transport TLS is required',
            path: [path],
          });
        }
      }
    }
  })
  .transform((environment) => ({
    host: environment.RELAY_HOST,
    port: environment.RELAY_PORT,
    relayId: environment.RELAY_ID,
    allowedOrigins: parseOrigins(environment.RELAY_ALLOWED_ORIGINS),
    dangerouslyAllowUnverifiedLocalMode:
      environment.RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE === '1',
    trustedProxyCidrs: parseTrustedProxyCidrs(environment.TRUSTED_PROXY_CIDRS),
    ...(environment.RELAY_KEY_AUTHORIZER_URL === undefined
      ? {}
      : {
          keyAuthorizer: {
            endpoint: environment.RELAY_KEY_AUTHORIZER_URL,
            readinessEndpoint:
              environment.RELAY_KEY_AUTHORIZER_READINESS_URL ??
              new URL('/readyz', environment.RELAY_KEY_AUTHORIZER_URL).href,
            ...(environment.RELAY_KEY_AUTHORIZER_BEARER_TOKEN === undefined
              ? {}
              : { bearerToken: environment.RELAY_KEY_AUTHORIZER_BEARER_TOKEN }),
            timeoutMilliseconds: environment.RELAY_KEY_AUTHORIZER_TIMEOUT_MS,
          },
        }),
    ...(environment.RELAY_SUBSCRIPTION_AUTHORIZER_URL === undefined
      ? {}
      : {
          subscriptionAuthorizer: {
            endpoint: environment.RELAY_SUBSCRIPTION_AUTHORIZER_URL,
            readinessEndpoint:
              environment.RELAY_SUBSCRIPTION_AUTHORIZER_READINESS_URL ??
              new URL('/readyz', environment.RELAY_SUBSCRIPTION_AUTHORIZER_URL).href,
            ...(environment.RELAY_SUBSCRIPTION_AUTHORIZER_BEARER_TOKEN === undefined
              ? {}
              : {
                  bearerToken: environment.RELAY_SUBSCRIPTION_AUTHORIZER_BEARER_TOKEN,
                }),
            timeoutMilliseconds: environment.RELAY_SUBSCRIPTION_AUTHORIZER_TIMEOUT_MS,
          },
        }),
  }));

export interface RelayConfig {
  readonly host: string;
  readonly port: number;
  readonly relayId: string;
  readonly allowedOrigins: readonly string[];
  readonly dangerouslyAllowUnverifiedLocalMode: boolean;
  readonly trustedProxyCidrs: readonly string[];
  readonly keyAuthorizer?: Readonly<{
    endpoint: string;
    readinessEndpoint: string;
    bearerToken?: string;
    timeoutMilliseconds: number;
  }>;
  readonly subscriptionAuthorizer?: Readonly<{
    endpoint: string;
    readinessEndpoint: string;
    bearerToken?: string;
    timeoutMilliseconds: number;
  }>;
}

export function parseRelayConfig(
  environment: Readonly<Record<string, string | undefined>>,
): RelayConfig {
  assertNoMigrationCredentials(environment);
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

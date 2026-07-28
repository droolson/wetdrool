import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AuthServiceError } from './errors.js';

export function installAuthErrorHandler(app: FastifyInstance, maximumBodyBytes: number): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AuthServiceError) {
      void reply.code(statusFor(error)).send(errorBody(error.code, error.message));
      return;
    }
    if (error instanceof z.ZodError) {
      void reply.code(400).send({
        ...errorBody('invalid-request', 'The request is invalid.'),
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    if (hasStatus(error, 413)) {
      void reply
        .code(413)
        .send(
          errorBody(
            'body-too-large',
            `Request bodies may not exceed ${String(maximumBodyBytes)} bytes.`,
          ),
        );
      return;
    }
    if (hasStatus(error, 429)) {
      void reply
        .code(429)
        .send(errorBody('rate-limit-exceeded', 'The request rate limit was exceeded.'));
      return;
    }
    if (hasCode(error, 'FST_ERR_CTP_INVALID_JSON_BODY', 'FST_ERR_CTP_EMPTY_JSON_BODY')) {
      void reply.code(400).send(errorBody('invalid-json', 'The request body must be valid JSON.'));
      return;
    }
    request.log.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        requestId: request.id,
      },
      'Unhandled auth-service request error',
    );
    void reply
      .code(500)
      .send(
        errorBody('internal-error', 'The authentication service could not complete the request.'),
      );
  });
}

function statusFor(error: AuthServiceError): number {
  switch (error.code) {
    case 'session-required':
      return 401;
    case 'csrf-invalid':
    case 'origin-invalid':
    case 'step-up-required':
      return 403;
    case 'account-unavailable':
    case 'credential-duplicate':
    case 'credential-unavailable':
    case 'last-credential':
      return 409;
    case 'database-error':
      return 503;
    case 'bundle-invalid':
    case 'ceremony-unavailable':
    case 'invalid-request':
    case 'verification-failed':
      return 400;
  }
}

function errorBody(code: string, message: string) {
  return {
    replaceable: true,
    canonical: false,
    error: { code, message },
  };
}

function hasStatus(error: unknown, statusCode: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === statusCode
  );
}

function hasCode(error: unknown, ...codes: readonly string[]): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
  );
}

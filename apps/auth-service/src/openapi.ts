export const authOpenApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Socially Woke Replaceable Authentication API',
    version: '0.1.0',
    description:
      'Passkey account authentication and opaque encrypted key-bundle synchronization. This service never becomes a Socially Woke protocol identity or signing authority.',
  },
  paths: {
    '/healthz': {
      get: { summary: 'Process liveness', responses: { '200': { description: 'Live' } } },
    },
    '/readyz': {
      get: {
        summary: 'Store readiness',
        responses: {
          '200': { description: 'Ready' },
          '503': { description: 'Store unavailable' },
        },
      },
    },
    '/v1/policy': {
      get: {
        summary: 'Authentication and custody capabilities',
        responses: { '200': { description: 'Explicit supported and unsupported capabilities' } },
      },
    },
    '/v1/csrf': {
      get: {
        summary: 'Issue a host-bound double-submit CSRF token',
        responses: { '200': { description: 'CSRF token and Strict host-only cookie' } },
      },
    },
    '/v1/registration/options': {
      post: {
        summary: 'Start registration for a new opaque account',
        responses: { '200': { description: 'User-verifying discoverable-credential options' } },
      },
    },
    '/v1/registration/verify': {
      post: {
        summary: 'Consume and verify a new-account registration ceremony',
        responses: {
          '201': { description: 'Credential registered and authenticated session issued' },
          '400': { description: 'Invalid or failed one-time ceremony' },
          '409': { description: 'Credential ID already registered' },
        },
      },
    },
    '/v1/authentication/options': {
      post: {
        summary: 'Start discoverable passkey authentication',
        responses: { '200': { description: 'No allow-list or account identifier is required' } },
      },
    },
    '/v1/authentication/verify': {
      post: {
        summary: 'Consume and verify discoverable authentication',
        responses: {
          '200': { description: 'Authenticated session issued' },
          '400': { description: 'Invalid or failed one-time ceremony' },
        },
      },
    },
    '/v1/step-up/options': {
      post: {
        summary: 'Start an account-bound step-up assertion',
        responses: {
          '200': { description: 'Account credential options' },
          '401': { description: 'Session required' },
        },
      },
    },
    '/v1/step-up/verify': {
      post: {
        summary: 'Verify step-up and rotate session secrets',
        responses: {
          '200': { description: 'Fresh step-up session' },
          '400': { description: 'Verification failed' },
        },
      },
    },
    '/v1/credentials': {
      get: {
        summary: 'List credentials for the authenticated opaque account',
        responses: { '200': { description: 'Credential metadata only' } },
      },
    },
    '/v1/credentials/registration/options': {
      post: {
        summary: 'Start adding another passkey after fresh step-up',
        responses: {
          '200': { description: 'Registration options excluding existing credentials' },
          '403': { description: 'Fresh step-up required' },
        },
      },
    },
    '/v1/credentials/registration/verify': {
      post: {
        summary: 'Verify and add another passkey after fresh step-up',
        responses: {
          '201': { description: 'Additional credential registered' },
          '409': { description: 'Duplicate credential ID' },
        },
      },
    },
    '/v1/credentials/{credentialId}': {
      delete: {
        summary: 'Revoke a credential, its synchronized wrappers, and account sessions',
        description:
          'Requires fresh step-up. Revocation atomically invalidates every session for the account and clears the current cookies. The last active credential cannot be revoked because recovery is not implemented.',
        parameters: [
          { name: 'credentialId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Credential and all account sessions revoked' },
          '409': { description: 'Last active credential or unavailable credential' },
        },
      },
    },
    '/v1/key-bundles': {
      get: {
        summary: 'List opaque encrypted key bundles after authentication',
        responses: { '200': { description: 'Ciphertext bundles only' } },
      },
    },
    '/v1/key-bundles/{credentialId}': {
      put: {
        summary: 'Synchronize one credential-bound ciphertext bundle',
        description:
          'PRF results, plaintext seeds, and private keys are rejected. The server validates only the opaque @socially-woke/crypto bundle.',
        parameters: [
          { name: 'credentialId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Ciphertext synchronized' },
          '400': { description: 'Malformed or misbound bundle' },
        },
      },
    },
    '/v1/session': {
      get: {
        summary: 'Read the current opaque account session',
        responses: {
          '200': { description: 'Session capabilities' },
          '401': { description: 'Session required' },
        },
      },
    },
    '/v1/logout': {
      post: {
        summary: 'Revoke the current session and clear cookies',
        responses: { '204': { description: 'Logged out' } },
      },
    },
  },
} as const;

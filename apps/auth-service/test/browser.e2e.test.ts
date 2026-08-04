import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import {
  AuthService,
  buildAuthApp,
  CSRF_COOKIE_NAME,
  MemoryAuthStore,
  SESSION_COOKIE_NAME,
} from '../src/index.js';

describe('real browser WebAuthn ceremony', () => {
  it('registers, authenticates discoverably, and step-ups with a virtual authenticator', async () => {
    const port = 4300;
    const origin = `http://localhost:${String(port)}`;
    const store = new MemoryAuthStore();
    const service = new AuthService({
      store,
      rpName: 'WetDrool Browser Gate',
      rpId: 'localhost',
      origin,
    });
    const app = await buildAuthApp({ service, logger: false, rateLimitMax: 200 });
    await app.listen({ host: '127.0.0.1', port });
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext({ bypassCSP: true });
      const page = await context.newPage();
      const client = await context.newCDPSession(page);
      await client.send('WebAuthn.enable');
      await client.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
          defaultBackupEligibility: false,
          defaultBackupState: false,
        },
      });
      await page.goto(`${origin}/healthz`);

      const result = await page.evaluate(async () => {
        function decode(value: string): ArrayBuffer {
          const padded = value.replace(/-/gu, '+').replace(/_/gu, '/');
          const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
          return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
        }
        function encode(value: ArrayBuffer): string {
          const bytes = new Uint8Array(value);
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
        }
        function encodeLength(length: number): Uint8Array {
          const encoded = new Uint8Array(4);
          new DataView(encoded.buffer).setUint32(0, length, false);
          return encoded;
        }
        function concat(parts: readonly Uint8Array[]): Uint8Array {
          const result = new Uint8Array(
            parts.reduce((length, part) => length + part.byteLength, 0),
          );
          let offset = 0;
          for (const part of parts) {
            result.set(part, offset);
            offset += part.byteLength;
          }
          return result;
        }
        async function rootBundle(credential: PublicKeyCredential) {
          const encoder = new TextEncoder();
          const fields = [
            encoder.encode('wetdrool.crypto/v1'),
            encoder.encode('sha256'),
            encoder.encode('wetdrool/auth/passkey-credential-binding'),
            encodeLength(1),
            new Uint8Array(credential.rawId),
          ];
          const framed = concat(fields.flatMap((field) => [encodeLength(field.byteLength), field]));
          const binding = await crypto.subtle.digest('SHA-256', framed.buffer as ArrayBuffer);
          const publicKey = crypto.getRandomValues(new Uint8Array(32));
          const salt = crypto.getRandomValues(new Uint8Array(32));
          const nonce = crypto.getRandomValues(new Uint8Array(12));
          const ciphertext = crypto.getRandomValues(new Uint8Array(48));
          return {
            version: 1,
            kdf: 'HKDF-SHA-256',
            algorithm: 'A256GCM',
            credentialBinding: encode(binding),
            keyKind: 'solana-ed25519-root-seed',
            publicKey: encode(publicKey.buffer as ArrayBuffer),
            salt: encode(salt.buffer as ArrayBuffer),
            encryptedKey: {
              version: 1,
              algorithm: 'A256GCM',
              domain: 'wetdrool/auth/account-key-bundle',
              nonce: encode(nonce.buffer as ArrayBuffer),
              ciphertext: encode(ciphertext.buffer as ArrayBuffer),
            },
          };
        }
        function creationOptions(
          input: Record<string, unknown>,
        ): PublicKeyCredentialCreationOptions {
          const value = structuredClone(input) as unknown as {
            challenge: string | ArrayBuffer;
            user: { id: string | ArrayBuffer };
            excludeCredentials?: { id: string | ArrayBuffer }[];
          };
          value.challenge = decode(value.challenge as string);
          value.user.id = decode(value.user.id as string);
          for (const descriptor of value.excludeCredentials ?? []) {
            descriptor.id = decode(descriptor.id as string);
          }
          return value as unknown as PublicKeyCredentialCreationOptions;
        }
        function requestOptions(input: Record<string, unknown>): PublicKeyCredentialRequestOptions {
          const value = structuredClone(input) as unknown as {
            challenge: string | ArrayBuffer;
            allowCredentials?: { id: string | ArrayBuffer }[];
          };
          value.challenge = decode(value.challenge as string);
          for (const descriptor of value.allowCredentials ?? []) {
            descriptor.id = decode(descriptor.id as string);
          }
          return value as unknown as PublicKeyCredentialRequestOptions;
        }
        function registrationJson(credential: PublicKeyCredential) {
          const response = credential.response as AuthenticatorAttestationResponse & {
            getTransports?: () => string[];
          };
          return {
            id: credential.id,
            rawId: encode(credential.rawId),
            type: credential.type,
            authenticatorAttachment: credential.authenticatorAttachment,
            clientExtensionResults: credential.getClientExtensionResults(),
            response: {
              clientDataJSON: encode(response.clientDataJSON),
              attestationObject: encode(response.attestationObject),
              transports: response.getTransports?.() ?? [],
            },
          };
        }
        function authenticationJson(credential: PublicKeyCredential) {
          const response = credential.response as AuthenticatorAssertionResponse;
          return {
            id: credential.id,
            rawId: encode(credential.rawId),
            type: credential.type,
            authenticatorAttachment: credential.authenticatorAttachment,
            clientExtensionResults: credential.getClientExtensionResults(),
            response: {
              clientDataJSON: encode(response.clientDataJSON),
              authenticatorData: encode(response.authenticatorData),
              signature: encode(response.signature),
              userHandle: response.userHandle === null ? undefined : encode(response.userHandle),
            },
          };
        }
        async function csrf() {
          const response = await fetch('/v1/csrf');
          return (await response.json()) as { csrfToken: string };
        }
        async function mutate(path: string, csrfToken: string, body: unknown) {
          return fetch(path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrfToken,
            },
            body: JSON.stringify(body),
          });
        }

        let token = (await csrf()).csrfToken;
        const registrationOptionsResponse = await mutate('/v1/registration/options', token, {});
        const registration = (await registrationOptionsResponse.json()) as {
          accountId: string;
          ceremonyId: string;
          options: Record<string, unknown>;
        };
        const created = (await navigator.credentials.create({
          publicKey: creationOptions(registration.options),
        })) as PublicKeyCredential;
        const registrationVerifyResponse = await mutate('/v1/registration/verify', token, {
          accountId: registration.accountId,
          ceremonyId: registration.ceremonyId,
          response: registrationJson(created),
          bundle: await rootBundle(created),
        });
        const registrationVerified = (await registrationVerifyResponse.json()) as {
          csrfToken: string;
        };
        token = registrationVerified.csrfToken;

        const authenticationOptionsResponse = await mutate('/v1/authentication/options', token, {});
        const authentication = (await authenticationOptionsResponse.json()) as {
          ceremonyId: string;
          options: Record<string, unknown> & { allowCredentials?: unknown[] };
        };
        const asserted = (await navigator.credentials.get({
          publicKey: requestOptions(authentication.options),
        })) as PublicKeyCredential;
        const authenticationVerifyResponse = await mutate('/v1/authentication/verify', token, {
          ceremonyId: authentication.ceremonyId,
          response: authenticationJson(asserted),
        });
        const authenticationVerified = (await authenticationVerifyResponse.json()) as {
          csrfToken: string;
        };
        token = authenticationVerified.csrfToken;

        const stepOptionsResponse = await mutate('/v1/step-up/options', token, {});
        const step = (await stepOptionsResponse.json()) as {
          ceremonyId: string;
          options: Record<string, unknown>;
        };
        const steppedAssertion = (await navigator.credentials.get({
          publicKey: requestOptions(step.options),
        })) as PublicKeyCredential;
        const stepVerifyResponse = await mutate('/v1/step-up/verify', token, {
          ceremonyId: step.ceremonyId,
          response: authenticationJson(steppedAssertion),
        });
        const stepVerified = (await stepVerifyResponse.json()) as {
          csrfToken: string;
        };
        token = stepVerified.csrfToken;
        const credentialsResponse = await fetch('/v1/credentials', {
          credentials: 'same-origin',
        });
        const credentials = (await credentialsResponse.json()) as {
          credentials: unknown[];
        };

        return {
          registrationOptionsStatus: registrationOptionsResponse.status,
          registrationVerifyStatus: registrationVerifyResponse.status,
          authenticationOptionsStatus: authenticationOptionsResponse.status,
          authenticationVerifyStatus: authenticationVerifyResponse.status,
          discoverableAllowCredentials: authentication.options.allowCredentials?.length ?? -1,
          stepOptionsStatus: stepOptionsResponse.status,
          stepVerifyStatus: stepVerifyResponse.status,
          credentialCount: credentials.credentials.length,
          csrfRotated: token !== registrationVerified.csrfToken,
        };
      });

      expect(result).toEqual({
        registrationOptionsStatus: 200,
        registrationVerifyStatus: 201,
        authenticationOptionsStatus: 200,
        authenticationVerifyStatus: 200,
        discoverableAllowCredentials: 0,
        stepOptionsStatus: 200,
        stepVerifyStatus: 200,
        credentialCount: 1,
        csrfRotated: true,
      });
      const storedCookies = await context.cookies(origin);
      expect(storedCookies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: SESSION_COOKIE_NAME,
            domain: 'localhost',
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'Strict',
          }),
          expect.objectContaining({
            name: CSRF_COOKIE_NAME,
            domain: 'localhost',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: 'Strict',
          }),
        ]),
      );
    } finally {
      await browser.close();
      await app.close();
      await store.close();
    }
  }, 30_000);
});

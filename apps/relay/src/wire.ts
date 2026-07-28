import { z } from 'zod';

import {
  signedRelayEventSchema,
  signedSubscriptionSchema,
  type RelayEventKind,
  type SignedRelayEvent,
} from './protocol.js';

export const relayWireKeyAuthorizationSchema = z.enum(['unverified-local', 'verified']);
export type RelayWireKeyAuthorization = z.infer<typeof relayWireKeyAuthorizationSchema>;

export const relayClientFrameSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('publish'), envelope: signedRelayEventSchema }).strict(),
  z.object({ op: z.literal('subscribe'), authorization: signedSubscriptionSchema }).strict(),
]);
export type RelayClientFrame = z.infer<typeof relayClientFrameSchema>;

export const relayErrorCodeSchema = z.enum([
  'backpressure',
  'forbidden',
  'internal-error',
  'invalid-frame',
  'invalid-signature',
  'not-subscribed',
  'rate-limit',
  'replay',
  'too-large',
]);
export type RelayErrorCode = z.infer<typeof relayErrorCodeSchema>;

export interface RelayHelloFrame {
  readonly op: 'hello';
  readonly advisory: true;
  readonly canonical: false;
  readonly relayId: string;
  readonly protocolVersion: 1;
  readonly keyAuthorization: RelayWireKeyAuthorization;
  readonly serverTime: string;
  readonly limits: {
    readonly maximumMessageBytes: number;
    readonly maximumSubscriptions: number;
    readonly retentionMilliseconds: number;
  };
}

export interface RelaySubscribedFrame {
  readonly op: 'subscribed';
  readonly subscriptionId: string;
  readonly topicCount: number;
  readonly expiresAt: string;
}

export interface RelayPublishedFrame {
  readonly op: 'published';
  readonly eventId: string;
  readonly relaySequence: number;
  readonly advisory: true;
  readonly canonical: false;
  readonly keyAuthorization: RelayWireKeyAuthorization;
}

export interface RelayEventFrame {
  readonly op: 'event';
  readonly relayId: string;
  readonly relaySequence: number;
  readonly receivedAt: string;
  readonly retained: boolean;
  readonly eventId: string;
  readonly envelope: SignedRelayEvent;
  readonly advisory: true;
  readonly canonical: false;
  readonly keyAuthorization: RelayWireKeyAuthorization;
}

export interface RelayErrorFrame {
  readonly op: 'error';
  readonly code: RelayErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type RelayServerFrame =
  RelayErrorFrame | RelayEventFrame | RelayHelloFrame | RelayPublishedFrame | RelaySubscribedFrame;

const helloFrameSchema = z
  .object({
    op: z.literal('hello'),
    advisory: z.literal(true),
    canonical: z.literal(false),
    relayId: z.string().min(1).max(160),
    protocolVersion: z.literal(1),
    keyAuthorization: relayWireKeyAuthorizationSchema,
    serverTime: z.string().datetime({ offset: true }),
    limits: z
      .object({
        maximumMessageBytes: z.number().int().positive(),
        maximumSubscriptions: z.number().int().positive(),
        retentionMilliseconds: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

const subscribedFrameSchema = z
  .object({
    op: z.literal('subscribed'),
    subscriptionId: z.string().min(1).max(160),
    topicCount: z.number().int().positive(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

const publishedFrameSchema = z
  .object({
    op: z.literal('published'),
    eventId: z.string().min(1).max(160),
    relaySequence: z.number().int().positive().safe(),
    advisory: z.literal(true),
    canonical: z.literal(false),
    keyAuthorization: relayWireKeyAuthorizationSchema,
  })
  .strict();

const eventFrameSchema = z
  .object({
    op: z.literal('event'),
    relayId: z.string().min(1).max(160),
    relaySequence: z.number().int().positive().safe(),
    receivedAt: z.string().datetime({ offset: true }),
    retained: z.boolean(),
    eventId: z.string().min(1).max(160),
    envelope: signedRelayEventSchema,
    advisory: z.literal(true),
    canonical: z.literal(false),
    keyAuthorization: relayWireKeyAuthorizationSchema,
  })
  .strict();

const errorFrameSchema = z
  .object({
    op: z.literal('error'),
    code: relayErrorCodeSchema,
    message: z.string().min(1).max(240),
    retryable: z.boolean(),
  })
  .strict();

export const relayServerFrameSchema = z.discriminatedUnion('op', [
  helloFrameSchema,
  subscribedFrameSchema,
  publishedFrameSchema,
  eventFrameSchema,
  errorFrameSchema,
]);

export type RelaySubscriptionView = Readonly<{
  identity: string;
  expiresAt: number;
  topics: ReadonlyMap<
    string,
    Readonly<{
      kinds: ReadonlySet<RelayEventKind>;
      sinceSequence?: number;
    }>
  >;
}>;

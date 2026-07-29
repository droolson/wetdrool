import { describe, expect, it } from 'vitest';

import { eventIsWithinSignedSubscription } from '../src/client.js';
import {
  alice,
  alternateTopic,
  bob,
  carol,
  makeEvent,
  makeSubscription,
  testNow,
} from './fixtures.js';

describe('multi-relay client subscription scope', () => {
  it('matches only subscribed topics and event kinds while the signed scope is live', () => {
    const subscription = makeSubscription(bob, {
      kinds: ['encrypted-message', 'new-post'],
    });

    expect(eventIsWithinSignedSubscription(makeEvent('new-post'), subscription, testNow)).toBe(
      true,
    );
    expect(
      eventIsWithinSignedSubscription(
        makeEvent('new-post', { topic: alternateTopic }),
        subscription,
        testNow,
      ),
    ).toBe(false);
    expect(eventIsWithinSignedSubscription(makeEvent('presence'), subscription, testNow)).toBe(
      false,
    );
    expect(
      eventIsWithinSignedSubscription(
        makeEvent('new-post'),
        subscription,
        new Date(subscription.message.expiresAt),
      ),
    ).toBe(false);
  });

  it('matches direct events only for the subscriber as sender or recipient', () => {
    const subscription = makeSubscription(bob, {
      kinds: ['encrypted-message'],
    });

    expect(
      eventIsWithinSignedSubscription(
        makeEvent('encrypted-message', {
          audience: { kind: 'identity', recipients: [bob.identityId] },
        }),
        subscription,
        testNow,
      ),
    ).toBe(true);
    expect(
      eventIsWithinSignedSubscription(
        makeEvent('encrypted-message', {
          identity: bob,
          audience: { kind: 'identity', recipients: [carol.identityId] },
        }),
        subscription,
        testNow,
      ),
    ).toBe(true);
    expect(
      eventIsWithinSignedSubscription(
        makeEvent('encrypted-message', {
          identity: alice,
          audience: { kind: 'identity', recipients: [carol.identityId] },
        }),
        subscription,
        testNow,
      ),
    ).toBe(false);
  });
});

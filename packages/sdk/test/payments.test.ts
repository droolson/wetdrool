import { describe, expect, it } from 'vitest';

import {
  PaymentPlanError,
  assertPaymentSimulationMatches,
  calculatePaymentPlan,
  type ObservedTransfer,
  type PaymentPlanInput,
} from '../src/index.js';

const network =
  'wokenet:v1:US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx:YMN9Qj5jPNp7j14VPcML1B6xGgcPWVZUGLFU3Mnyfaf';
const identityA = `wokesocialid:v1:${network}:cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN`;
const identityB = `wokesocialid:v1:${network}:gBxS1f6uyyGPuW5MzGBukidSb71jdsCb5fZaoSzULE5`;
const destinationA = 'cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN';
const destinationB = 'gBxS1f6uyyGPuW5MzGBukidSb71jdsCb5fZaoSzULE5';
const feeDestination = 'YMN9Qj5jPNp7j14VPcML1B6xGgcPWVZUGLFU3Mnyfaf';

function validInput(): PaymentPlanInput {
  return {
    asset: { kind: 'woke' },
    grossAmount: '101',
    allowedAssets: [{ kind: 'woke' }],
    protocolFee: { basisPoints: 250, destination: feeDestination },
    recipientSplits: [
      { recipient: identityB, destination: destinationB, basisPoints: 5_000 },
      { recipient: identityA, destination: destinationA, basisPoints: 5_000 },
    ],
  };
}

describe('payment planning', () => {
  it('conserves integer base units with deterministic largest-remainder rounding', () => {
    const plan = calculatePaymentPlan(validInput());

    expect(plan).toMatchObject({
      grossAmount: '101',
      protocolFeeAmount: '2',
      distributableAmount: '99',
      roundingPolicy: 'largest-remainder-recipient-id',
    });
    expect(plan.transfers).toEqual([
      {
        kind: 'protocol-fee',
        asset: { kind: 'woke' },
        destination: feeDestination,
        amount: '2',
        basisPoints: 250,
      },
      {
        kind: 'recipient',
        asset: { kind: 'woke' },
        destination: destinationA,
        amount: '50',
        recipient: identityA,
        basisPoints: 5_000,
      },
      {
        kind: 'recipient',
        asset: { kind: 'woke' },
        destination: destinationB,
        amount: '49',
        recipient: identityB,
        basisPoints: 5_000,
      },
    ]);
  });

  it('is independent of recipient input order', () => {
    const first = validInput();
    const second = {
      ...first,
      recipientSplits: [...first.recipientSplits].reverse(),
    };

    expect(calculatePaymentPlan(second)).toEqual(calculatePaymentPlan(first));
  });

  it('rejects unsupported SPL mint metadata and unsigned-64 overflow', () => {
    const splInput: PaymentPlanInput = {
      ...validInput(),
      asset: {
        kind: 'spl',
        mint: destinationA,
        decimals: 6,
        tokenProgram: 'spl-token',
      },
      allowedAssets: [
        {
          kind: 'spl',
          mint: destinationA,
          decimals: 9,
          tokenProgram: 'spl-token',
        },
      ],
    };

    expect(() => calculatePaymentPlan(splInput)).toThrowError(
      expect.objectContaining({ code: 'unsupported-asset' }),
    );
    expect(() =>
      calculatePaymentPlan({
        ...validInput(),
        grossAmount: '18446744073709551616',
      }),
    ).toThrowError(expect.objectContaining({ code: 'amount-out-of-range' }));
  });

  it('rejects malformed splits, duplicate destinations, and zero-unit recipients', () => {
    expect(() =>
      calculatePaymentPlan({
        ...validInput(),
        recipientSplits: [
          { recipient: identityA, destination: destinationA, basisPoints: 4_999 },
          { recipient: identityB, destination: destinationB, basisPoints: 5_000 },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-recipient' }));

    expect(() =>
      calculatePaymentPlan({
        ...validInput(),
        recipientSplits: [
          { recipient: identityA, destination: destinationA, basisPoints: 5_000 },
          { recipient: identityB, destination: destinationA, basisPoints: 5_000 },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'duplicate-destination' }));

    expect(() =>
      calculatePaymentPlan({
        ...validInput(),
        grossAmount: '1',
        protocolFee: { basisPoints: 0, destination: feeDestination },
      }),
    ).toThrowError(expect.objectContaining({ code: 'rounding-underflow' }));
  });

  it('accepts only an exact simulated transfer set', () => {
    const plan = calculatePaymentPlan(validInput());
    const observed: ObservedTransfer[] = plan.transfers.map((transfer) => ({
      asset: transfer.asset,
      destination: transfer.destination,
      amount: transfer.amount,
    }));

    expect(() => assertPaymentSimulationMatches(plan, observed.reverse())).not.toThrow();

    const firstObserved = observed[0];
    if (firstObserved === undefined) {
      throw new Error('expected at least one planned transfer');
    }
    observed[0] = { ...firstObserved, destination: feeDestination };
    expect(() => assertPaymentSimulationMatches(plan, observed)).toThrowError(
      expect.objectContaining({ code: 'simulation-mismatch' }),
    );
  });

  it('does not collapse a second unexpected transfer into the approved plan', () => {
    const plan = calculatePaymentPlan(validInput());
    const observed: ObservedTransfer[] = plan.transfers.map((transfer) => ({
      asset: transfer.asset,
      destination: transfer.destination,
      amount: transfer.amount,
    }));
    observed.push({ asset: { kind: 'woke' }, destination: destinationA, amount: '1' });

    try {
      assertPaymentSimulationMatches(plan, observed);
      throw new Error('expected simulation mismatch');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentPlanError);
      expect((error as PaymentPlanError).code).toBe('simulation-mismatch');
    }
  });
});

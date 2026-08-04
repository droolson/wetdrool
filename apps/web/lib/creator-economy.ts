/**
 * Decentralized creator (OnlyFans-class) offering model.
 * Settlement stays staged until $DROOL mint + recipient + entitlement proofs exist.
 */

import { DROOL_SYMBOL, getDroolTokenConfig } from './drool-token';
import { VANITY_MONTHLY_USD } from './points';

export type OfferingKind = 'subscription' | 'ppv' | 'tip_jar' | 'live_ticket';

export interface CreatorOffering {
  readonly id: string;
  readonly kind: OfferingKind;
  readonly title: string;
  readonly priceUsd: number;
  readonly pricePoints: number;
  readonly acceptsDrool: boolean;
  readonly e2eeDelivery: boolean;
  readonly status: 'staged' | 'live';
  readonly detail: string;
}

export interface CreatorStudioProfile {
  readonly handle: string;
  readonly displayName: string;
  readonly pronouns: string;
  readonly bio: string;
  readonly tags: readonly string[];
  readonly offerings: readonly CreatorOffering[];
  readonly e2eeDms: true;
  readonly jurisdictionNote: string;
}

const POINTS_PER_USD = 100;

export function usdToPoints(usd: number): number {
  return Math.ceil(usd * POINTS_PER_USD);
}

/** Founder preview studio — owner-approved public copy only. */
export function getFounderStudio(): CreatorStudioProfile {
  const token = getDroolTokenConfig();
  return {
    handle: 'kingofqueens6ix',
    displayName: 'Alex Droolhouse',
    pronouns: 'it/its',
    bio: '24M · freak · founder preview. Decentralized creator surface — no fake checkout.',
    tags: ['femboy', 'queer', 'creator', 'web3'],
    e2eeDms: true,
    jurisdictionNote:
      'Operator vehicle: Swiss foundation (planned). Private E2EE delivery for paid objects when messaging mesh is wired. Not a claim that local criminal law does not apply.',
    offerings: [
      {
        id: 'sub-monthly',
        kind: 'subscription',
        title: 'Monthly access',
        priceUsd: 9.99,
        pricePoints: usdToPoints(9.99),
        acceptsDrool: token.status === 'live',
        e2eeDelivery: true,
        status: 'staged',
        detail: 'Subscriber feed + DM priority. Checkout staged until mint + recipient verified.',
      },
      {
        id: 'ppv-drop',
        kind: 'ppv',
        title: 'Encrypted drop',
        priceUsd: 14.99,
        pricePoints: usdToPoints(14.99),
        acceptsDrool: token.status === 'live',
        e2eeDelivery: true,
        status: 'staged',
        detail: 'Pay-per-view ciphertext unlock on authorized devices only.',
      },
      {
        id: 'tip-jar',
        kind: 'tip_jar',
        title: 'Tip jar',
        priceUsd: 5,
        pricePoints: usdToPoints(5),
        acceptsDrool: token.status === 'live',
        e2eeDelivery: false,
        status: 'staged',
        detail: `Tips in SOL/USDC/${DROOL_SYMBOL} when rails are live. Points tips subject to ad-revenue cap.`,
      },
      {
        id: 'live-ticket',
        kind: 'live_ticket',
        title: 'Live room ticket',
        priceUsd: 4.99,
        pricePoints: usdToPoints(4.99),
        acceptsDrool: token.status === 'live',
        e2eeDelivery: false,
        status: 'staged',
        detail: '18+ livestream access pass. Chat is moderated; private gifts stay client-encrypted when wired.',
      },
    ],
  };
}

export function proModeQuote(): { readonly monthlyUsd: number; readonly points: number; readonly perks: readonly string[] } {
  return {
    monthlyUsd: VANITY_MONTHLY_USD,
    points: usdToPoints(VANITY_MONTHLY_USD),
    perks: [
      'No ads in shorts + home',
      'Pride / Straight / All discovery modes unlocked cosmetics',
      'name.drool vanity rail when registry is live',
      'Higher live tip visibility',
    ],
  };
}

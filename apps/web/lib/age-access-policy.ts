/**
 * Age-access policy for WetDrool (18+).
 *
 * Product stance:
 * - Default access proof is **self-attestation** (18+), not government ID upload.
 * - Operator formation target: Swiss foundation (Droolhouse / WetDrool operator vehicle).
 * - Incorporation jurisdiction is **not** a magic shield: CSAM, NCII, trafficking, and
 *   other criminal prohibitions still apply; local consumer-access rules may also apply
 *   to users where they sit.
 * - This module never claims “no laws,” never collects government ID by default, and
 *   never treats a wallet signature as age proof.
 */

export const AGE_ACCESS_POLICY_VERSION = 1 as const;

/** How the user proves adulthood for NSFW surfaces in this client. */
export type AgeProofMethod =
  | 'self_attest_18'
  | 'third_party_age_assurance'
  | 'government_id';

export type AgeAccessOutcome =
  | 'allow_self_attest'
  | 'require_age_assurance'
  | 'block_adult_surface';

export interface OperatorEntity {
  readonly kind: 'swiss_foundation_planned' | 'swiss_foundation' | 'unspecified';
  readonly label: string;
  readonly detail: string;
}

export interface AgeAccessDecision {
  readonly version: typeof AGE_ACCESS_POLICY_VERSION;
  readonly outcome: AgeAccessOutcome;
  readonly defaultProof: AgeProofMethod;
  readonly collectGovernmentId: false;
  readonly walletIsAgeProof: false;
  readonly minimumAge: 18;
  readonly regionHint: string | null;
  readonly reasons: readonly string[];
  readonly operator: OperatorEntity;
}

export const DEFAULT_OPERATOR: OperatorEntity = {
  kind: 'swiss_foundation_planned',
  label: 'Swiss foundation (planned operator vehicle)',
  detail:
    'Operator entity formation targets Switzerland. That is a corporate-seat plan, not a claim that Swiss or foreign criminal law stops applying, and not a license to skip age gates.',
};

/**
 * Regions where the product currently prefers **not** to force government-ID
 * upload in-app (self-attest + private mode remain the default).
 *
 * This list is a **product configuration hint**, not legal advice. Qualified
 * counsel must own the production matrix before any claim of compliance.
 */
export const SELF_ATTEST_PREFERRED_REGIONS = new Set([
  'CH', // Switzerland — planned operator seat
  'XX', // explicit unknown / not disclosed
]);

/**
 * Regions where the client may surface a stronger age-assurance path when an
 * approved provider is configured. Still does **not** upload government ID to
 * WetDrool servers by default — any third-party assurance is separate.
 *
 * Empty until counsel + product sign off on exact US/state (or other) rules.
 * Do not invent state codes as “enforced.”
 */
export const AGE_ASSURANCE_HINT_REGIONS = new Set<string>();

export function normalizeRegionHint(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim().toUpperCase();
  if (trimmed === '' || trimmed.length > 8) return null;
  if (!/^[A-Z]{2}(-[A-Z0-9]{1,5})?$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Resolve access policy for adult surfaces.
 *
 * @param regionHint Optional ISO-ish region the user or CDN provides. Never
 *   inferred from content taste, pronouns, or wallet.
 */
export function resolveAgeAccessPolicy(options?: {
  readonly regionHint?: string | null;
  readonly operator?: OperatorEntity;
}): AgeAccessDecision {
  const regionHint = normalizeRegionHint(options?.regionHint ?? null);
  const operator = options?.operator ?? DEFAULT_OPERATOR;
  const reasons: string[] = [
    'Minimum age is 18 for NSFW and adult publishing surfaces.',
    'Default proof is local self-attestation; WetDrool does not request government ID images or numbers by default.',
    'A Solana wallet proves key control only — never age, identity, or consent.',
  ];

  if (regionHint !== null) {
    reasons.push(`Region hint present: ${regionHint} (configuration only; not a geo-block engine).`);
  } else {
    reasons.push('No region hint; default privacy-preserving self-attest path.');
  }

  if (regionHint !== null && AGE_ASSURANCE_HINT_REGIONS.has(regionHint)) {
    reasons.push(
      'This region is on the age-assurance hint list: when a reviewed provider is wired, offer optional third-party assurance without storing government ID at WetDrool.',
    );
    return {
      version: AGE_ACCESS_POLICY_VERSION,
      outcome: 'require_age_assurance',
      defaultProof: 'third_party_age_assurance',
      collectGovernmentId: false,
      walletIsAgeProof: false,
      minimumAge: 18,
      regionHint,
      reasons,
      operator,
    };
  }

  reasons.push(
    'No government-ID collection path is enabled. Rebellious privacy is self-attest + private tech — not “no laws.” Illegal content remains banned everywhere.',
  );

  return {
    version: AGE_ACCESS_POLICY_VERSION,
    outcome: 'allow_self_attest',
    defaultProof: 'self_attest_18',
    collectGovernmentId: false,
    walletIsAgeProof: false,
    minimumAge: 18,
    regionHint,
    reasons,
    operator,
  };
}

/** Machine-readable policy snapshot for settings / well-known style UI. */
export function ageAccessPolicySnapshot(
  regionHint?: string | null,
): Readonly<AgeAccessDecision> {
  return resolveAgeAccessPolicy({ regionHint });
}

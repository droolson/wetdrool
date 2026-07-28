//! Protocol constants shared by account constraints and validation.

/// Protocol account schema version.
pub const ACCOUNT_VERSION: u8 = 1;
/// Public protocol version stored in the configuration account.
pub const PROTOCOL_VERSION: u16 = 1;

/// All v1 protocol PDAs begin with `b"sw"` and `[1]`.
pub const PDA_PREFIX: &[u8] = b"sw";
/// A separate byte seed prevents future account-version collisions.
pub const PDA_VERSION: &[u8] = &[ACCOUNT_VERSION];

pub const CONFIG_SEED: &[u8] = b"config";
pub const IDENTITY_SEED: &[u8] = b"identity";
pub const HANDLE_SEED: &[u8] = b"handle";
pub const POST_SEED: &[u8] = b"post";
pub const FOLLOW_SEED: &[u8] = b"follow";
pub const TOMBSTONE_SEED: &[u8] = b"tombstone";
pub const DELEGATION_SEED: &[u8] = b"delegation";
pub const BLOCK_SEED: &[u8] = b"block";
pub const COMMUNITY_SEED: &[u8] = b"community";
pub const MEMBERSHIP_SEED: &[u8] = b"membership";
pub const REACTION_SEED: &[u8] = b"reaction";
pub const PROPOSAL_SEED: &[u8] = b"proposal";
pub const VOTE_SEED: &[u8] = b"vote";
pub const RECOVERY_POLICY_SEED: &[u8] = b"recovery_policy";
pub const RECOVERY_REQUEST_SEED: &[u8] = b"recovery_request";
pub const PAYMENT_CONFIG_SEED: &[u8] = b"payment_config";
pub const SUBSCRIPTION_OFFERING_SEED: &[u8] = b"subscription_offering";
pub const PAYMENT_RECEIPT_SEED: &[u8] = b"payment_receipt";
pub const SUBSCRIPTION_ENTITLEMENT_SEED: &[u8] = b"subscription_entitlement";

/// Nonces are fixed-width so every seed is bounded and language independent.
pub const NONCE_BYTES: usize = 16;
/// SHA-256 manifest digests are always exactly 32 bytes.
pub const MANIFEST_HASH_BYTES: usize = 32;
/// Storage pointers are compact location hints, not post bodies.
pub const MAX_MANIFEST_URI_BYTES: usize = 200;
/// Handles are compact, normalized ASCII identifiers rather than display names.
pub const MIN_HANDLE_BYTES: usize = 3;
pub const MAX_HANDLE_BYTES: usize = 30;

/// Delegation scopes are deliberately small and closed for v1.
pub const SCOPE_PROFILE: u16 = 1 << 0;
pub const SCOPE_POST: u16 = 1 << 1;
pub const SCOPE_SOCIAL: u16 = 1 << 2;
pub const SCOPE_COMMUNITY: u16 = 1 << 3;
pub const VALID_DELEGATION_SCOPES: u16 =
    SCOPE_PROFILE | SCOPE_POST | SCOPE_SOCIAL | SCOPE_COMMUNITY;

/// Community roles are scoped capabilities, not display labels.
pub const COMMUNITY_ROLE_MEMBER: u16 = 1 << 0;
pub const COMMUNITY_ROLE_MODERATOR: u16 = 1 << 1;
pub const COMMUNITY_ROLE_ADMIN: u16 = 1 << 2;
pub const VALID_COMMUNITY_ROLES: u16 =
    COMMUNITY_ROLE_MEMBER | COMMUNITY_ROLE_MODERATOR | COMMUNITY_ROLE_ADMIN;

/// The only executable governance strategy in v1. The digest is SHA-256 over:
/// `socially-woke:governance:one-active-member-one-vote:v1;quorum-bps=5000;approval-bps=5001;abstain=quorum-only`.
pub const ONE_ACTIVE_MEMBER_ONE_VOTE_STRATEGY_HASH: [u8; MANIFEST_HASH_BYTES] = [
    194, 111, 47, 125, 12, 76, 238, 214, 100, 126, 189, 3, 102, 193, 39, 21, 92, 90, 225, 152, 44,
    32, 248, 60, 14, 192, 167, 251, 22, 215, 252, 112,
];
pub const GOVERNANCE_QUORUM_BPS: u16 = 5_000;
pub const GOVERNANCE_APPROVAL_BPS: u16 = 5_001;
pub const BASIS_POINTS_DENOMINATOR: u128 = 10_000;
pub const MIN_GOVERNANCE_VOTING_SLOTS: u64 = 2;
pub const MAX_GOVERNANCE_VOTING_SLOTS: u64 = 1_000_000;
pub const MAX_GOVERNANCE_START_DELAY_SLOTS: u64 = 100_000;

pub const MIN_RECOVERY_GUARDIANS: usize = 2;
pub const MAX_RECOVERY_GUARDIANS: usize = 5;
pub const MIN_RECOVERY_DELAY_SLOTS: u64 = 2;
pub const MAX_RECOVERY_DELAY_SLOTS: u64 = 1_000_000;

/// Phase 9 deliberately begins with a narrow native-WOKE payment surface.
/// Wider split sets remain available in portable manifests, but the onchain
/// subset stays within the legacy-transaction and compute budgets.
pub const MAX_ONCHAIN_PAYMENT_SPLITS: usize = 3;
pub const MAX_PROTOCOL_FEE_BPS: u16 = 1_000;
pub const WEEK_SECONDS: i64 = 604_800;
pub const MAX_SUBSCRIPTION_PREPAY_WEEKS: i64 = 52;

/// v1 reactions use a compact, stable code in PDA derivation.
pub const REACTION_LIKE: u8 = 1;
pub const REACTION_CELEBRATE: u8 = 2;
pub const REACTION_INSIGHTFUL: u8 = 3;
pub const REACTION_SUPPORT: u8 = 4;

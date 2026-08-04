//! Protocol constants shared by account constraints and validation.

/// Protocol account schema version.
pub const ACCOUNT_VERSION: u8 = 1;
/// Public protocol version stored in the configuration account.
pub const PROTOCOL_VERSION: u16 = 1;
/// The only profile manifest schema accepted by new onchain references.
pub const CURRENT_PROFILE_SCHEMA_VERSION: u16 = 2;

/// All v1 protocol PDAs begin with `b"wetdrool"` and `[1]`.
pub const PDA_PREFIX: &[u8] = b"wetdrool";
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
/// Registration names occupy a dedicated prefix that custom claims must not use.
pub const RANDOM_HANDLE_PREFIX: &str = "anon_";
/// Cross-client domain separator for anonymous registration-name derivation.
pub const RANDOM_HANDLE_DERIVATION_DOMAIN: &[u8] = b"wetdrool:woke-name:random:v1\0";
/// Ten digest bytes produce the frozen 80-bit anonymous suffix.
pub const RANDOM_HANDLE_DIGEST_BYTES: usize = 10;

/// Delegation scopes are deliberately small and closed for v1.
pub const SCOPE_PROFILE: u16 = 1 << 0;
pub const SCOPE_POST: u16 = 1 << 1;
pub const SCOPE_SOCIAL: u16 = 1 << 2;
pub const SCOPE_COMMUNITY: u16 = 1 << 3;
pub const VALID_DELEGATION_SCOPES: u16 =
    SCOPE_PROFILE | SCOPE_POST | SCOPE_SOCIAL | SCOPE_COMMUNITY;

/// Membership v2 has one exact active role. Moderation authority is granted
/// separately through a revocable `SCOPE_COMMUNITY` identity delegation.
pub const COMMUNITY_ROLE_MEMBER: u16 = 1 << 0;

/// The only executable governance strategy in v1. The digest is SHA-256 over
/// the UTF-8 domain `droolnet:community-governance-strategy:v1`, a NUL byte,
/// and the RFC 8785 canonical JSON strategy descriptor:
/// `{"abstainTreatment":"quorum-only","approvalBasisPoints":5001,"execution":"outcome-record-only","model":"one-active-member-one-vote","quorumBasisPoints":5000,"version":1}`.
pub const ONE_ACTIVE_MEMBER_ONE_VOTE_STRATEGY_HASH: [u8; MANIFEST_HASH_BYTES] = [
    157, 228, 91, 3, 18, 196, 74, 120, 218, 76, 61, 70, 178, 130, 168, 136, 138, 236, 102, 13, 66,
    36, 42, 13, 118, 19, 131, 75, 148, 53, 117, 113,
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

/// The pre-Solana-pivot payment ABI transfers System Program lamports while
/// describing them as WOKE. It must never execute or be re-enabled: lamports
/// are SOL, and a future WOKE asset requires an explicit SPL/Token-2022 mint
/// plus a new instruction ABI.
pub const LEGACY_LAMPORT_PAYMENT_ABI_ENABLED: bool = false;

/// Wider split sets remain available in portable manifests, but any future
/// onchain settlement subset must stay within transaction and compute budgets.
pub const MAX_ONCHAIN_PAYMENT_SPLITS: usize = 3;
pub const MAX_PROTOCOL_FEE_BPS: u16 = 1_000;
pub const WEEK_SECONDS: i64 = 604_800;
pub const MAX_SUBSCRIPTION_PREPAY_WEEKS: i64 = 52;

/// v1 reactions use a compact, stable code in PDA derivation.
pub const REACTION_LIKE: u8 = 1;
pub const REACTION_CELEBRATE: u8 = 2;
pub const REACTION_INSIGHTFUL: u8 = 3;
pub const REACTION_SUPPORT: u8 = 4;

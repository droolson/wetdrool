use anchor_lang::prelude::*;

use crate::constants::{
    MANIFEST_HASH_BYTES, MAX_HANDLE_BYTES, MAX_MANIFEST_URI_BYTES, NONCE_BYTES,
};

#[account]
pub struct ProtocolConfig {
    pub version: u16,
    pub initialized_at_slot: u64,
    pub identity_count: u64,
    pub post_count: u64,
    pub follow_edge_count: u64,
    pub tombstone_count: u64,
    pub delegation_count: u64,
    pub block_edge_count: u64,
    pub community_count: u64,
    pub membership_count: u64,
    pub reaction_reference_count: u64,
    pub bump: u8,
}

impl ProtocolConfig {
    pub const SPACE: usize = 8 + 2 + (10 * 8) + 1;
}

#[account]
pub struct Identity {
    pub version: u8,
    pub config: Pubkey,
    pub identity_nonce: [u8; NONCE_BYTES],
    pub origin_authority: Pubkey,
    pub root_authority: Pubkey,
    pub root_rotation_count: u64,
    pub delegation_sequence: u64,
    pub sequence: u64,
    pub profile_sequence: u64,
    pub profile_manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub profile_manifest_uri: String,
    pub created_at_slot: u64,
    pub profile_updated_at_slot: u64,
    pub active: bool,
    pub bump: u8,
}

impl Identity {
    pub const SPACE: usize = 8
        + 1
        + 32
        + NONCE_BYTES
        + 32
        + 32
        + 8
        + 8
        + 8
        + 8
        + MANIFEST_HASH_BYTES
        + 4
        + MAX_MANIFEST_URI_BYTES
        + 8
        + 8
        + 1
        + 1;
}

#[account]
pub struct HandleClaim {
    pub version: u8,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub handle_hash: [u8; MANIFEST_HASH_BYTES],
    pub handle: String,
    pub identity_sequence: u64,
    pub claimed_at_slot: u64,
    pub bump: u8,
}

impl HandleClaim {
    pub const SPACE: usize =
        8 + 1 + 32 + 32 + MANIFEST_HASH_BYTES + 4 + MAX_HANDLE_BYTES + 8 + 8 + 1;
}

#[account]
pub struct PostReference {
    pub version: u8,
    pub config: Pubkey,
    pub author_identity: Pubkey,
    pub post_nonce: [u8; NONCE_BYTES],
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub author_sequence: u64,
    pub created_at_slot: u64,
    pub tombstoned_at_slot: Option<u64>,
    pub bump: u8,
}

impl PostReference {
    pub const SPACE: usize = 8
        + 1
        + 32
        + 32
        + NONCE_BYTES
        + MANIFEST_HASH_BYTES
        + 4
        + MAX_MANIFEST_URI_BYTES
        + 8
        + 8
        + 1
        + 8
        + 1;
}

#[account]
pub struct FollowEdge {
    pub version: u8,
    pub config: Pubkey,
    pub follower_identity: Pubkey,
    pub subject_identity: Pubkey,
    pub state_sequence: u64,
    pub follower_sequence: u64,
    pub created_at_slot: u64,
    pub updated_at_slot: u64,
    pub active: bool,
    pub bump: u8,
}

impl FollowEdge {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum TombstoneReason {
    UserRequest,
    Safety,
    Other,
}

#[account]
pub struct Tombstone {
    pub version: u8,
    pub config: Pubkey,
    pub author_identity: Pubkey,
    pub target_post: Pubkey,
    pub target_hash: [u8; MANIFEST_HASH_BYTES],
    pub author_sequence: u64,
    pub created_at_slot: u64,
    pub reason: TombstoneReason,
    pub bump: u8,
}

impl Tombstone {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 32 + MANIFEST_HASH_BYTES + 8 + 8 + 1 + 1;
}

#[account]
pub struct Delegation {
    pub version: u8,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub delegate_authority: Pubkey,
    pub delegation_sequence: u64,
    pub scopes: u16,
    pub issued_by_root_authority: Pubkey,
    pub issued_at_root_rotation_count: u64,
    pub issued_at_slot: u64,
    pub expires_at_slot: u64,
    pub revoked_at_slot: Option<u64>,
    pub state_sequence: u64,
    pub active: bool,
    pub bump: u8,
}

impl Delegation {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 32 + 8 + 2 + 32 + 8 + 8 + 8 + 1 + 8 + 8 + 1 + 1;
}

#[account]
pub struct BlockEdge {
    pub version: u8,
    pub config: Pubkey,
    pub blocker_identity: Pubkey,
    pub subject_identity: Pubkey,
    pub state_sequence: u64,
    pub blocker_sequence: u64,
    pub created_at_slot: u64,
    pub updated_at_slot: u64,
    pub active: bool,
    pub bump: u8,
}

impl BlockEdge {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[account]
pub struct Community {
    pub version: u8,
    pub config: Pubkey,
    pub creator_identity: Pubkey,
    pub community_nonce: [u8; NONCE_BYTES],
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub governance_version: u16,
    pub governance_strategy_hash: [u8; MANIFEST_HASH_BYTES],
    pub visibility: CommunityVisibility,
    pub membership_policy: CommunityMembershipPolicy,
    pub membership_policy_sequence: u64,
    pub membership_sequence: u64,
    pub creator_sequence: u64,
    pub member_count: u64,
    pub created_at_slot: u64,
    pub updated_at_slot: u64,
    pub bump: u8,
}

impl Community {
    pub const SPACE: usize = 8
        + 1
        + 32
        + 32
        + NONCE_BYTES
        + MANIFEST_HASH_BYTES
        + 4
        + MAX_MANIFEST_URI_BYTES
        + 2
        + MANIFEST_HASH_BYTES
        + 1
        + 1
        + 8
        + 8
        + 8
        + 8
        + 8
        + 8
        + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommunityVisibility {
    Public,
    Unlisted,
    Private,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommunityMembershipPolicy {
    Open,
    ApprovalRequired,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommunityMembershipAction {
    Join,
    Leave,
    Remove,
    Ban,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommunityMembershipState {
    Active,
    Left,
    Removed,
    Banned,
}

#[account]
pub struct CommunityMembership {
    pub version: u8,
    pub config: Pubkey,
    pub community: Pubkey,
    pub member_identity: Pubkey,
    pub acted_by_identity: Pubkey,
    pub action: CommunityMembershipAction,
    pub state: CommunityMembershipState,
    pub roles: u16,
    pub state_sequence: u64,
    pub member_action_sequence: u64,
    pub actor_sequence: u64,
    pub active_since_membership_sequence: u64,
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub created_at_slot: u64,
    pub updated_at_slot: u64,
    pub bump: u8,
}

impl CommunityMembership {
    pub const SPACE: usize = 8
        + 1
        + 32
        + 32
        + 32
        + 32
        + 1
        + 1
        + 2
        + 8
        + 8
        + 8
        + 8
        + MANIFEST_HASH_BYTES
        + 4
        + MAX_MANIFEST_URI_BYTES
        + 8
        + 8
        + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum GovernanceVotingModel {
    OneActiveMemberOneVote,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum GovernanceVoteChoice {
    Yes,
    No,
    Abstain,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum GovernanceProposalOutcome {
    Pending,
    Accepted,
    Rejected,
}

#[account]
pub struct GovernanceProposal {
    pub version: u8,
    pub config: Pubkey,
    pub community: Pubkey,
    pub proposer_identity: Pubkey,
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub governance_version: u16,
    pub governance_strategy_hash: [u8; MANIFEST_HASH_BYTES],
    pub voting_model: GovernanceVotingModel,
    pub eligible_member_count: u64,
    pub community_membership_sequence: u64,
    pub opens_at_slot: u64,
    pub closes_at_slot: u64,
    pub quorum_bps: u16,
    pub approval_bps: u16,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub abstain_votes: u64,
    pub created_at_slot: u64,
    pub proposer_sequence: u64,
    pub state_sequence: u64,
    pub outcome: GovernanceProposalOutcome,
    pub finalized_at_slot: Option<u64>,
    pub bump: u8,
}

impl GovernanceProposal {
    pub const SPACE: usize = 8
        + 1
        + 32
        + 32
        + 32
        + MANIFEST_HASH_BYTES
        + 4
        + MAX_MANIFEST_URI_BYTES
        + 2
        + MANIFEST_HASH_BYTES
        + 1
        + 8
        + 8
        + 8
        + 8
        + 2
        + 2
        + 8
        + 8
        + 8
        + 8
        + 8
        + 8
        + 1
        + 1
        + 8
        + 1;
}

#[account]
pub struct GovernanceVote {
    pub version: u8,
    pub config: Pubkey,
    pub community: Pubkey,
    pub proposal: Pubkey,
    pub voter_identity: Pubkey,
    pub membership: Pubkey,
    pub choice: GovernanceVoteChoice,
    pub voter_sequence: u64,
    pub membership_state_sequence: u64,
    pub cast_at_slot: u64,
    pub bump: u8,
}

impl GovernanceVote {
    pub const SPACE: usize = 8 + 1 + (5 * 32) + 1 + 8 + 8 + 8 + 1;
}

#[account]
pub struct ReactionReference {
    pub version: u8,
    pub config: Pubkey,
    pub reactor_identity: Pubkey,
    pub target_post: Pubkey,
    pub reaction_kind: u8,
    pub state_sequence: u64,
    pub reactor_sequence: u64,
    pub created_at_slot: u64,
    pub updated_at_slot: u64,
    pub active: bool,
    pub bump: u8,
}

impl ReactionReference {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[account]
pub struct RecoveryPolicy {
    pub version: u8,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub policy_sequence: u64,
    pub guardians: Vec<Pubkey>,
    pub threshold: u8,
    pub delay_slots: u64,
    pub updated_at_slot: u64,
    pub active: bool,
    pub bump: u8,
}

impl RecoveryPolicy {
    pub const SPACE: usize = 8
        + 1
        + 32
        + 32
        + 8
        + 4
        + (crate::constants::MAX_RECOVERY_GUARDIANS * 32)
        + 1
        + 8
        + 8
        + 1
        + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoveryRequestState {
    Pending,
    Cancelled,
    Executed,
}

#[account]
pub struct RecoveryRequest {
    pub version: u8,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub recovery_policy: Pubkey,
    pub request_nonce: [u8; NONCE_BYTES],
    pub policy_sequence: u64,
    pub current_root_authority: Pubkey,
    pub identity_sequence: u64,
    pub root_rotation_count: u64,
    pub target_root_authority: Pubkey,
    pub requesting_guardian: Pubkey,
    pub threshold: u8,
    pub guardian_count: u8,
    pub approvals_mask: u8,
    pub approval_count: u8,
    pub requested_at_slot: u64,
    pub execute_after_slot: u64,
    pub state: RecoveryRequestState,
    pub terminal_at_slot: Option<u64>,
    pub bump: u8,
}

impl RecoveryRequest {
    pub const SPACE: usize = 8 + 1 + (6 * 32) + NONCE_BYTES + (5 * 8) + 4 + 1 + 1 + 8 + 1;
}

#[account]
pub struct PaymentConfig {
    pub version: u8,
    pub config: Pubkey,
    pub authority: Pubkey,
    pub fee_destination: Pubkey,
    pub fee_bps: u16,
    pub policy_sequence: u64,
    pub initialized_at_slot: u64,
    pub updated_at_slot: u64,
    pub enabled: bool,
    pub bump: u8,
}

impl PaymentConfig {
    pub const SPACE: usize = 8 + 1 + (3 * 32) + 2 + (3 * 8) + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PaymentSplit {
    pub recipient_identity: Pubkey,
    pub destination: Pubkey,
    pub basis_points: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubscriptionInterval {
    Week,
}

#[account]
pub struct CreatorSubscriptionOffering {
    pub version: u8,
    pub config: Pubkey,
    pub creator_identity: Pubkey,
    pub offering_nonce: [u8; NONCE_BYTES],
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub price_lamports: u64,
    pub billing_interval: SubscriptionInterval,
    pub recipient_splits: Vec<PaymentSplit>,
    pub refund_policy_hash: [u8; MANIFEST_HASH_BYTES],
    pub max_protocol_fee_bps: u16,
    pub creator_root_rotation_count: u64,
    pub creator_sequence: u64,
    pub state_sequence: u64,
    pub created_at_slot: u64,
    pub updated_at_slot: u64,
    pub active: bool,
    pub retired_at_slot: Option<u64>,
    pub creator_split_index: u8,
    pub bump: u8,
}

impl CreatorSubscriptionOffering {
    pub const SPACE: usize = 8
        + 1
        + 32
        + 32
        + NONCE_BYTES
        + MANIFEST_HASH_BYTES
        + 4
        + MAX_MANIFEST_URI_BYTES
        + 8
        + 1
        + 4
        + (crate::constants::MAX_ONCHAIN_PAYMENT_SPLITS * (32 + 32 + 2))
        + MANIFEST_HASH_BYTES
        + 2
        + 8
        + 8
        + 8
        + 8
        + 8
        + 1
        + 1
        + 8
        + 1
        + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaymentKind {
    WokeTip,
    WeeklySubscription,
}

#[account]
pub struct PaymentReceipt {
    pub version: u8,
    pub config: Pubkey,
    pub payment_config: Pubkey,
    pub terms_reference: Pubkey,
    pub payer_identity: Pubkey,
    pub payer_authority: Pubkey,
    pub subject_identity: Pubkey,
    pub primary_recipient_destination: Pubkey,
    pub fee_destination: Pubkey,
    pub receipt_nonce: [u8; NONCE_BYTES],
    pub kind: PaymentKind,
    pub payment_policy_sequence: u64,
    pub terms_state_sequence: u64,
    pub terms_manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub payer_root_rotation_count: u64,
    pub gross_lamports: u64,
    pub fee_bps: u16,
    pub fee_lamports: u64,
    pub distributable_lamports: u64,
    pub recipient_amounts: Vec<u64>,
    pub refund_policy_hash: [u8; MANIFEST_HASH_BYTES],
    pub entitlement_from_timestamp: i64,
    pub entitlement_until_timestamp: i64,
    pub paid_at_timestamp: i64,
    pub paid_at_slot: u64,
    pub bump: u8,
}

impl PaymentReceipt {
    pub const SPACE: usize = 8
        + 1
        + (8 * 32)
        + NONCE_BYTES
        + 1
        + 8
        + 8
        + MANIFEST_HASH_BYTES
        + 8
        + 8
        + 2
        + 8
        + 8
        + 4
        + (crate::constants::MAX_ONCHAIN_PAYMENT_SPLITS * 8)
        + MANIFEST_HASH_BYTES
        + (3 * 8)
        + 8
        + 1;
}

#[account]
pub struct SubscriptionEntitlement {
    pub version: u8,
    pub config: Pubkey,
    pub offering: Pubkey,
    pub beneficiary_identity: Pubkey,
    pub started_at_timestamp: i64,
    pub valid_until_timestamp: i64,
    pub settlement_count: u64,
    pub last_receipt: Pubkey,
    pub state_sequence: u64,
    pub last_settled_at_slot: u64,
    pub refund_policy_hash: [u8; MANIFEST_HASH_BYTES],
    pub bump: u8,
}

impl SubscriptionEntitlement {
    pub const SPACE: usize = 8 + 1 + (3 * 32) + (2 * 8) + 8 + 32 + 8 + 8 + MANIFEST_HASH_BYTES + 1;
}

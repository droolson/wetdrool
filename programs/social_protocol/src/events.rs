use anchor_lang::prelude::*;

use crate::{
    constants::{MANIFEST_HASH_BYTES, NONCE_BYTES},
    state::{
        GovernanceProposalOutcome, GovernanceVoteChoice, GovernanceVotingModel, PaymentKind,
        PaymentSplit, SubscriptionInterval, TombstoneReason,
    },
};

#[event]
pub struct ProtocolInitialized {
    pub event_version: u16,
    pub config: Pubkey,
    pub initialized_at_slot: u64,
}

#[event]
pub struct IdentityCreated {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub root_authority: Pubkey,
    pub identity_nonce: [u8; NONCE_BYTES],
    pub created_at_slot: u64,
}

#[event]
pub struct IdentityDeactivated {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub root_authority: Pubkey,
    pub identity_sequence: u64,
    pub deactivated_at_slot: u64,
}

#[event]
pub struct HandleClaimed {
    pub event_version: u16,
    pub config: Pubkey,
    pub handle_claim: Pubkey,
    pub identity: Pubkey,
    pub authority: Pubkey,
    pub identity_sequence: u64,
    pub handle_hash: [u8; MANIFEST_HASH_BYTES],
    pub handle: String,
    pub claimed_at_slot: u64,
}

#[event]
pub struct HandleReleased {
    pub event_version: u16,
    pub config: Pubkey,
    pub handle_claim: Pubkey,
    pub identity: Pubkey,
    pub authority: Pubkey,
    pub identity_sequence: u64,
    pub handle_hash: [u8; MANIFEST_HASH_BYTES],
    pub handle: String,
    pub released_at_slot: u64,
}

#[event]
pub struct ProfileReferenceUpdated {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub authority: Pubkey,
    pub sequence: u64,
    pub previous_manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub updated_at_slot: u64,
    pub profile_schema_version: u16,
}

#[event]
pub struct PostReferencePublished {
    pub event_version: u16,
    pub config: Pubkey,
    pub post_reference: Pubkey,
    pub author_identity: Pubkey,
    pub authority: Pubkey,
    pub post_nonce: [u8; NONCE_BYTES],
    pub author_sequence: u64,
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub created_at_slot: u64,
}

#[event]
pub struct FollowStateChanged {
    pub event_version: u16,
    pub config: Pubkey,
    pub follow_edge: Pubkey,
    pub follower_identity: Pubkey,
    pub subject_identity: Pubkey,
    pub follower_sequence: u64,
    pub edge_state_sequence: u64,
    pub active: bool,
    pub updated_at_slot: u64,
}

#[event]
pub struct PostTombstoned {
    pub event_version: u16,
    pub config: Pubkey,
    pub tombstone: Pubkey,
    pub target_post: Pubkey,
    pub author_identity: Pubkey,
    pub author_sequence: u64,
    pub target_hash: [u8; MANIFEST_HASH_BYTES],
    pub reason: TombstoneReason,
    pub created_at_slot: u64,
}

#[event]
pub struct RootAuthorityRotated {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub previous_root_authority: Pubkey,
    pub new_root_authority: Pubkey,
    pub identity_sequence: u64,
    pub rotation_count: u64,
    pub rotated_at_slot: u64,
}

#[event]
pub struct DelegationCreated {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub delegation: Pubkey,
    pub delegate_authority: Pubkey,
    pub delegation_sequence: u64,
    pub identity_sequence: u64,
    pub scopes: u16,
    pub issued_at_root_rotation_count: u64,
    pub expires_at_slot: u64,
    pub issued_at_slot: u64,
}

#[event]
pub struct DelegationRevoked {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub delegation: Pubkey,
    pub delegate_authority: Pubkey,
    pub delegation_sequence: u64,
    pub identity_sequence: u64,
    pub delegation_state_sequence: u64,
    pub revoked_at_slot: u64,
}

#[event]
pub struct BlockStateChanged {
    pub event_version: u16,
    pub config: Pubkey,
    pub block_edge: Pubkey,
    pub blocker_identity: Pubkey,
    pub subject_identity: Pubkey,
    pub authority: Pubkey,
    pub blocker_sequence: u64,
    pub edge_state_sequence: u64,
    pub active: bool,
    pub updated_at_slot: u64,
}

#[event]
pub struct CommunityCreated {
    pub event_version: u16,
    pub config: Pubkey,
    pub community: Pubkey,
    pub creator_identity: Pubkey,
    pub authority: Pubkey,
    pub community_nonce: [u8; NONCE_BYTES],
    pub creator_sequence: u64,
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub governance_version: u16,
    pub governance_strategy_hash: [u8; MANIFEST_HASH_BYTES],
    pub created_at_slot: u64,
}

#[event]
pub struct CommunityGovernanceUpdated {
    pub event_version: u16,
    pub config: Pubkey,
    pub community: Pubkey,
    pub creator_identity: Pubkey,
    pub authority: Pubkey,
    pub creator_sequence: u64,
    pub previous_governance_version: u16,
    pub governance_version: u16,
    pub previous_strategy_hash: [u8; MANIFEST_HASH_BYTES],
    pub governance_strategy_hash: [u8; MANIFEST_HASH_BYTES],
    pub updated_at_slot: u64,
}

#[event]
pub struct CommunityMembershipChanged {
    pub event_version: u16,
    pub config: Pubkey,
    pub community: Pubkey,
    pub membership: Pubkey,
    pub member_identity: Pubkey,
    pub assigned_by_identity: Pubkey,
    pub authority: Pubkey,
    pub authority_sequence: u64,
    pub membership_state_sequence: u64,
    pub roles: u16,
    pub active: bool,
    pub updated_at_slot: u64,
}

#[event]
pub struct ReactionStateChanged {
    pub event_version: u16,
    pub config: Pubkey,
    pub reaction_reference: Pubkey,
    pub reactor_identity: Pubkey,
    pub target_post: Pubkey,
    pub authority: Pubkey,
    pub reaction_kind: u8,
    pub reactor_sequence: u64,
    pub reaction_state_sequence: u64,
    pub active: bool,
    pub updated_at_slot: u64,
}

#[event]
pub struct ProposalCreated {
    pub event_version: u16,
    pub config: Pubkey,
    pub community: Pubkey,
    pub proposal: Pubkey,
    pub proposer_identity: Pubkey,
    pub authority: Pubkey,
    pub proposer_sequence: u64,
    pub previous_community_sequence: u64,
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub governance_version: u16,
    pub governance_strategy_hash: [u8; MANIFEST_HASH_BYTES],
    pub voting_model: GovernanceVotingModel,
    pub eligible_member_count: u64,
    pub opens_at_slot: u64,
    pub closes_at_slot: u64,
    pub quorum_bps: u16,
    pub approval_bps: u16,
    pub proposal_state_sequence: u64,
    pub created_at_slot: u64,
}

#[event]
pub struct VoteCast {
    pub event_version: u16,
    pub config: Pubkey,
    pub community: Pubkey,
    pub proposal: Pubkey,
    pub vote: Pubkey,
    pub voter_identity: Pubkey,
    pub membership: Pubkey,
    pub authority: Pubkey,
    pub voter_sequence: u64,
    pub membership_state_sequence: u64,
    pub proposal_state_sequence: u64,
    pub choice: GovernanceVoteChoice,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub abstain_votes: u64,
    pub cast_at_slot: u64,
}

#[event]
pub struct ProposalFinalized {
    pub event_version: u16,
    pub config: Pubkey,
    pub community: Pubkey,
    pub proposal: Pubkey,
    pub finalizer: Pubkey,
    pub proposal_state_sequence: u64,
    pub eligible_member_count: u64,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub abstain_votes: u64,
    pub participating_votes: u64,
    pub decisive_votes: u64,
    pub quorum_bps: u16,
    pub approval_bps: u16,
    pub quorum_met: bool,
    pub approval_met: bool,
    pub outcome: GovernanceProposalOutcome,
    pub finalized_at_slot: u64,
}

#[event]
pub struct RecoveryPolicyConfigured {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub recovery_policy: Pubkey,
    pub root_authority: Pubkey,
    pub policy_sequence: u64,
    pub identity_sequence: u64,
    pub root_rotation_count: u64,
    pub guardians: Vec<Pubkey>,
    pub threshold: u8,
    pub delay_slots: u64,
    pub configured_at_slot: u64,
}

#[event]
pub struct RecoveryPolicyDisabled {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub recovery_policy: Pubkey,
    pub root_authority: Pubkey,
    pub policy_sequence: u64,
    pub identity_sequence: u64,
    pub root_rotation_count: u64,
    pub disabled_at_slot: u64,
}

#[event]
pub struct RecoveryRequested {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub recovery_policy: Pubkey,
    pub recovery_request: Pubkey,
    pub requesting_guardian: Pubkey,
    pub request_nonce: [u8; NONCE_BYTES],
    pub policy_sequence: u64,
    pub current_root_authority: Pubkey,
    pub identity_sequence: u64,
    pub root_rotation_count: u64,
    pub target_root_authority: Pubkey,
    pub threshold: u8,
    pub guardian_count: u8,
    pub approval_count: u8,
    pub requested_at_slot: u64,
    pub execute_after_slot: u64,
}

#[event]
pub struct RecoveryApproved {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub recovery_policy: Pubkey,
    pub recovery_request: Pubkey,
    pub guardian: Pubkey,
    pub guardian_index: u8,
    pub policy_sequence: u64,
    pub approval_count: u8,
    pub threshold: u8,
    pub approved_at_slot: u64,
}

#[event]
pub struct RecoveryCancelled {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub recovery_policy: Pubkey,
    pub recovery_request: Pubkey,
    pub cancelled_by_root_authority: Pubkey,
    pub target_root_authority: Pubkey,
    pub policy_sequence: u64,
    pub identity_sequence: u64,
    pub root_rotation_count: u64,
    pub cancelled_at_slot: u64,
}

#[event]
pub struct RecoveryExecuted {
    pub event_version: u16,
    pub config: Pubkey,
    pub identity: Pubkey,
    pub recovery_policy: Pubkey,
    pub recovery_request: Pubkey,
    pub executor: Pubkey,
    pub previous_root_authority: Pubkey,
    pub new_root_authority: Pubkey,
    pub policy_sequence: u64,
    pub approval_count: u8,
    pub threshold: u8,
    pub identity_sequence: u64,
    pub rotation_count: u64,
    pub executed_at_slot: u64,
}

#[event]
pub struct PaymentConfigInitialized {
    pub event_version: u16,
    pub config: Pubkey,
    pub payment_config: Pubkey,
    pub upgrade_authority: Pubkey,
    pub payment_authority: Pubkey,
    pub fee_destination: Pubkey,
    pub fee_bps: u16,
    pub policy_sequence: u64,
    pub enabled: bool,
    pub initialized_at_slot: u64,
}

#[event]
pub struct PaymentConfigUpdated {
    pub event_version: u16,
    pub config: Pubkey,
    pub payment_config: Pubkey,
    pub authority: Pubkey,
    pub previous_fee_destination: Pubkey,
    pub fee_destination: Pubkey,
    pub previous_fee_bps: u16,
    pub fee_bps: u16,
    pub previous_enabled: bool,
    pub enabled: bool,
    pub policy_sequence: u64,
    pub updated_at_slot: u64,
}

#[event]
pub struct PaymentAuthorityRotated {
    pub event_version: u16,
    pub config: Pubkey,
    pub payment_config: Pubkey,
    pub previous_authority: Pubkey,
    pub new_authority: Pubkey,
    pub policy_sequence: u64,
    pub rotated_at_slot: u64,
}

#[event]
pub struct SubscriptionOfferingCreated {
    pub event_version: u16,
    pub config: Pubkey,
    pub payment_config: Pubkey,
    pub offering: Pubkey,
    pub creator_identity: Pubkey,
    pub root_authority: Pubkey,
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
    pub offering_state_sequence: u64,
    pub created_at_slot: u64,
}

#[event]
pub struct SubscriptionOfferingRetired {
    pub event_version: u16,
    pub config: Pubkey,
    pub offering: Pubkey,
    pub creator_identity: Pubkey,
    pub root_authority: Pubkey,
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub creator_sequence: u64,
    pub offering_state_sequence: u64,
    pub retired_at_slot: u64,
}

#[event]
pub struct WokeTipSettled {
    pub event_version: u16,
    pub config: Pubkey,
    pub payment_config: Pubkey,
    pub receipt: Pubkey,
    pub payer_identity: Pubkey,
    pub payer_authority: Pubkey,
    pub recipient_identity: Pubkey,
    pub recipient_destination: Pubkey,
    pub receipt_nonce: [u8; NONCE_BYTES],
    pub payment_kind: PaymentKind,
    pub payer_root_rotation_count: u64,
    pub payment_policy_sequence: u64,
    pub gross_lamports: u64,
    pub fee_bps: u16,
    pub fee_destination: Pubkey,
    pub fee_lamports: u64,
    pub distributable_lamports: u64,
    pub recipient_lamports: u64,
    pub paid_at_timestamp: i64,
    pub paid_at_slot: u64,
}

#[event]
pub struct SubscriptionSettled {
    pub event_version: u16,
    pub config: Pubkey,
    pub payment_config: Pubkey,
    pub offering: Pubkey,
    pub receipt: Pubkey,
    pub entitlement: Pubkey,
    pub creator_identity: Pubkey,
    pub payer_identity: Pubkey,
    pub payer_authority: Pubkey,
    pub receipt_nonce: [u8; NONCE_BYTES],
    pub payment_kind: PaymentKind,
    pub payer_root_rotation_count: u64,
    pub payment_policy_sequence: u64,
    pub offering_state_sequence: u64,
    pub offering_manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub refund_policy_hash: [u8; MANIFEST_HASH_BYTES],
    pub gross_lamports: u64,
    pub fee_bps: u16,
    pub fee_destination: Pubkey,
    pub fee_lamports: u64,
    pub distributable_lamports: u64,
    pub recipient_splits: Vec<PaymentSplit>,
    pub recipient_amounts: Vec<u64>,
    pub entitlement_state_sequence: u64,
    pub settlement_count: u64,
    pub entitlement_from_timestamp: i64,
    pub entitlement_until_timestamp: i64,
    pub paid_at_timestamp: i64,
    pub paid_at_slot: u64,
}

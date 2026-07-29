use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, COMMUNITY_SEED, CONFIG_SEED, DELEGATION_SEED, IDENTITY_SEED,
        MANIFEST_HASH_BYTES, PDA_PREFIX, PDA_VERSION, PROPOSAL_SEED, PROTOCOL_VERSION,
        SCOPE_COMMUNITY,
    },
    errors::SocialProtocolError,
    events::ProposalCreated,
    state::{
        Community, Delegation, GovernanceProposal, GovernanceProposalOutcome,
        GovernanceVotingModel, Identity, ProtocolConfig,
    },
    validation::{
        authorize_identity_action, checked_increment, checked_next_sequence,
        validate_governance_commitment, validate_manifest, validate_proposal_window,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateProposalArgs {
    pub expected_creator_sequence: u64,
    pub expected_community_sequence: u64,
    pub expected_community_membership_sequence: u64,
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub opens_at_slot: u64,
    pub closes_at_slot: u64,
    pub quorum_bps: u16,
    pub approval_bps: u16,
}

#[derive(Accounts)]
#[instruction(args: CreateProposalArgs)]
pub struct CreateProposal<'info> {
    #[account(
        seeds = [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
        bump = config.bump,
        constraint = config.version == PROTOCOL_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            creator_identity.origin_authority.as_ref(),
            creator_identity.identity_nonce.as_ref()
        ],
        bump = creator_identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        constraint = creator_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub creator_identity: Box<Account<'info, Identity>>,
    #[account(
        mut,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            COMMUNITY_SEED,
            creator_identity.key().as_ref(),
            community.community_nonce.as_ref()
        ],
        bump = community.bump,
        has_one = config @ SocialProtocolError::CommunitySubstitution,
        has_one = creator_identity @ SocialProtocolError::CommunitySubstitution,
        constraint = community.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub community: Box<Account<'info, Community>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = GovernanceProposal::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            PROPOSAL_SEED,
            community.key().as_ref(),
            args.manifest_hash.as_ref()
        ],
        bump
    )]
    pub proposal: Box<Account<'info, GovernanceProposal>>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            DELEGATION_SEED,
            creator_identity.key().as_ref(),
            authority.key().as_ref(),
            delegation.delegation_sequence.to_le_bytes().as_ref()
        ],
        bump = delegation.bump,
        has_one = config @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.identity == creator_identity.key()
            @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.delegate_authority == authority.key()
            @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub delegation: Option<Box<Account<'info, Delegation>>>,
}

pub fn handle_create_proposal(
    ctx: Context<CreateProposal>,
    args: CreateProposalArgs,
) -> Result<()> {
    validate_manifest(&args.manifest_hash, &args.manifest_uri)?;
    validate_governance_commitment(
        &ctx.accounts.community.governance_strategy_hash,
        args.quorum_bps,
        args.approval_bps,
    )?;
    require!(
        ctx.accounts.community.governance_version > 0,
        SocialProtocolError::InvalidGovernanceVersion
    );
    require!(
        ctx.accounts.community.member_count > 0,
        SocialProtocolError::NoEligibleCommunityMembers
    );

    let created_at_slot = Clock::get()?.slot;
    validate_proposal_window(created_at_slot, args.opens_at_slot, args.closes_at_slot)?;
    authorize_identity_action(
        ctx.accounts.creator_identity.key(),
        &ctx.accounts.creator_identity,
        ctx.accounts.authority.key(),
        ctx.accounts
            .delegation
            .as_deref()
            .map(|delegation| &**delegation),
        SCOPE_COMMUNITY,
        created_at_slot,
    )?;

    let config_key = ctx.accounts.config.key();
    let community_key = ctx.accounts.community.key();
    let creator_identity_key = ctx.accounts.creator_identity.key();
    let proposal_key = ctx.accounts.proposal.key();
    let is_new = ctx.accounts.proposal.version == 0;
    if !is_new {
        require_eq!(
            ctx.accounts.proposal.version,
            ACCOUNT_VERSION,
            SocialProtocolError::UnsupportedProtocolVersion
        );
        require_keys_eq!(
            ctx.accounts.proposal.config,
            config_key,
            SocialProtocolError::ProposalSubstitution
        );
        require_keys_eq!(
            ctx.accounts.proposal.community,
            community_key,
            SocialProtocolError::ProposalSubstitution
        );
        require!(
            ctx.accounts.proposal.manifest_hash == args.manifest_hash,
            SocialProtocolError::ProposalSubstitution
        );
        return err!(SocialProtocolError::ProposalAlreadyExists);
    }

    require_eq!(
        ctx.accounts.community.creator_sequence,
        args.expected_community_sequence,
        SocialProtocolError::CommunitySequenceMismatch
    );
    require_eq!(
        ctx.accounts.community.membership_sequence,
        args.expected_community_membership_sequence,
        SocialProtocolError::CommunityMembershipSequenceMismatch
    );
    let next_creator_sequence = checked_next_sequence(
        ctx.accounts.creator_identity.sequence,
        args.expected_creator_sequence,
    )?;
    let initial_proposal_sequence = checked_increment(0)?;
    let previous_community_sequence = ctx.accounts.community.creator_sequence;

    ctx.accounts.creator_identity.sequence = next_creator_sequence;
    ctx.accounts.community.creator_sequence = next_creator_sequence;
    ctx.accounts.community.updated_at_slot = created_at_slot;

    let proposal = &mut ctx.accounts.proposal;
    proposal.version = ACCOUNT_VERSION;
    proposal.config = config_key;
    proposal.community = community_key;
    proposal.proposer_identity = creator_identity_key;
    proposal.manifest_hash = args.manifest_hash;
    proposal.manifest_uri = args.manifest_uri.clone();
    proposal.governance_version = ctx.accounts.community.governance_version;
    proposal.governance_strategy_hash = ctx.accounts.community.governance_strategy_hash;
    proposal.voting_model = GovernanceVotingModel::OneActiveMemberOneVote;
    proposal.eligible_member_count = ctx.accounts.community.member_count;
    proposal.community_membership_sequence = ctx.accounts.community.membership_sequence;
    proposal.opens_at_slot = args.opens_at_slot;
    proposal.closes_at_slot = args.closes_at_slot;
    proposal.quorum_bps = args.quorum_bps;
    proposal.approval_bps = args.approval_bps;
    proposal.yes_votes = 0;
    proposal.no_votes = 0;
    proposal.abstain_votes = 0;
    proposal.created_at_slot = created_at_slot;
    proposal.proposer_sequence = next_creator_sequence;
    proposal.state_sequence = initial_proposal_sequence;
    proposal.outcome = GovernanceProposalOutcome::Pending;
    proposal.finalized_at_slot = None;
    proposal.bump = ctx.bumps.proposal;

    emit!(ProposalCreated {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        community: community_key,
        proposal: proposal_key,
        proposer_identity: creator_identity_key,
        authority: ctx.accounts.authority.key(),
        proposer_sequence: next_creator_sequence,
        previous_community_sequence,
        manifest_hash: args.manifest_hash,
        manifest_uri: args.manifest_uri,
        governance_version: proposal.governance_version,
        governance_strategy_hash: proposal.governance_strategy_hash,
        voting_model: proposal.voting_model,
        eligible_member_count: proposal.eligible_member_count,
        community_membership_sequence: proposal.community_membership_sequence,
        opens_at_slot: proposal.opens_at_slot,
        closes_at_slot: proposal.closes_at_slot,
        quorum_bps: proposal.quorum_bps,
        approval_bps: proposal.approval_bps,
        proposal_state_sequence: proposal.state_sequence,
        created_at_slot,
    });

    Ok(())
}

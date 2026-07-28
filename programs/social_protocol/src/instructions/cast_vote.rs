use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, COMMUNITY_ROLE_MEMBER, COMMUNITY_SEED, CONFIG_SEED, DELEGATION_SEED,
        IDENTITY_SEED, MEMBERSHIP_SEED, PDA_PREFIX, PDA_VERSION, PROPOSAL_SEED, PROTOCOL_VERSION,
        SCOPE_COMMUNITY, SCOPE_SOCIAL, VOTE_SEED,
    },
    errors::SocialProtocolError,
    events::VoteCast,
    state::{
        Community, CommunityMembership, Delegation, GovernanceProposal, GovernanceProposalOutcome,
        GovernanceVote, GovernanceVoteChoice, Identity, ProtocolConfig,
    },
    validation::{
        authorize_identity_action_any_scope, calculate_governance_tally, checked_increment,
        checked_next_sequence, validate_governance_commitment, validate_membership_snapshot,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CastVoteArgs {
    pub expected_voter_sequence: u64,
    pub expected_membership_state_sequence: u64,
    pub expected_proposal_state_sequence: u64,
    pub choice: GovernanceVoteChoice,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
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
            voter_identity.origin_authority.as_ref(),
            voter_identity.identity_nonce.as_ref()
        ],
        bump = voter_identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        constraint = voter_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub voter_identity: Box<Account<'info, Identity>>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            COMMUNITY_SEED,
            community.creator_identity.as_ref(),
            community.community_nonce.as_ref()
        ],
        bump = community.bump,
        has_one = config @ SocialProtocolError::CommunitySubstitution,
        constraint = community.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub community: Box<Account<'info, Community>>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            MEMBERSHIP_SEED,
            community.key().as_ref(),
            voter_identity.key().as_ref()
        ],
        bump = membership.bump,
        has_one = config @ SocialProtocolError::CommunitySubstitution,
        has_one = community @ SocialProtocolError::CommunitySubstitution,
        constraint = membership.member_identity == voter_identity.key()
            @ SocialProtocolError::CommunitySubstitution,
        constraint = membership.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub membership: Box<Account<'info, CommunityMembership>>,
    #[account(
        mut,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            PROPOSAL_SEED,
            community.key().as_ref(),
            proposal.manifest_hash.as_ref()
        ],
        bump = proposal.bump,
        has_one = config @ SocialProtocolError::ProposalSubstitution,
        has_one = community @ SocialProtocolError::ProposalSubstitution,
        constraint = proposal.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub proposal: Box<Account<'info, GovernanceProposal>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = GovernanceVote::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            VOTE_SEED,
            proposal.key().as_ref(),
            voter_identity.key().as_ref()
        ],
        bump
    )]
    pub vote: Box<Account<'info, GovernanceVote>>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            DELEGATION_SEED,
            voter_identity.key().as_ref(),
            authority.key().as_ref(),
            delegation.delegation_sequence.to_le_bytes().as_ref()
        ],
        bump = delegation.bump,
        has_one = config @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.identity == voter_identity.key()
            @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.delegate_authority == authority.key()
            @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub delegation: Option<Box<Account<'info, Delegation>>>,
}

pub fn handle_cast_vote(ctx: Context<CastVote>, args: CastVoteArgs) -> Result<()> {
    let cast_at_slot = Clock::get()?.slot;
    authorize_identity_action_any_scope(
        ctx.accounts.voter_identity.key(),
        &ctx.accounts.voter_identity,
        ctx.accounts.authority.key(),
        ctx.accounts
            .delegation
            .as_deref()
            .map(|delegation| &**delegation),
        SCOPE_SOCIAL | SCOPE_COMMUNITY,
        cast_at_slot,
    )?;
    validate_governance_commitment(
        &ctx.accounts.proposal.governance_strategy_hash,
        ctx.accounts.proposal.quorum_bps,
        ctx.accounts.proposal.approval_bps,
    )?;
    require!(
        ctx.accounts.proposal.outcome == GovernanceProposalOutcome::Pending
            && ctx.accounts.proposal.finalized_at_slot.is_none(),
        SocialProtocolError::ProposalAlreadyFinalized
    );
    require!(
        cast_at_slot >= ctx.accounts.proposal.opens_at_slot,
        SocialProtocolError::ProposalNotOpen
    );
    require!(
        cast_at_slot < ctx.accounts.proposal.closes_at_slot,
        SocialProtocolError::ProposalVotingClosed
    );
    require!(
        ctx.accounts.membership.active
            && ctx.accounts.membership.roles & COMMUNITY_ROLE_MEMBER != 0,
        SocialProtocolError::InactiveCommunityMember
    );
    validate_membership_snapshot(
        ctx.accounts.membership.updated_at_slot,
        ctx.accounts.membership.authority_sequence,
        ctx.accounts.proposal.created_at_slot,
        ctx.accounts.proposal.proposer_sequence,
    )?;
    require_eq!(
        ctx.accounts.membership.state_sequence,
        args.expected_membership_state_sequence,
        SocialProtocolError::MembershipSequenceMismatch
    );

    let config_key = ctx.accounts.config.key();
    let community_key = ctx.accounts.community.key();
    let proposal_key = ctx.accounts.proposal.key();
    let voter_identity_key = ctx.accounts.voter_identity.key();
    let membership_key = ctx.accounts.membership.key();
    let vote_key = ctx.accounts.vote.key();
    let is_new = ctx.accounts.vote.version == 0;
    if !is_new {
        require_eq!(
            ctx.accounts.vote.version,
            ACCOUNT_VERSION,
            SocialProtocolError::UnsupportedProtocolVersion
        );
        require_keys_eq!(
            ctx.accounts.vote.config,
            config_key,
            SocialProtocolError::VoteSubstitution
        );
        require_keys_eq!(
            ctx.accounts.vote.community,
            community_key,
            SocialProtocolError::VoteSubstitution
        );
        require_keys_eq!(
            ctx.accounts.vote.proposal,
            proposal_key,
            SocialProtocolError::VoteSubstitution
        );
        require_keys_eq!(
            ctx.accounts.vote.voter_identity,
            voter_identity_key,
            SocialProtocolError::VoteSubstitution
        );
        require_keys_eq!(
            ctx.accounts.vote.membership,
            membership_key,
            SocialProtocolError::VoteSubstitution
        );
        return err!(SocialProtocolError::VoteAlreadyCast);
    }

    require_eq!(
        ctx.accounts.proposal.state_sequence,
        args.expected_proposal_state_sequence,
        SocialProtocolError::ProposalSequenceMismatch
    );
    let current_tally = calculate_governance_tally(
        ctx.accounts.proposal.eligible_member_count,
        ctx.accounts.proposal.yes_votes,
        ctx.accounts.proposal.no_votes,
        ctx.accounts.proposal.abstain_votes,
        ctx.accounts.proposal.quorum_bps,
        ctx.accounts.proposal.approval_bps,
    )?;
    require!(
        current_tally.participating_votes < ctx.accounts.proposal.eligible_member_count,
        SocialProtocolError::EligibleVoteCapacityReached
    );

    let next_voter_sequence = checked_next_sequence(
        ctx.accounts.voter_identity.sequence,
        args.expected_voter_sequence,
    )?;
    let next_proposal_sequence = checked_increment(ctx.accounts.proposal.state_sequence)?;
    match args.choice {
        GovernanceVoteChoice::Yes => {
            ctx.accounts.proposal.yes_votes = checked_increment(ctx.accounts.proposal.yes_votes)?;
        }
        GovernanceVoteChoice::No => {
            ctx.accounts.proposal.no_votes = checked_increment(ctx.accounts.proposal.no_votes)?;
        }
        GovernanceVoteChoice::Abstain => {
            ctx.accounts.proposal.abstain_votes =
                checked_increment(ctx.accounts.proposal.abstain_votes)?;
        }
    }
    ctx.accounts.voter_identity.sequence = next_voter_sequence;
    ctx.accounts.proposal.state_sequence = next_proposal_sequence;

    let vote = &mut ctx.accounts.vote;
    vote.version = ACCOUNT_VERSION;
    vote.config = config_key;
    vote.community = community_key;
    vote.proposal = proposal_key;
    vote.voter_identity = voter_identity_key;
    vote.membership = membership_key;
    vote.choice = args.choice;
    vote.voter_sequence = next_voter_sequence;
    vote.membership_state_sequence = ctx.accounts.membership.state_sequence;
    vote.cast_at_slot = cast_at_slot;
    vote.bump = ctx.bumps.vote;

    emit!(VoteCast {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        community: community_key,
        proposal: proposal_key,
        vote: vote_key,
        voter_identity: voter_identity_key,
        membership: membership_key,
        authority: ctx.accounts.authority.key(),
        voter_sequence: next_voter_sequence,
        membership_state_sequence: vote.membership_state_sequence,
        proposal_state_sequence: next_proposal_sequence,
        choice: args.choice,
        yes_votes: ctx.accounts.proposal.yes_votes,
        no_votes: ctx.accounts.proposal.no_votes,
        abstain_votes: ctx.accounts.proposal.abstain_votes,
        cast_at_slot,
    });

    Ok(())
}

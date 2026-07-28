use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, COMMUNITY_SEED, CONFIG_SEED, PDA_PREFIX, PDA_VERSION, PROPOSAL_SEED,
        PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::ProposalFinalized,
    state::{Community, GovernanceProposal, GovernanceProposalOutcome, ProtocolConfig},
    validation::{calculate_governance_tally, checked_increment, validate_governance_commitment},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FinalizeProposalArgs {
    pub expected_proposal_state_sequence: u64,
}

#[derive(Accounts)]
pub struct FinalizeProposal<'info> {
    #[account(
        seeds = [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
        bump = config.bump,
        constraint = config.version == PROTOCOL_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,
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
    pub finalizer: Signer<'info>,
}

pub fn handle_finalize_proposal(
    ctx: Context<FinalizeProposal>,
    args: FinalizeProposalArgs,
) -> Result<()> {
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
    require_eq!(
        ctx.accounts.proposal.state_sequence,
        args.expected_proposal_state_sequence,
        SocialProtocolError::ProposalSequenceMismatch
    );

    let finalized_at_slot = Clock::get()?.slot;
    require!(
        finalized_at_slot >= ctx.accounts.proposal.closes_at_slot,
        SocialProtocolError::ProposalFinalizationTooEarly
    );
    let tally = calculate_governance_tally(
        ctx.accounts.proposal.eligible_member_count,
        ctx.accounts.proposal.yes_votes,
        ctx.accounts.proposal.no_votes,
        ctx.accounts.proposal.abstain_votes,
        ctx.accounts.proposal.quorum_bps,
        ctx.accounts.proposal.approval_bps,
    )?;
    let outcome = if tally.quorum_met && tally.approval_met {
        GovernanceProposalOutcome::Accepted
    } else {
        GovernanceProposalOutcome::Rejected
    };
    let next_proposal_sequence = checked_increment(ctx.accounts.proposal.state_sequence)?;

    ctx.accounts.proposal.state_sequence = next_proposal_sequence;
    ctx.accounts.proposal.outcome = outcome;
    ctx.accounts.proposal.finalized_at_slot = Some(finalized_at_slot);

    emit!(ProposalFinalized {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        community: ctx.accounts.community.key(),
        proposal: ctx.accounts.proposal.key(),
        finalizer: ctx.accounts.finalizer.key(),
        proposal_state_sequence: next_proposal_sequence,
        eligible_member_count: ctx.accounts.proposal.eligible_member_count,
        yes_votes: ctx.accounts.proposal.yes_votes,
        no_votes: ctx.accounts.proposal.no_votes,
        abstain_votes: ctx.accounts.proposal.abstain_votes,
        participating_votes: tally.participating_votes,
        decisive_votes: tally.decisive_votes,
        quorum_bps: ctx.accounts.proposal.quorum_bps,
        approval_bps: ctx.accounts.proposal.approval_bps,
        quorum_met: tally.quorum_met,
        approval_met: tally.approval_met,
        outcome,
        finalized_at_slot,
    });

    Ok(())
}

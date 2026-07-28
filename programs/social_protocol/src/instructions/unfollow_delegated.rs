use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, DELEGATION_SEED, FOLLOW_SEED, IDENTITY_SEED, PDA_PREFIX,
        PDA_VERSION, PROTOCOL_VERSION, SCOPE_SOCIAL,
    },
    errors::SocialProtocolError,
    events::FollowStateChanged,
    instructions::UnfollowArgs,
    state::{Delegation, FollowEdge, Identity, ProtocolConfig},
    validation::{authorize_identity_action, checked_increment, checked_next_sequence},
};

#[derive(Accounts)]
pub struct UnfollowDelegated<'info> {
    #[account(
        seeds = [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
        bump = config.bump,
        constraint = config.version == PROTOCOL_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            follower_identity.origin_authority.as_ref(),
            follower_identity.identity_nonce.as_ref()
        ],
        bump = follower_identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        constraint = follower_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub follower_identity: Account<'info, Identity>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            subject_identity.origin_authority.as_ref(),
            subject_identity.identity_nonce.as_ref()
        ],
        bump = subject_identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution
    )]
    pub subject_identity: Account<'info, Identity>,
    #[account(
        mut,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            FOLLOW_SEED,
            follower_identity.key().as_ref(),
            subject_identity.key().as_ref()
        ],
        bump = follow_edge.bump,
        has_one = config @ SocialProtocolError::FollowEdgeSubstitution,
        has_one = follower_identity @ SocialProtocolError::FollowEdgeSubstitution,
        has_one = subject_identity @ SocialProtocolError::FollowEdgeSubstitution,
        constraint = follow_edge.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub follow_edge: Account<'info, FollowEdge>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            DELEGATION_SEED,
            delegation.identity.as_ref(),
            delegation.delegate_authority.as_ref(),
            delegation.delegation_sequence.to_le_bytes().as_ref()
        ],
        bump = delegation.bump,
        has_one = config @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.identity == follower_identity.key()
            @ SocialProtocolError::DelegationSubstitution,
        has_one = delegate_authority @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub delegation: Account<'info, Delegation>,
    pub delegate_authority: Signer<'info>,
}

pub fn handle_unfollow_delegated(
    ctx: Context<UnfollowDelegated>,
    args: UnfollowArgs,
) -> Result<()> {
    require!(
        ctx.accounts.follow_edge.active,
        SocialProtocolError::NotFollowing
    );

    let updated_at_slot = Clock::get()?.slot;
    authorize_identity_action(
        ctx.accounts.follower_identity.key(),
        &ctx.accounts.follower_identity,
        ctx.accounts.delegate_authority.key(),
        Some(&ctx.accounts.delegation),
        SCOPE_SOCIAL,
        updated_at_slot,
    )?;

    let next_follower_sequence = checked_next_sequence(
        ctx.accounts.follower_identity.sequence,
        args.expected_follower_sequence,
    )?;
    let next_edge_sequence = checked_increment(ctx.accounts.follow_edge.state_sequence)?;

    ctx.accounts.follower_identity.sequence = next_follower_sequence;
    ctx.accounts.follow_edge.state_sequence = next_edge_sequence;
    ctx.accounts.follow_edge.follower_sequence = next_follower_sequence;
    ctx.accounts.follow_edge.updated_at_slot = updated_at_slot;
    ctx.accounts.follow_edge.active = false;

    emit!(FollowStateChanged {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        follow_edge: ctx.accounts.follow_edge.key(),
        follower_identity: ctx.accounts.follower_identity.key(),
        subject_identity: ctx.accounts.subject_identity.key(),
        follower_sequence: next_follower_sequence,
        edge_state_sequence: next_edge_sequence,
        active: false,
        updated_at_slot,
    });

    Ok(())
}

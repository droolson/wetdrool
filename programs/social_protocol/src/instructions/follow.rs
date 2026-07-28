use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, FOLLOW_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION,
        PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::FollowStateChanged,
    state::{FollowEdge, Identity, ProtocolConfig},
    validation::{checked_increment, checked_next_sequence},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FollowArgs {
    pub expected_follower_sequence: u64,
}

#[derive(Accounts)]
pub struct Follow<'info> {
    #[account(
        mut,
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
        has_one = root_authority @ SocialProtocolError::Unauthorized,
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
        has_one = config @ SocialProtocolError::AccountSubstitution,
        constraint = subject_identity.active @ SocialProtocolError::IdentityInactive,
        constraint = follower_identity.key() != subject_identity.key()
            @ SocialProtocolError::CannotFollowSelf
    )]
    pub subject_identity: Account<'info, Identity>,
    #[account(
        init_if_needed,
        payer = payer,
        space = FollowEdge::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            FOLLOW_SEED,
            follower_identity.key().as_ref(),
            subject_identity.key().as_ref()
        ],
        bump
    )]
    pub follow_edge: Account<'info, FollowEdge>,
    pub root_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_follow(ctx: Context<Follow>, args: FollowArgs) -> Result<()> {
    let updated_at_slot = Clock::get()?.slot;
    let config_key = ctx.accounts.config.key();
    let follower_identity_key = ctx.accounts.follower_identity.key();
    let subject_identity_key = ctx.accounts.subject_identity.key();
    let follow_edge_key = ctx.accounts.follow_edge.key();
    let next_follower_sequence = checked_next_sequence(
        ctx.accounts.follower_identity.sequence,
        args.expected_follower_sequence,
    )?;

    let is_new = ctx.accounts.follow_edge.version == 0;
    if is_new {
        ctx.accounts.config.follow_edge_count =
            checked_increment(ctx.accounts.config.follow_edge_count)?;
        let follow_edge = &mut ctx.accounts.follow_edge;
        follow_edge.version = ACCOUNT_VERSION;
        follow_edge.config = config_key;
        follow_edge.follower_identity = follower_identity_key;
        follow_edge.subject_identity = subject_identity_key;
        follow_edge.state_sequence = 0;
        follow_edge.follower_sequence = 0;
        follow_edge.created_at_slot = updated_at_slot;
        follow_edge.updated_at_slot = updated_at_slot;
        follow_edge.active = false;
        follow_edge.bump = ctx.bumps.follow_edge;
    } else {
        require_eq!(
            ctx.accounts.follow_edge.version,
            ACCOUNT_VERSION,
            SocialProtocolError::UnsupportedProtocolVersion
        );
        require_keys_eq!(
            ctx.accounts.follow_edge.config,
            config_key,
            SocialProtocolError::FollowEdgeSubstitution
        );
        require_keys_eq!(
            ctx.accounts.follow_edge.follower_identity,
            follower_identity_key,
            SocialProtocolError::FollowEdgeSubstitution
        );
        require_keys_eq!(
            ctx.accounts.follow_edge.subject_identity,
            subject_identity_key,
            SocialProtocolError::FollowEdgeSubstitution
        );
    }

    require!(
        !ctx.accounts.follow_edge.active,
        SocialProtocolError::AlreadyFollowing
    );

    let next_edge_sequence = checked_increment(ctx.accounts.follow_edge.state_sequence)?;
    ctx.accounts.follower_identity.sequence = next_follower_sequence;
    ctx.accounts.follow_edge.state_sequence = next_edge_sequence;
    ctx.accounts.follow_edge.follower_sequence = next_follower_sequence;
    ctx.accounts.follow_edge.updated_at_slot = updated_at_slot;
    ctx.accounts.follow_edge.active = true;

    emit!(FollowStateChanged {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        follow_edge: follow_edge_key,
        follower_identity: follower_identity_key,
        subject_identity: subject_identity_key,
        follower_sequence: next_follower_sequence,
        edge_state_sequence: next_edge_sequence,
        active: true,
        updated_at_slot,
    });

    Ok(())
}

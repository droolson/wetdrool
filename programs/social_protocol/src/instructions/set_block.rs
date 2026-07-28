use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, BLOCK_SEED, CONFIG_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION,
        PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::BlockStateChanged,
    state::{BlockEdge, Identity, ProtocolConfig},
    validation::{checked_increment, checked_next_sequence},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetBlockArgs {
    pub expected_blocker_sequence: u64,
    pub active: bool,
}

#[derive(Accounts)]
pub struct SetBlock<'info> {
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
            blocker_identity.origin_authority.as_ref(),
            blocker_identity.identity_nonce.as_ref()
        ],
        bump = blocker_identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        has_one = root_authority @ SocialProtocolError::Unauthorized,
        constraint = blocker_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub blocker_identity: Account<'info, Identity>,
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
        constraint = blocker_identity.key() != subject_identity.key()
            @ SocialProtocolError::CannotBlockSelf
    )]
    pub subject_identity: Account<'info, Identity>,
    #[account(
        init_if_needed,
        payer = payer,
        space = BlockEdge::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            BLOCK_SEED,
            blocker_identity.key().as_ref(),
            subject_identity.key().as_ref()
        ],
        bump
    )]
    pub block_edge: Account<'info, BlockEdge>,
    pub root_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_set_block(ctx: Context<SetBlock>, args: SetBlockArgs) -> Result<()> {
    let updated_at_slot = Clock::get()?.slot;
    let config_key = ctx.accounts.config.key();
    let blocker_identity_key = ctx.accounts.blocker_identity.key();
    let subject_identity_key = ctx.accounts.subject_identity.key();
    let is_new = ctx.accounts.block_edge.version == 0;

    if is_new {
        require!(args.active, SocialProtocolError::NotBlocked);
        ctx.accounts.config.block_edge_count =
            checked_increment(ctx.accounts.config.block_edge_count)?;
        let edge = &mut ctx.accounts.block_edge;
        edge.version = ACCOUNT_VERSION;
        edge.config = config_key;
        edge.blocker_identity = blocker_identity_key;
        edge.subject_identity = subject_identity_key;
        edge.state_sequence = 0;
        edge.blocker_sequence = 0;
        edge.created_at_slot = updated_at_slot;
        edge.updated_at_slot = updated_at_slot;
        edge.active = false;
        edge.bump = ctx.bumps.block_edge;
    } else {
        require_eq!(
            ctx.accounts.block_edge.version,
            ACCOUNT_VERSION,
            SocialProtocolError::UnsupportedProtocolVersion
        );
        require_keys_eq!(
            ctx.accounts.block_edge.config,
            config_key,
            SocialProtocolError::BlockEdgeSubstitution
        );
        require_keys_eq!(
            ctx.accounts.block_edge.blocker_identity,
            blocker_identity_key,
            SocialProtocolError::BlockEdgeSubstitution
        );
        require_keys_eq!(
            ctx.accounts.block_edge.subject_identity,
            subject_identity_key,
            SocialProtocolError::BlockEdgeSubstitution
        );
    }

    require!(
        ctx.accounts.block_edge.active != args.active,
        if args.active {
            SocialProtocolError::AlreadyBlocked
        } else {
            SocialProtocolError::NotBlocked
        }
    );

    let next_blocker_sequence = checked_next_sequence(
        ctx.accounts.blocker_identity.sequence,
        args.expected_blocker_sequence,
    )?;
    let next_edge_sequence = checked_increment(ctx.accounts.block_edge.state_sequence)?;
    ctx.accounts.blocker_identity.sequence = next_blocker_sequence;
    ctx.accounts.block_edge.state_sequence = next_edge_sequence;
    ctx.accounts.block_edge.blocker_sequence = next_blocker_sequence;
    ctx.accounts.block_edge.updated_at_slot = updated_at_slot;
    ctx.accounts.block_edge.active = args.active;

    emit!(BlockStateChanged {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        block_edge: ctx.accounts.block_edge.key(),
        blocker_identity: blocker_identity_key,
        subject_identity: subject_identity_key,
        authority: ctx.accounts.root_authority.key(),
        blocker_sequence: next_blocker_sequence,
        edge_state_sequence: next_edge_sequence,
        active: args.active,
        updated_at_slot,
    });

    Ok(())
}

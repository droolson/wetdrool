use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION},
    errors::SocialProtocolError,
    events::RootAuthorityRotated,
    state::{Identity, ProtocolConfig},
    validation::{checked_increment, checked_next_sequence},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RotateRootAuthorityArgs {
    pub expected_identity_sequence: u64,
}

#[derive(Accounts)]
pub struct RotateRootAuthority<'info> {
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
            identity.origin_authority.as_ref(),
            identity.identity_nonce.as_ref()
        ],
        bump = identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        constraint = identity.root_authority == root_authority.key()
            @ SocialProtocolError::Unauthorized,
        constraint = identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub identity: Account<'info, Identity>,
    pub root_authority: Signer<'info>,
    pub new_root_authority: Signer<'info>,
}

pub fn handle_rotate_root_authority(
    ctx: Context<RotateRootAuthority>,
    args: RotateRootAuthorityArgs,
) -> Result<()> {
    let new_root_authority = ctx.accounts.new_root_authority.key();
    require!(
        new_root_authority != Pubkey::default()
            && new_root_authority != ctx.accounts.identity.root_authority,
        SocialProtocolError::InvalidRootAuthority
    );

    let rotated_at_slot = Clock::get()?.slot;
    let previous_root_authority = ctx.accounts.identity.root_authority;
    let next_identity_sequence = checked_next_sequence(
        ctx.accounts.identity.sequence,
        args.expected_identity_sequence,
    )?;
    let next_rotation_count = checked_increment(ctx.accounts.identity.root_rotation_count)?;

    ctx.accounts.identity.sequence = next_identity_sequence;
    ctx.accounts.identity.root_rotation_count = next_rotation_count;
    ctx.accounts.identity.root_authority = new_root_authority;

    emit!(RootAuthorityRotated {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        previous_root_authority,
        new_root_authority,
        identity_sequence: next_identity_sequence,
        rotation_count: next_rotation_count,
        rotated_at_slot,
    });

    Ok(())
}

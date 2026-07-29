use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::IdentityDeactivated,
    state::{Identity, ProtocolConfig},
    validation::checked_next_sequence,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DeactivateIdentityArgs {
    pub expected_identity_sequence: u64,
}

#[derive(Accounts)]
pub struct DeactivateIdentity<'info> {
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
        has_one = root_authority @ SocialProtocolError::Unauthorized,
        constraint = identity.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub identity: Account<'info, Identity>,
    pub root_authority: Signer<'info>,
}

pub fn handle_deactivate_identity(
    ctx: Context<DeactivateIdentity>,
    args: DeactivateIdentityArgs,
) -> Result<()> {
    // Preserve a distinct stale-replay error before rejecting an up-to-date
    // attempt against an identity that is already inactive.
    let next_identity_sequence = checked_next_sequence(
        ctx.accounts.identity.sequence,
        args.expected_identity_sequence,
    )?;
    require!(
        ctx.accounts.identity.active,
        SocialProtocolError::IdentityInactive
    );

    let deactivated_at_slot = Clock::get()?.slot;
    ctx.accounts.identity.sequence = next_identity_sequence;
    ctx.accounts.identity.active = false;

    emit!(IdentityDeactivated {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        root_authority: ctx.accounts.root_authority.key(),
        identity_sequence: next_identity_sequence,
        deactivated_at_slot,
    });

    Ok(())
}

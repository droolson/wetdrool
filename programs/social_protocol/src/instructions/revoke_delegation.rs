use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, DELEGATION_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION,
        PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::DelegationRevoked,
    state::{Delegation, Identity, ProtocolConfig},
    validation::{checked_increment, checked_next_sequence},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RevokeDelegationArgs {
    pub expected_identity_sequence: u64,
}

#[derive(Accounts)]
pub struct RevokeDelegation<'info> {
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
        constraint = identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub identity: Account<'info, Identity>,
    #[account(
        mut,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            DELEGATION_SEED,
            identity.key().as_ref(),
            delegation.delegate_authority.as_ref(),
            delegation.delegation_sequence.to_le_bytes().as_ref()
        ],
        bump = delegation.bump,
        has_one = config @ SocialProtocolError::DelegationSubstitution,
        has_one = identity @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub delegation: Account<'info, Delegation>,
    pub root_authority: Signer<'info>,
}

pub fn handle_revoke_delegation(
    ctx: Context<RevokeDelegation>,
    args: RevokeDelegationArgs,
) -> Result<()> {
    require!(
        ctx.accounts.delegation.active && ctx.accounts.delegation.revoked_at_slot.is_none(),
        SocialProtocolError::DelegationAlreadyRevoked
    );

    let revoked_at_slot = Clock::get()?.slot;
    let next_identity_sequence = checked_next_sequence(
        ctx.accounts.identity.sequence,
        args.expected_identity_sequence,
    )?;
    let next_delegation_state_sequence = checked_increment(ctx.accounts.delegation.state_sequence)?;

    ctx.accounts.identity.sequence = next_identity_sequence;
    ctx.accounts.delegation.active = false;
    ctx.accounts.delegation.revoked_at_slot = Some(revoked_at_slot);
    ctx.accounts.delegation.state_sequence = next_delegation_state_sequence;

    emit!(DelegationRevoked {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        delegation: ctx.accounts.delegation.key(),
        delegate_authority: ctx.accounts.delegation.delegate_authority,
        delegation_sequence: ctx.accounts.delegation.delegation_sequence,
        identity_sequence: next_identity_sequence,
        delegation_state_sequence: next_delegation_state_sequence,
        revoked_at_slot,
    });

    Ok(())
}

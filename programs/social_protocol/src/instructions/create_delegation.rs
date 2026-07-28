use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, DELEGATION_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION,
        PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::DelegationCreated,
    state::{Delegation, Identity, ProtocolConfig},
    validation::{checked_increment, checked_next_sequence, validate_delegation_scopes},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateDelegationArgs {
    pub expected_identity_sequence: u64,
    pub delegation_sequence: u64,
    pub delegate_authority: Pubkey,
    pub scopes: u16,
    pub expires_at_slot: u64,
}

#[derive(Accounts)]
#[instruction(args: CreateDelegationArgs)]
pub struct CreateDelegation<'info> {
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
        init,
        payer = payer,
        space = Delegation::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            DELEGATION_SEED,
            identity.key().as_ref(),
            args.delegate_authority.as_ref(),
            args.delegation_sequence.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub delegation: Account<'info, Delegation>,
    pub root_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_delegation(
    ctx: Context<CreateDelegation>,
    args: CreateDelegationArgs,
) -> Result<()> {
    validate_delegation_scopes(args.scopes)?;
    let issued_at_slot = Clock::get()?.slot;
    require!(
        args.expires_at_slot > issued_at_slot,
        SocialProtocolError::DelegationExpired
    );
    require!(
        args.delegate_authority != Pubkey::default()
            && args.delegate_authority != ctx.accounts.identity.root_authority,
        SocialProtocolError::InvalidRootAuthority
    );

    let expected_delegation_sequence =
        checked_increment(ctx.accounts.identity.delegation_sequence)?;
    require_eq!(
        args.delegation_sequence,
        expected_delegation_sequence,
        SocialProtocolError::DelegationSequenceMismatch
    );
    let next_identity_sequence = checked_next_sequence(
        ctx.accounts.identity.sequence,
        args.expected_identity_sequence,
    )?;

    ctx.accounts.identity.sequence = next_identity_sequence;
    ctx.accounts.identity.delegation_sequence = args.delegation_sequence;
    ctx.accounts.config.delegation_count = checked_increment(ctx.accounts.config.delegation_count)?;

    let delegation = &mut ctx.accounts.delegation;
    delegation.version = ACCOUNT_VERSION;
    delegation.config = ctx.accounts.config.key();
    delegation.identity = ctx.accounts.identity.key();
    delegation.delegate_authority = args.delegate_authority;
    delegation.delegation_sequence = args.delegation_sequence;
    delegation.scopes = args.scopes;
    delegation.issued_by_root_authority = ctx.accounts.root_authority.key();
    delegation.issued_at_root_rotation_count = ctx.accounts.identity.root_rotation_count;
    delegation.issued_at_slot = issued_at_slot;
    delegation.expires_at_slot = args.expires_at_slot;
    delegation.revoked_at_slot = None;
    delegation.state_sequence = 1;
    delegation.active = true;
    delegation.bump = ctx.bumps.delegation;

    emit!(DelegationCreated {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        delegation: delegation.key(),
        delegate_authority: args.delegate_authority,
        delegation_sequence: args.delegation_sequence,
        identity_sequence: next_identity_sequence,
        scopes: args.scopes,
        issued_at_root_rotation_count: ctx.accounts.identity.root_rotation_count,
        expires_at_slot: args.expires_at_slot,
        issued_at_slot,
    });

    Ok(())
}

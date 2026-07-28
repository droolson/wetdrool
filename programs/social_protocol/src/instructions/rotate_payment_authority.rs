use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, PAYMENT_CONFIG_SEED, PDA_PREFIX, PDA_VERSION,
        PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::PaymentAuthorityRotated,
    state::{PaymentConfig, ProtocolConfig},
    validation::checked_increment,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RotatePaymentAuthorityArgs {
    pub expected_policy_sequence: u64,
}

#[derive(Accounts)]
pub struct RotatePaymentAuthority<'info> {
    #[account(
        seeds = [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
        bump = config.bump,
        constraint = config.version == PROTOCOL_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [PDA_PREFIX, PDA_VERSION, PAYMENT_CONFIG_SEED],
        bump = payment_config.bump,
        has_one = config @ SocialProtocolError::PaymentConfigSubstitution,
        constraint = payment_config.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion,
        constraint = payment_config.authority == current_authority.key()
            @ SocialProtocolError::UnauthorizedPaymentConfig
    )]
    pub payment_config: Account<'info, PaymentConfig>,
    pub current_authority: Signer<'info>,
    pub new_authority: Signer<'info>,
}

pub fn handle_rotate_payment_authority(
    ctx: Context<RotatePaymentAuthority>,
    args: RotatePaymentAuthorityArgs,
) -> Result<()> {
    require_eq!(
        ctx.accounts.payment_config.policy_sequence,
        args.expected_policy_sequence,
        SocialProtocolError::PaymentPolicySequenceMismatch
    );
    require!(
        ctx.accounts.new_authority.key() != Pubkey::default()
            && ctx.accounts.new_authority.key() != ctx.accounts.current_authority.key(),
        SocialProtocolError::InvalidPaymentAuthority
    );
    let policy_sequence = checked_increment(ctx.accounts.payment_config.policy_sequence)?;
    let rotated_at_slot = Clock::get()?.slot;
    let previous_authority = ctx.accounts.payment_config.authority;
    ctx.accounts.payment_config.authority = ctx.accounts.new_authority.key();
    ctx.accounts.payment_config.policy_sequence = policy_sequence;
    ctx.accounts.payment_config.updated_at_slot = rotated_at_slot;

    emit!(PaymentAuthorityRotated {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        payment_config: ctx.accounts.payment_config.key(),
        previous_authority,
        new_authority: ctx.accounts.new_authority.key(),
        policy_sequence,
        rotated_at_slot,
    });
    Ok(())
}

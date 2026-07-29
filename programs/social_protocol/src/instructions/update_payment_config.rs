use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, PAYMENT_CONFIG_SEED, PDA_PREFIX, PDA_VERSION,
        PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::PaymentConfigUpdated,
    state::{PaymentConfig, ProtocolConfig},
    validation::{
        checked_increment, validate_legacy_lamport_payment_policy, validate_protocol_fee,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdatePaymentConfigArgs {
    pub expected_policy_sequence: u64,
    pub fee_bps: u16,
    pub enabled: bool,
}

#[derive(Accounts)]
pub struct UpdatePaymentConfig<'info> {
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
        constraint = payment_config.authority == authority.key()
            @ SocialProtocolError::UnauthorizedPaymentConfig
    )]
    pub payment_config: Account<'info, PaymentConfig>,
    pub authority: Signer<'info>,
    pub fee_destination: SystemAccount<'info>,
}

pub fn handle_update_payment_config(
    ctx: Context<UpdatePaymentConfig>,
    args: UpdatePaymentConfigArgs,
) -> Result<()> {
    validate_legacy_lamport_payment_policy(args.enabled)?;
    validate_protocol_fee(args.fee_bps)?;
    require_eq!(
        ctx.accounts.payment_config.policy_sequence,
        args.expected_policy_sequence,
        SocialProtocolError::PaymentPolicySequenceMismatch
    );
    let previous_fee_destination = ctx.accounts.payment_config.fee_destination;
    let previous_fee_bps = ctx.accounts.payment_config.fee_bps;
    let previous_enabled = ctx.accounts.payment_config.enabled;
    require!(
        previous_fee_destination != ctx.accounts.fee_destination.key()
            || previous_fee_bps != args.fee_bps
            || previous_enabled != args.enabled,
        SocialProtocolError::PaymentPolicySequenceMismatch
    );
    let policy_sequence = checked_increment(ctx.accounts.payment_config.policy_sequence)?;
    let updated_at_slot = Clock::get()?.slot;
    ctx.accounts.payment_config.fee_destination = ctx.accounts.fee_destination.key();
    ctx.accounts.payment_config.fee_bps = args.fee_bps;
    ctx.accounts.payment_config.policy_sequence = policy_sequence;
    ctx.accounts.payment_config.updated_at_slot = updated_at_slot;
    ctx.accounts.payment_config.enabled = args.enabled;

    emit!(PaymentConfigUpdated {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        payment_config: ctx.accounts.payment_config.key(),
        authority: ctx.accounts.authority.key(),
        previous_fee_destination,
        fee_destination: ctx.accounts.payment_config.fee_destination,
        previous_fee_bps,
        fee_bps: ctx.accounts.payment_config.fee_bps,
        previous_enabled,
        enabled: ctx.accounts.payment_config.enabled,
        policy_sequence,
        updated_at_slot,
    });
    Ok(())
}

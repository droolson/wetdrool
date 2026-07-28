use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, PAYMENT_CONFIG_SEED, PDA_PREFIX, PDA_VERSION,
        PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::PaymentConfigInitialized,
    state::{PaymentConfig, ProtocolConfig},
    validation::{checked_increment, validate_protocol_fee},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializePaymentConfigArgs {
    pub fee_bps: u16,
}

#[derive(Accounts)]
pub struct InitializePaymentConfig<'info> {
    #[account(
        seeds = [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
        bump = config.bump,
        constraint = config.version == PROTOCOL_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = payer,
        space = PaymentConfig::SPACE,
        seeds = [PDA_PREFIX, PDA_VERSION, PAYMENT_CONFIG_SEED],
        bump
    )]
    pub payment_config: Account<'info, PaymentConfig>,
    #[account(
        constraint = social_protocol_program.programdata_address()? == Some(program_data.key())
            @ SocialProtocolError::UnauthorizedPaymentBootstrap
    )]
    pub social_protocol_program: Program<'info, crate::program::SocialProtocol>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key())
            @ SocialProtocolError::UnauthorizedPaymentBootstrap
    )]
    pub program_data: Account<'info, ProgramData>,
    pub upgrade_authority: Signer<'info>,
    pub payment_authority: Signer<'info>,
    pub fee_destination: SystemAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_payment_config(
    ctx: Context<InitializePaymentConfig>,
    args: InitializePaymentConfigArgs,
) -> Result<()> {
    validate_protocol_fee(args.fee_bps)?;
    require!(
        ctx.accounts.payment_authority.key() != Pubkey::default(),
        SocialProtocolError::InvalidPaymentAuthority
    );
    let initialized_at_slot = Clock::get()?.slot;
    let policy_sequence = checked_increment(0)?;
    let payment_config = &mut ctx.accounts.payment_config;
    payment_config.version = ACCOUNT_VERSION;
    payment_config.config = ctx.accounts.config.key();
    payment_config.authority = ctx.accounts.payment_authority.key();
    payment_config.fee_destination = ctx.accounts.fee_destination.key();
    payment_config.fee_bps = args.fee_bps;
    payment_config.policy_sequence = policy_sequence;
    payment_config.initialized_at_slot = initialized_at_slot;
    payment_config.updated_at_slot = initialized_at_slot;
    payment_config.enabled = false;
    payment_config.bump = ctx.bumps.payment_config;

    emit!(PaymentConfigInitialized {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        payment_config: payment_config.key(),
        upgrade_authority: ctx.accounts.upgrade_authority.key(),
        payment_authority: payment_config.authority,
        fee_destination: payment_config.fee_destination,
        fee_bps: payment_config.fee_bps,
        policy_sequence,
        enabled: false,
        initialized_at_slot,
    });
    Ok(())
}

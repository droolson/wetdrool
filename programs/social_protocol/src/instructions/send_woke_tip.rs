use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, PAYMENT_CONFIG_SEED, PAYMENT_RECEIPT_SEED,
        PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::WokeTipSettled,
    state::{Identity, PaymentConfig, PaymentKind, PaymentReceipt, PaymentSplit, ProtocolConfig},
    validation::{
        calculate_native_payment_allocation, validate_payment_aliases,
        validate_payment_config_snapshot, validate_payment_identity, validate_payment_nonce,
        validate_payment_source,
    },
};

use super::payment_common::transfer_lamports;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SendWokeTipArgs {
    pub receipt_nonce: [u8; crate::constants::NONCE_BYTES],
    pub expected_payment_policy_sequence: u64,
    pub expected_fee_bps: u16,
    pub expected_fee_destination: Pubkey,
    pub expected_payer_root_rotation_count: u64,
    pub expected_recipient_identity: Pubkey,
    pub expected_recipient_destination: Pubkey,
    pub gross_lamports: u64,
}

#[derive(Accounts)]
#[instruction(args: SendWokeTipArgs)]
pub struct SendWokeTip<'info> {
    #[account(
        seeds = [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
        bump = config.bump,
        constraint = config.version == PROTOCOL_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [PDA_PREFIX, PDA_VERSION, PAYMENT_CONFIG_SEED],
        bump = payment_config.bump,
        has_one = config @ SocialProtocolError::PaymentConfigSubstitution,
        constraint = payment_config.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub payment_config: Box<Account<'info, PaymentConfig>>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            payer_identity.origin_authority.as_ref(),
            payer_identity.identity_nonce.as_ref()
        ],
        bump = payer_identity.bump,
        has_one = config @ SocialProtocolError::PaymentSourceSubstitution,
        constraint = payer_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub payer_identity: Box<Account<'info, Identity>>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            recipient_identity.origin_authority.as_ref(),
            recipient_identity.identity_nonce.as_ref()
        ],
        bump = recipient_identity.bump,
        has_one = config @ SocialProtocolError::PaymentRecipientSubstitution,
        constraint = recipient_identity.active @ SocialProtocolError::InvalidPaymentRecipient
    )]
    pub recipient_identity: Box<Account<'info, Identity>>,
    #[account(
        init_if_needed,
        payer = rent_payer,
        space = PaymentReceipt::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            PAYMENT_RECEIPT_SEED,
            payer_identity.key().as_ref(),
            args.receipt_nonce.as_ref()
        ],
        bump
    )]
    pub receipt: Box<Account<'info, PaymentReceipt>>,
    #[account(
        mut,
        constraint = payer_authority.to_account_info().owner == &anchor_lang::system_program::ID
            @ SocialProtocolError::PaymentSourceSubstitution
    )]
    pub payer_authority: Signer<'info>,
    #[account(mut)]
    pub recipient_destination: SystemAccount<'info>,
    #[account(
        mut,
        address = payment_config.fee_destination
            @ SocialProtocolError::PaymentConfigSubstitution
    )]
    pub fee_destination: SystemAccount<'info>,
    #[account(mut)]
    pub rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_send_woke_tip(ctx: Context<SendWokeTip>, args: SendWokeTipArgs) -> Result<()> {
    validate_payment_nonce(&args.receipt_nonce)?;
    require!(
        ctx.accounts.receipt.version == 0,
        SocialProtocolError::PaymentReceiptAlreadyExists
    );
    validate_payment_config_snapshot(
        &ctx.accounts.payment_config,
        args.expected_payment_policy_sequence,
        args.expected_fee_bps,
        args.expected_fee_destination,
    )?;
    require_keys_eq!(
        ctx.accounts.recipient_identity.key(),
        args.expected_recipient_identity,
        SocialProtocolError::PaymentRecipientSubstitution
    );
    require_keys_eq!(
        ctx.accounts.recipient_destination.key(),
        args.expected_recipient_destination,
        SocialProtocolError::PaymentRecipientSubstitution
    );
    require_keys_eq!(
        ctx.accounts.fee_destination.key(),
        args.expected_fee_destination,
        SocialProtocolError::PaymentConfigSubstitution
    );
    validate_payment_source(
        ctx.accounts.payer_identity.key(),
        &ctx.accounts.payer_identity,
        ctx.accounts.config.key(),
        ctx.accounts.payer_authority.key(),
        args.expected_payer_root_rotation_count,
    )?;
    validate_payment_identity(
        ctx.accounts.recipient_identity.key(),
        &ctx.accounts.recipient_identity,
        ctx.accounts.config.key(),
        ctx.accounts.recipient_destination.key(),
    )?;
    let split = PaymentSplit {
        recipient_identity: ctx.accounts.recipient_identity.key(),
        destination: ctx.accounts.recipient_destination.key(),
        basis_points: 10_000,
    };
    validate_payment_aliases(
        ctx.accounts.payer_identity.key(),
        ctx.accounts.payer_authority.key(),
        ctx.accounts.fee_destination.key(),
        &[split],
    )?;
    let allocation = calculate_native_payment_allocation(
        args.gross_lamports,
        ctx.accounts.payment_config.fee_bps,
        &[split],
    )?;
    let recipient_lamports = *allocation
        .recipient_amounts
        .first()
        .ok_or_else(|| error!(SocialProtocolError::PaymentConservationInvariant))?;
    let clock = Clock::get()?;

    transfer_lamports(
        &ctx.accounts.payer_authority,
        &ctx.accounts.fee_destination,
        &ctx.accounts.system_program,
        allocation.fee_lamports,
    )?;
    transfer_lamports(
        &ctx.accounts.payer_authority,
        &ctx.accounts.recipient_destination,
        &ctx.accounts.system_program,
        recipient_lamports,
    )?;

    let receipt = &mut ctx.accounts.receipt;
    receipt.version = ACCOUNT_VERSION;
    receipt.config = ctx.accounts.config.key();
    receipt.payment_config = ctx.accounts.payment_config.key();
    receipt.terms_reference = ctx.accounts.recipient_identity.key();
    receipt.payer_identity = ctx.accounts.payer_identity.key();
    receipt.payer_authority = ctx.accounts.payer_authority.key();
    receipt.subject_identity = ctx.accounts.recipient_identity.key();
    receipt.primary_recipient_destination = ctx.accounts.recipient_destination.key();
    receipt.fee_destination = ctx.accounts.fee_destination.key();
    receipt.receipt_nonce = args.receipt_nonce;
    receipt.kind = PaymentKind::WokeTip;
    receipt.payment_policy_sequence = ctx.accounts.payment_config.policy_sequence;
    receipt.terms_state_sequence = 0;
    receipt.terms_manifest_hash = [0; crate::constants::MANIFEST_HASH_BYTES];
    receipt.payer_root_rotation_count = ctx.accounts.payer_identity.root_rotation_count;
    receipt.gross_lamports = args.gross_lamports;
    receipt.fee_bps = ctx.accounts.payment_config.fee_bps;
    receipt.fee_lamports = allocation.fee_lamports;
    receipt.distributable_lamports = allocation.distributable_lamports;
    receipt.recipient_amounts = allocation.recipient_amounts;
    receipt.refund_policy_hash = [0; crate::constants::MANIFEST_HASH_BYTES];
    receipt.entitlement_from_timestamp = 0;
    receipt.entitlement_until_timestamp = 0;
    receipt.paid_at_timestamp = clock.unix_timestamp;
    receipt.paid_at_slot = clock.slot;
    receipt.bump = ctx.bumps.receipt;

    emit!(WokeTipSettled {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        payment_config: ctx.accounts.payment_config.key(),
        receipt: receipt.key(),
        payer_identity: ctx.accounts.payer_identity.key(),
        payer_authority: ctx.accounts.payer_authority.key(),
        recipient_identity: ctx.accounts.recipient_identity.key(),
        recipient_destination: ctx.accounts.recipient_destination.key(),
        receipt_nonce: args.receipt_nonce,
        payment_kind: PaymentKind::WokeTip,
        payer_root_rotation_count: ctx.accounts.payer_identity.root_rotation_count,
        payment_policy_sequence: ctx.accounts.payment_config.policy_sequence,
        gross_lamports: args.gross_lamports,
        fee_bps: ctx.accounts.payment_config.fee_bps,
        fee_destination: ctx.accounts.fee_destination.key(),
        fee_lamports: allocation.fee_lamports,
        distributable_lamports: allocation.distributable_lamports,
        recipient_lamports,
        paid_at_timestamp: clock.unix_timestamp,
        paid_at_slot: clock.slot,
    });
    Ok(())
}

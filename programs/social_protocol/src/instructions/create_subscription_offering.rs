use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, PAYMENT_CONFIG_SEED, PDA_PREFIX, PDA_VERSION,
        PROTOCOL_VERSION, SUBSCRIPTION_OFFERING_SEED,
    },
    errors::SocialProtocolError,
    events::SubscriptionOfferingCreated,
    state::{
        CreatorSubscriptionOffering, Identity, PaymentConfig, ProtocolConfig, SubscriptionInterval,
    },
    validation::{
        calculate_legacy_lamport_payment_allocation, checked_increment, checked_next_sequence,
        validate_legacy_lamport_payment_execution, validate_manifest, validate_nonzero_hash,
        validate_protocol_fee, validate_subscription_splits,
    },
};

use super::payment_common::collect_subscription_splits;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateSubscriptionOfferingArgs {
    pub expected_creator_sequence: u64,
    pub offering_nonce: [u8; crate::constants::NONCE_BYTES],
    pub manifest_hash: [u8; crate::constants::MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub price_lamports: u64,
    pub refund_policy_hash: [u8; crate::constants::MANIFEST_HASH_BYTES],
    pub max_protocol_fee_bps: u16,
    pub creator_basis_points: u16,
    pub additional_recipient_basis_points: Vec<u16>,
}

#[derive(Accounts)]
#[instruction(args: CreateSubscriptionOfferingArgs)]
pub struct CreateSubscriptionOffering<'info> {
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
        mut,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            creator_identity.origin_authority.as_ref(),
            creator_identity.identity_nonce.as_ref()
        ],
        bump = creator_identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        has_one = root_authority @ SocialProtocolError::Unauthorized,
        constraint = creator_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub creator_identity: Box<Account<'info, Identity>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = CreatorSubscriptionOffering::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            SUBSCRIPTION_OFFERING_SEED,
            creator_identity.key().as_ref(),
            args.offering_nonce.as_ref()
        ],
        bump
    )]
    pub offering: Box<Account<'info, CreatorSubscriptionOffering>>,
    #[account(
        constraint = root_authority.to_account_info().owner == &anchor_lang::system_program::ID
            @ SocialProtocolError::PaymentRecipientSubstitution
    )]
    pub root_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub recipient_identity_0: Option<Box<Account<'info, Identity>>>,
    pub recipient_destination_0: Option<SystemAccount<'info>>,
    pub recipient_identity_1: Option<Box<Account<'info, Identity>>>,
    pub recipient_destination_1: Option<SystemAccount<'info>>,
}

pub fn handle_create_subscription_offering(
    ctx: Context<CreateSubscriptionOffering>,
    args: CreateSubscriptionOfferingArgs,
) -> Result<()> {
    validate_legacy_lamport_payment_execution()?;
    require!(
        args.offering_nonce.iter().any(|byte| *byte != 0),
        SocialProtocolError::InvalidPaymentNonce
    );
    validate_manifest(&args.manifest_hash, &args.manifest_uri)?;
    validate_nonzero_hash(&args.refund_policy_hash)?;
    validate_protocol_fee(args.max_protocol_fee_bps)?;
    require!(
        ctx.accounts.payment_config.fee_bps <= args.max_protocol_fee_bps,
        SocialProtocolError::InvalidProtocolFee
    );
    require!(
        ctx.accounts.offering.version == 0,
        SocialProtocolError::SubscriptionOfferingAlreadyExists
    );

    let config_key = ctx.accounts.config.key();
    let creator_identity_key = ctx.accounts.creator_identity.key();
    let recipient_splits = collect_subscription_splits(
        config_key,
        &ctx.accounts.creator_identity,
        ctx.accounts.root_authority.key(),
        args.creator_basis_points,
        &args.additional_recipient_basis_points,
        ctx.accounts.recipient_identity_0.as_deref(),
        ctx.accounts.recipient_destination_0.as_ref(),
        ctx.accounts.recipient_identity_1.as_deref(),
        ctx.accounts.recipient_destination_1.as_ref(),
    )?;
    let creator_split_index = validate_subscription_splits(
        &recipient_splits,
        creator_identity_key,
        ctx.accounts.root_authority.key(),
    )?;
    calculate_legacy_lamport_payment_allocation(
        args.price_lamports,
        args.max_protocol_fee_bps,
        &recipient_splits,
    )?;

    let created_at_slot = Clock::get()?.slot;
    let creator_sequence = checked_next_sequence(
        ctx.accounts.creator_identity.sequence,
        args.expected_creator_sequence,
    )?;
    let offering_state_sequence = checked_increment(0)?;
    ctx.accounts.creator_identity.sequence = creator_sequence;

    let offering = &mut ctx.accounts.offering;
    offering.version = ACCOUNT_VERSION;
    offering.config = config_key;
    offering.creator_identity = creator_identity_key;
    offering.offering_nonce = args.offering_nonce;
    offering.manifest_hash = args.manifest_hash;
    offering.manifest_uri = args.manifest_uri.clone();
    offering.price_lamports = args.price_lamports;
    offering.billing_interval = SubscriptionInterval::Week;
    offering.recipient_splits = recipient_splits.clone();
    offering.refund_policy_hash = args.refund_policy_hash;
    offering.max_protocol_fee_bps = args.max_protocol_fee_bps;
    offering.creator_root_rotation_count = ctx.accounts.creator_identity.root_rotation_count;
    offering.creator_sequence = creator_sequence;
    offering.state_sequence = offering_state_sequence;
    offering.created_at_slot = created_at_slot;
    offering.updated_at_slot = created_at_slot;
    offering.active = true;
    offering.retired_at_slot = None;
    offering.creator_split_index = creator_split_index;
    offering.bump = ctx.bumps.offering;

    emit!(SubscriptionOfferingCreated {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        payment_config: ctx.accounts.payment_config.key(),
        offering: offering.key(),
        creator_identity: creator_identity_key,
        root_authority: ctx.accounts.root_authority.key(),
        offering_nonce: offering.offering_nonce,
        manifest_hash: offering.manifest_hash,
        manifest_uri: args.manifest_uri,
        price_lamports: offering.price_lamports,
        billing_interval: offering.billing_interval,
        recipient_splits,
        refund_policy_hash: offering.refund_policy_hash,
        max_protocol_fee_bps: offering.max_protocol_fee_bps,
        creator_root_rotation_count: offering.creator_root_rotation_count,
        creator_sequence,
        offering_state_sequence,
        created_at_slot,
    });
    Ok(())
}

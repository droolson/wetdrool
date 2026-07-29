use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, PAYMENT_CONFIG_SEED, PAYMENT_RECEIPT_SEED,
        PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION, SUBSCRIPTION_ENTITLEMENT_SEED,
        SUBSCRIPTION_OFFERING_SEED,
    },
    errors::SocialProtocolError,
    events::SubscriptionSettled,
    state::{
        CreatorSubscriptionOffering, Identity, PaymentConfig, PaymentKind, PaymentReceipt,
        ProtocolConfig, SubscriptionEntitlement, SubscriptionInterval,
    },
    validation::{
        calculate_legacy_lamport_payment_allocation, calculate_subscription_window,
        checked_increment, validate_legacy_lamport_payment_execution, validate_payment_aliases,
        validate_payment_config_snapshot, validate_payment_nonce, validate_payment_source,
        validate_subscription_splits,
    },
};

use super::payment_common::{collect_offering_payment_splits, transfer_payment_allocations};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SettleSubscriptionArgs {
    pub receipt_nonce: [u8; crate::constants::NONCE_BYTES],
    pub expected_payment_policy_sequence: u64,
    pub expected_fee_bps: u16,
    pub expected_fee_destination: Pubkey,
    pub expected_payer_root_rotation_count: u64,
    pub expected_offering_state_sequence: u64,
    pub expected_offering_manifest_hash: [u8; crate::constants::MANIFEST_HASH_BYTES],
    pub expected_refund_policy_hash: [u8; crate::constants::MANIFEST_HASH_BYTES],
    pub expected_price_lamports: u64,
    pub expected_entitlement_state_sequence: u64,
}

#[derive(Accounts)]
#[instruction(args: SettleSubscriptionArgs)]
pub struct SettleSubscription<'info> {
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
            creator_identity.origin_authority.as_ref(),
            creator_identity.identity_nonce.as_ref()
        ],
        bump = creator_identity.bump,
        has_one = config @ SocialProtocolError::SubscriptionOfferingSubstitution,
        constraint = creator_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub creator_identity: Box<Account<'info, Identity>>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            SUBSCRIPTION_OFFERING_SEED,
            creator_identity.key().as_ref(),
            offering.offering_nonce.as_ref()
        ],
        bump = offering.bump,
        has_one = config @ SocialProtocolError::SubscriptionOfferingSubstitution,
        has_one = creator_identity @ SocialProtocolError::SubscriptionOfferingSubstitution,
        constraint = offering.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub offering: Box<Account<'info, CreatorSubscriptionOffering>>,
    #[account(
        init_if_needed,
        payer = rent_payer,
        space = SubscriptionEntitlement::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            SUBSCRIPTION_ENTITLEMENT_SEED,
            offering.key().as_ref(),
            payer_identity.key().as_ref()
        ],
        bump
    )]
    pub entitlement: Box<Account<'info, SubscriptionEntitlement>>,
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
    pub creator_destination: SystemAccount<'info>,
    #[account(
        mut,
        address = payment_config.fee_destination
            @ SocialProtocolError::PaymentConfigSubstitution
    )]
    pub fee_destination: SystemAccount<'info>,
    #[account(mut)]
    pub rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub recipient_identity_0: Option<Box<Account<'info, Identity>>>,
    #[account(mut)]
    pub recipient_destination_0: Option<SystemAccount<'info>>,
    pub recipient_identity_1: Option<Box<Account<'info, Identity>>>,
    #[account(mut)]
    pub recipient_destination_1: Option<SystemAccount<'info>>,
}

pub fn handle_settle_subscription(
    ctx: Context<SettleSubscription>,
    args: SettleSubscriptionArgs,
) -> Result<()> {
    validate_legacy_lamport_payment_execution()?;
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
    require!(
        ctx.accounts.offering.active && ctx.accounts.offering.retired_at_slot.is_none(),
        SocialProtocolError::SubscriptionOfferingInactive
    );
    require_eq!(
        ctx.accounts.offering.creator_root_rotation_count,
        ctx.accounts.creator_identity.root_rotation_count,
        SocialProtocolError::SubscriptionOfferingStaleCreator
    );
    require_eq!(
        ctx.accounts.offering.state_sequence,
        args.expected_offering_state_sequence,
        SocialProtocolError::SubscriptionOfferingSequenceMismatch
    );
    require!(
        ctx.accounts.offering.billing_interval == SubscriptionInterval::Week
            && ctx.accounts.offering.manifest_hash == args.expected_offering_manifest_hash
            && ctx.accounts.offering.refund_policy_hash == args.expected_refund_policy_hash
            && ctx.accounts.offering.price_lamports == args.expected_price_lamports,
        SocialProtocolError::SubscriptionTermsMismatch
    );
    require!(
        ctx.accounts.payment_config.fee_bps <= ctx.accounts.offering.max_protocol_fee_bps,
        SocialProtocolError::InvalidProtocolFee
    );
    require_keys_eq!(
        ctx.accounts.creator_destination.key(),
        ctx.accounts.creator_identity.root_authority,
        SocialProtocolError::PaymentRecipientSubstitution
    );

    let recipient_splits = collect_offering_payment_splits(
        ctx.accounts.config.key(),
        &ctx.accounts.offering.recipient_splits,
        &ctx.accounts.creator_identity,
        ctx.accounts.creator_destination.key(),
        ctx.accounts.recipient_identity_0.as_deref(),
        ctx.accounts.recipient_destination_0.as_ref(),
        ctx.accounts.recipient_identity_1.as_deref(),
        ctx.accounts.recipient_destination_1.as_ref(),
    )?;
    let creator_split_index = validate_subscription_splits(
        &recipient_splits,
        ctx.accounts.creator_identity.key(),
        ctx.accounts.creator_destination.key(),
    )?;
    require_eq!(
        creator_split_index,
        ctx.accounts.offering.creator_split_index,
        SocialProtocolError::SubscriptionOfferingSubstitution
    );
    validate_payment_aliases(
        ctx.accounts.payer_identity.key(),
        ctx.accounts.payer_authority.key(),
        ctx.accounts.fee_destination.key(),
        &recipient_splits,
    )?;
    let allocation = calculate_legacy_lamport_payment_allocation(
        ctx.accounts.offering.price_lamports,
        ctx.accounts.payment_config.fee_bps,
        &recipient_splits,
    )?;

    let entitlement_is_new = ctx.accounts.entitlement.version == 0;
    if !entitlement_is_new {
        require_eq!(
            ctx.accounts.entitlement.version,
            ACCOUNT_VERSION,
            SocialProtocolError::UnsupportedProtocolVersion
        );
        require_keys_eq!(
            ctx.accounts.entitlement.config,
            ctx.accounts.config.key(),
            SocialProtocolError::EntitlementSubstitution
        );
        require_keys_eq!(
            ctx.accounts.entitlement.offering,
            ctx.accounts.offering.key(),
            SocialProtocolError::EntitlementSubstitution
        );
        require_keys_eq!(
            ctx.accounts.entitlement.beneficiary_identity,
            ctx.accounts.payer_identity.key(),
            SocialProtocolError::EntitlementSubstitution
        );
        require!(
            ctx.accounts.entitlement.refund_policy_hash == ctx.accounts.offering.refund_policy_hash,
            SocialProtocolError::EntitlementSubstitution
        );
    }
    require_eq!(
        ctx.accounts.entitlement.state_sequence,
        args.expected_entitlement_state_sequence,
        SocialProtocolError::EntitlementSequenceMismatch
    );

    let clock = Clock::get()?;
    let prior_valid_until = if entitlement_is_new {
        0
    } else {
        ctx.accounts.entitlement.valid_until_timestamp
    };
    let (entitlement_from_timestamp, entitlement_until_timestamp) =
        calculate_subscription_window(clock.unix_timestamp, prior_valid_until)?;
    let entitlement_state_sequence = checked_increment(ctx.accounts.entitlement.state_sequence)?;
    let settlement_count = checked_increment(ctx.accounts.entitlement.settlement_count)?;

    transfer_payment_allocations(
        &ctx.accounts.payer_authority,
        &ctx.accounts.fee_destination,
        &ctx.accounts.creator_destination,
        ctx.accounts.recipient_destination_0.as_ref(),
        ctx.accounts.recipient_destination_1.as_ref(),
        &ctx.accounts.system_program,
        allocation.fee_lamports,
        &recipient_splits,
        &allocation.recipient_amounts,
    )?;

    let primary_recipient_destination = recipient_splits
        .get(usize::from(creator_split_index))
        .map(|split| split.destination)
        .ok_or_else(|| error!(SocialProtocolError::SubscriptionOfferingSubstitution))?;
    let receipt_key = ctx.accounts.receipt.key();
    let receipt = &mut ctx.accounts.receipt;
    receipt.version = ACCOUNT_VERSION;
    receipt.config = ctx.accounts.config.key();
    receipt.payment_config = ctx.accounts.payment_config.key();
    receipt.terms_reference = ctx.accounts.offering.key();
    receipt.payer_identity = ctx.accounts.payer_identity.key();
    receipt.payer_authority = ctx.accounts.payer_authority.key();
    receipt.subject_identity = ctx.accounts.payer_identity.key();
    receipt.primary_recipient_destination = primary_recipient_destination;
    receipt.fee_destination = ctx.accounts.fee_destination.key();
    receipt.receipt_nonce = args.receipt_nonce;
    receipt.kind = PaymentKind::WeeklySubscription;
    receipt.payment_policy_sequence = ctx.accounts.payment_config.policy_sequence;
    receipt.terms_state_sequence = ctx.accounts.offering.state_sequence;
    receipt.terms_manifest_hash = ctx.accounts.offering.manifest_hash;
    receipt.payer_root_rotation_count = ctx.accounts.payer_identity.root_rotation_count;
    receipt.gross_lamports = ctx.accounts.offering.price_lamports;
    receipt.fee_bps = ctx.accounts.payment_config.fee_bps;
    receipt.fee_lamports = allocation.fee_lamports;
    receipt.distributable_lamports = allocation.distributable_lamports;
    receipt.recipient_amounts = allocation.recipient_amounts.clone();
    receipt.refund_policy_hash = ctx.accounts.offering.refund_policy_hash;
    receipt.entitlement_from_timestamp = entitlement_from_timestamp;
    receipt.entitlement_until_timestamp = entitlement_until_timestamp;
    receipt.paid_at_timestamp = clock.unix_timestamp;
    receipt.paid_at_slot = clock.slot;
    receipt.bump = ctx.bumps.receipt;

    let entitlement = &mut ctx.accounts.entitlement;
    if entitlement_is_new {
        entitlement.version = ACCOUNT_VERSION;
        entitlement.config = ctx.accounts.config.key();
        entitlement.offering = ctx.accounts.offering.key();
        entitlement.beneficiary_identity = ctx.accounts.payer_identity.key();
        entitlement.started_at_timestamp = entitlement_from_timestamp;
        entitlement.refund_policy_hash = ctx.accounts.offering.refund_policy_hash;
        entitlement.bump = ctx.bumps.entitlement;
    }
    entitlement.valid_until_timestamp = entitlement_until_timestamp;
    entitlement.settlement_count = settlement_count;
    entitlement.last_receipt = receipt_key;
    entitlement.state_sequence = entitlement_state_sequence;
    entitlement.last_settled_at_slot = clock.slot;

    emit!(SubscriptionSettled {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        payment_config: ctx.accounts.payment_config.key(),
        offering: ctx.accounts.offering.key(),
        receipt: receipt_key,
        entitlement: entitlement.key(),
        creator_identity: ctx.accounts.creator_identity.key(),
        payer_identity: ctx.accounts.payer_identity.key(),
        payer_authority: ctx.accounts.payer_authority.key(),
        receipt_nonce: args.receipt_nonce,
        payment_kind: PaymentKind::WeeklySubscription,
        payer_root_rotation_count: ctx.accounts.payer_identity.root_rotation_count,
        payment_policy_sequence: ctx.accounts.payment_config.policy_sequence,
        offering_state_sequence: ctx.accounts.offering.state_sequence,
        offering_manifest_hash: ctx.accounts.offering.manifest_hash,
        refund_policy_hash: ctx.accounts.offering.refund_policy_hash,
        gross_lamports: ctx.accounts.offering.price_lamports,
        fee_bps: ctx.accounts.payment_config.fee_bps,
        fee_destination: ctx.accounts.fee_destination.key(),
        fee_lamports: allocation.fee_lamports,
        distributable_lamports: allocation.distributable_lamports,
        recipient_splits,
        recipient_amounts: allocation.recipient_amounts,
        entitlement_state_sequence,
        settlement_count,
        entitlement_from_timestamp,
        entitlement_until_timestamp,
        paid_at_timestamp: clock.unix_timestamp,
        paid_at_slot: clock.slot,
    });
    Ok(())
}

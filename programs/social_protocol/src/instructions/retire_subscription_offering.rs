use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION,
        SUBSCRIPTION_OFFERING_SEED,
    },
    errors::SocialProtocolError,
    events::SubscriptionOfferingRetired,
    state::{CreatorSubscriptionOffering, Identity, ProtocolConfig},
    validation::{checked_increment, checked_next_sequence},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RetireSubscriptionOfferingArgs {
    pub expected_creator_sequence: u64,
    pub expected_offering_state_sequence: u64,
}

#[derive(Accounts)]
pub struct RetireSubscriptionOffering<'info> {
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
            creator_identity.origin_authority.as_ref(),
            creator_identity.identity_nonce.as_ref()
        ],
        bump = creator_identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        has_one = root_authority @ SocialProtocolError::Unauthorized,
        constraint = creator_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub creator_identity: Account<'info, Identity>,
    #[account(
        mut,
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
    pub offering: Account<'info, CreatorSubscriptionOffering>,
    pub root_authority: Signer<'info>,
}

pub fn handle_retire_subscription_offering(
    ctx: Context<RetireSubscriptionOffering>,
    args: RetireSubscriptionOfferingArgs,
) -> Result<()> {
    require!(
        ctx.accounts.offering.active && ctx.accounts.offering.retired_at_slot.is_none(),
        SocialProtocolError::SubscriptionOfferingAlreadyRetired
    );
    require_eq!(
        ctx.accounts.offering.state_sequence,
        args.expected_offering_state_sequence,
        SocialProtocolError::SubscriptionOfferingSequenceMismatch
    );
    let creator_sequence = checked_next_sequence(
        ctx.accounts.creator_identity.sequence,
        args.expected_creator_sequence,
    )?;
    let offering_state_sequence = checked_increment(ctx.accounts.offering.state_sequence)?;
    let retired_at_slot = Clock::get()?.slot;
    ctx.accounts.creator_identity.sequence = creator_sequence;
    ctx.accounts.offering.creator_sequence = creator_sequence;
    ctx.accounts.offering.state_sequence = offering_state_sequence;
    ctx.accounts.offering.updated_at_slot = retired_at_slot;
    ctx.accounts.offering.active = false;
    ctx.accounts.offering.retired_at_slot = Some(retired_at_slot);

    emit!(SubscriptionOfferingRetired {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        offering: ctx.accounts.offering.key(),
        creator_identity: ctx.accounts.creator_identity.key(),
        root_authority: ctx.accounts.root_authority.key(),
        manifest_hash: ctx.accounts.offering.manifest_hash,
        creator_sequence,
        offering_state_sequence,
        retired_at_slot,
    });
    Ok(())
}

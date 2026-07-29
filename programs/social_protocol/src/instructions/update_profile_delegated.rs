use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, DELEGATION_SEED, IDENTITY_SEED, MANIFEST_HASH_BYTES,
        PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION, SCOPE_PROFILE,
    },
    errors::SocialProtocolError,
    events::ProfileReferenceUpdated,
    state::{Delegation, Identity, ProtocolConfig},
    validation::{
        authorize_identity_action, checked_next_sequence, validate_manifest,
        validate_profile_schema_version,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateProfileDelegatedArgs {
    pub expected_sequence: u64,
    pub profile_schema_version: u16,
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
}

#[derive(Accounts)]
pub struct UpdateProfileDelegated<'info> {
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
        constraint = identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub identity: Account<'info, Identity>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            DELEGATION_SEED,
            identity.key().as_ref(),
            delegate_authority.key().as_ref(),
            delegation.delegation_sequence.to_le_bytes().as_ref()
        ],
        bump = delegation.bump,
        has_one = config @ SocialProtocolError::DelegationSubstitution,
        has_one = identity @ SocialProtocolError::DelegationSubstitution,
        has_one = delegate_authority @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub delegation: Account<'info, Delegation>,
    pub delegate_authority: Signer<'info>,
}

pub fn handle_update_profile_delegated(
    ctx: Context<UpdateProfileDelegated>,
    args: UpdateProfileDelegatedArgs,
) -> Result<()> {
    validate_profile_schema_version(args.profile_schema_version)?;
    validate_manifest(&args.manifest_hash, &args.manifest_uri)?;
    let updated_at_slot = Clock::get()?.slot;
    authorize_identity_action(
        ctx.accounts.identity.key(),
        &ctx.accounts.identity,
        ctx.accounts.delegate_authority.key(),
        Some(&ctx.accounts.delegation),
        SCOPE_PROFILE,
        updated_at_slot,
    )?;

    let next_sequence =
        checked_next_sequence(ctx.accounts.identity.sequence, args.expected_sequence)?;
    let previous_manifest_hash = ctx.accounts.identity.profile_manifest_hash;

    ctx.accounts.identity.sequence = next_sequence;
    ctx.accounts.identity.profile_sequence = next_sequence;
    ctx.accounts.identity.profile_manifest_hash = args.manifest_hash;
    ctx.accounts.identity.profile_manifest_uri = args.manifest_uri.clone();
    ctx.accounts.identity.profile_updated_at_slot = updated_at_slot;

    emit!(ProfileReferenceUpdated {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        authority: ctx.accounts.delegate_authority.key(),
        sequence: next_sequence,
        previous_manifest_hash,
        manifest_hash: args.manifest_hash,
        manifest_uri: args.manifest_uri,
        updated_at_slot,
        profile_schema_version: args.profile_schema_version,
    });

    Ok(())
}

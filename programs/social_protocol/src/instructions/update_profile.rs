use anchor_lang::prelude::*;

use crate::{
    constants::{
        CONFIG_SEED, IDENTITY_SEED, MANIFEST_HASH_BYTES, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::ProfileReferenceUpdated,
    state::{Identity, ProtocolConfig},
    validation::{checked_next_sequence, validate_manifest},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateProfileArgs {
    pub expected_sequence: u64,
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
}

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
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
    pub root_authority: Signer<'info>,
}

pub fn handle_update_profile(ctx: Context<UpdateProfile>, args: UpdateProfileArgs) -> Result<()> {
    validate_manifest(&args.manifest_hash, &args.manifest_uri)?;

    let updated_at_slot = Clock::get()?.slot;
    let config_key = ctx.accounts.config.key();
    let identity_key = ctx.accounts.identity.key();
    let authority = ctx.accounts.root_authority.key();
    let identity = &mut ctx.accounts.identity;
    let next_sequence = checked_next_sequence(identity.sequence, args.expected_sequence)?;
    let previous_manifest_hash = identity.profile_manifest_hash;

    identity.sequence = next_sequence;
    identity.profile_sequence = next_sequence;
    identity.profile_manifest_hash = args.manifest_hash;
    identity.profile_manifest_uri = args.manifest_uri.clone();
    identity.profile_updated_at_slot = updated_at_slot;

    emit!(ProfileReferenceUpdated {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        identity: identity_key,
        authority,
        sequence: next_sequence,
        previous_manifest_hash,
        manifest_hash: args.manifest_hash,
        manifest_uri: args.manifest_uri,
        updated_at_slot,
    });

    Ok(())
}

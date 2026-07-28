use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, MANIFEST_HASH_BYTES, NONCE_BYTES, PDA_PREFIX,
        PDA_VERSION, PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::IdentityCreated,
    state::{Identity, ProtocolConfig},
    validation::checked_increment,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateIdentityArgs {
    pub identity_nonce: [u8; NONCE_BYTES],
}

#[derive(Accounts)]
#[instruction(args: CreateIdentityArgs)]
pub struct CreateIdentity<'info> {
    #[account(
        mut,
        seeds = [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
        bump = config.bump,
        constraint = config.version == PROTOCOL_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = payer,
        space = Identity::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            root_authority.key().as_ref(),
            args.identity_nonce.as_ref()
        ],
        bump
    )]
    pub identity: Account<'info, Identity>,
    pub root_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_identity(
    ctx: Context<CreateIdentity>,
    args: CreateIdentityArgs,
) -> Result<()> {
    let created_at_slot = Clock::get()?.slot;
    let config_key = ctx.accounts.config.key();
    let identity_key = ctx.accounts.identity.key();
    let root_authority = ctx.accounts.root_authority.key();

    ctx.accounts.config.identity_count = checked_increment(ctx.accounts.config.identity_count)?;

    let identity = &mut ctx.accounts.identity;
    identity.version = ACCOUNT_VERSION;
    identity.config = config_key;
    identity.identity_nonce = args.identity_nonce;
    identity.origin_authority = root_authority;
    identity.root_authority = root_authority;
    identity.root_rotation_count = 0;
    identity.delegation_sequence = 0;
    identity.sequence = 0;
    identity.profile_sequence = 0;
    identity.profile_manifest_hash = [0; MANIFEST_HASH_BYTES];
    identity.profile_manifest_uri = String::new();
    identity.created_at_slot = created_at_slot;
    identity.profile_updated_at_slot = 0;
    identity.active = true;
    identity.bump = ctx.bumps.identity;

    emit!(IdentityCreated {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        identity: identity_key,
        root_authority,
        identity_nonce: args.identity_nonce,
        created_at_slot,
    });

    Ok(())
}

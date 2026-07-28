use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, MANIFEST_HASH_BYTES, NONCE_BYTES, PDA_PREFIX,
        PDA_VERSION, POST_SEED, PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::PostReferencePublished,
    state::{Identity, PostReference, ProtocolConfig},
    validation::{checked_increment, checked_next_sequence, validate_manifest},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PublishPostArgs {
    pub expected_author_sequence: u64,
    pub post_nonce: [u8; NONCE_BYTES],
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
}

#[derive(Accounts)]
#[instruction(args: PublishPostArgs)]
pub struct PublishPost<'info> {
    #[account(
        mut,
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
            author_identity.origin_authority.as_ref(),
            author_identity.identity_nonce.as_ref()
        ],
        bump = author_identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        has_one = root_authority @ SocialProtocolError::Unauthorized,
        constraint = author_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub author_identity: Account<'info, Identity>,
    #[account(
        init,
        payer = payer,
        space = PostReference::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            POST_SEED,
            author_identity.key().as_ref(),
            args.post_nonce.as_ref()
        ],
        bump
    )]
    pub post_reference: Account<'info, PostReference>,
    pub root_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_publish_post(ctx: Context<PublishPost>, args: PublishPostArgs) -> Result<()> {
    validate_manifest(&args.manifest_hash, &args.manifest_uri)?;

    let created_at_slot = Clock::get()?.slot;
    let config_key = ctx.accounts.config.key();
    let author_identity_key = ctx.accounts.author_identity.key();
    let post_reference_key = ctx.accounts.post_reference.key();
    let authority = ctx.accounts.root_authority.key();
    let next_author_sequence = checked_next_sequence(
        ctx.accounts.author_identity.sequence,
        args.expected_author_sequence,
    )?;

    ctx.accounts.author_identity.sequence = next_author_sequence;
    ctx.accounts.config.post_count = checked_increment(ctx.accounts.config.post_count)?;

    let post_reference = &mut ctx.accounts.post_reference;
    post_reference.version = ACCOUNT_VERSION;
    post_reference.config = config_key;
    post_reference.author_identity = author_identity_key;
    post_reference.post_nonce = args.post_nonce;
    post_reference.manifest_hash = args.manifest_hash;
    post_reference.manifest_uri = args.manifest_uri.clone();
    post_reference.author_sequence = next_author_sequence;
    post_reference.created_at_slot = created_at_slot;
    post_reference.tombstoned_at_slot = None;
    post_reference.bump = ctx.bumps.post_reference;

    emit!(PostReferencePublished {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        post_reference: post_reference_key,
        author_identity: author_identity_key,
        authority,
        post_nonce: args.post_nonce,
        author_sequence: next_author_sequence,
        manifest_hash: args.manifest_hash,
        manifest_uri: args.manifest_uri,
        created_at_slot,
    });

    Ok(())
}

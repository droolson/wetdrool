use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, DELEGATION_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION,
        POST_SEED, PROTOCOL_VERSION, SCOPE_POST, TOMBSTONE_SEED,
    },
    errors::SocialProtocolError,
    events::PostTombstoned,
    instructions::TombstonePostArgs,
    state::{Delegation, Identity, PostReference, ProtocolConfig, Tombstone},
    validation::{authorize_identity_action, checked_increment, checked_next_sequence},
};

#[derive(Accounts)]
#[instruction(args: TombstonePostArgs)]
pub struct TombstonePostDelegated<'info> {
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
        constraint = author_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub author_identity: Account<'info, Identity>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            DELEGATION_SEED,
            delegation.identity.as_ref(),
            delegation.delegate_authority.as_ref(),
            delegation.delegation_sequence.to_le_bytes().as_ref()
        ],
        bump = delegation.bump,
        has_one = config @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.identity == author_identity.key()
            @ SocialProtocolError::DelegationSubstitution,
        has_one = delegate_authority @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub delegation: Account<'info, Delegation>,
    pub delegate_authority: Signer<'info>,
    #[account(
        mut,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            POST_SEED,
            author_identity.key().as_ref(),
            post_reference.post_nonce.as_ref()
        ],
        bump = post_reference.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        has_one = author_identity @ SocialProtocolError::AccountSubstitution,
        constraint = post_reference.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion,
        constraint = post_reference.manifest_hash == args.target_hash
            @ SocialProtocolError::TombstoneTargetMismatch
    )]
    pub post_reference: Account<'info, PostReference>,
    #[account(
        init,
        payer = payer,
        space = Tombstone::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            TOMBSTONE_SEED,
            author_identity.key().as_ref(),
            post_reference.key().as_ref()
        ],
        bump
    )]
    pub tombstone: Account<'info, Tombstone>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_tombstone_post_delegated(
    ctx: Context<TombstonePostDelegated>,
    args: TombstonePostArgs,
) -> Result<()> {
    require!(
        ctx.accounts.post_reference.tombstoned_at_slot.is_none(),
        SocialProtocolError::PostAlreadyTombstoned
    );

    let created_at_slot = Clock::get()?.slot;
    authorize_identity_action(
        ctx.accounts.author_identity.key(),
        &ctx.accounts.author_identity,
        ctx.accounts.delegate_authority.key(),
        Some(&ctx.accounts.delegation),
        SCOPE_POST,
        created_at_slot,
    )?;

    let config_key = ctx.accounts.config.key();
    let author_identity_key = ctx.accounts.author_identity.key();
    let post_reference_key = ctx.accounts.post_reference.key();
    let tombstone_key = ctx.accounts.tombstone.key();
    let next_author_sequence = checked_next_sequence(
        ctx.accounts.author_identity.sequence,
        args.expected_author_sequence,
    )?;

    ctx.accounts.author_identity.sequence = next_author_sequence;
    ctx.accounts.config.tombstone_count = checked_increment(ctx.accounts.config.tombstone_count)?;
    ctx.accounts.post_reference.tombstoned_at_slot = Some(created_at_slot);

    let tombstone = &mut ctx.accounts.tombstone;
    tombstone.version = ACCOUNT_VERSION;
    tombstone.config = config_key;
    tombstone.author_identity = author_identity_key;
    tombstone.target_post = post_reference_key;
    tombstone.target_hash = args.target_hash;
    tombstone.author_sequence = next_author_sequence;
    tombstone.created_at_slot = created_at_slot;
    tombstone.reason = args.reason;
    tombstone.bump = ctx.bumps.tombstone;

    emit!(PostTombstoned {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        tombstone: tombstone_key,
        target_post: post_reference_key,
        author_identity: author_identity_key,
        author_sequence: next_author_sequence,
        target_hash: args.target_hash,
        reason: args.reason,
        created_at_slot,
    });

    Ok(())
}

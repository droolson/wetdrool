use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, HANDLE_SEED, IDENTITY_SEED, MANIFEST_HASH_BYTES, PDA_PREFIX,
        PDA_VERSION, PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::{HandleClaimed, HandleReleased},
    state::{HandleClaim, Identity, ProtocolConfig},
    validation::{checked_next_sequence, validate_handle_hash},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClaimHandleArgs {
    pub expected_identity_sequence: u64,
    pub handle_hash: [u8; MANIFEST_HASH_BYTES],
    pub handle: String,
}

#[derive(Accounts)]
#[instruction(args: ClaimHandleArgs)]
pub struct ClaimHandle<'info> {
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
    #[account(
        init_if_needed,
        payer = payer,
        space = HandleClaim::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            HANDLE_SEED,
            args.handle_hash.as_ref()
        ],
        bump
    )]
    pub handle_claim: Account<'info, HandleClaim>,
    pub root_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_handle(ctx: Context<ClaimHandle>, args: ClaimHandleArgs) -> Result<()> {
    validate_handle_hash(&args.handle, &args.handle_hash)?;

    let claim = &ctx.accounts.handle_claim;
    if claim.version != 0 {
        require_eq!(
            claim.version,
            ACCOUNT_VERSION,
            SocialProtocolError::UnsupportedProtocolVersion
        );
        require_keys_eq!(
            claim.config,
            ctx.accounts.config.key(),
            SocialProtocolError::HandleClaimSubstitution
        );
        require!(
            claim.handle_hash == args.handle_hash,
            SocialProtocolError::HandleClaimSubstitution
        );
        require!(
            claim.handle != args.handle,
            SocialProtocolError::HandleAlreadyClaimed
        );
        return err!(SocialProtocolError::HandleHashCollision);
    }

    let claimed_at_slot = Clock::get()?.slot;
    let next_identity_sequence = checked_next_sequence(
        ctx.accounts.identity.sequence,
        args.expected_identity_sequence,
    )?;
    ctx.accounts.identity.sequence = next_identity_sequence;

    let claim = &mut ctx.accounts.handle_claim;
    claim.version = ACCOUNT_VERSION;
    claim.config = ctx.accounts.config.key();
    claim.identity = ctx.accounts.identity.key();
    claim.handle_hash = args.handle_hash;
    claim.handle = args.handle.clone();
    claim.identity_sequence = next_identity_sequence;
    claim.claimed_at_slot = claimed_at_slot;
    claim.bump = ctx.bumps.handle_claim;

    emit!(HandleClaimed {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        handle_claim: claim.key(),
        identity: ctx.accounts.identity.key(),
        authority: ctx.accounts.root_authority.key(),
        identity_sequence: next_identity_sequence,
        handle_hash: args.handle_hash,
        handle: args.handle,
        claimed_at_slot,
    });

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ReleaseHandleArgs {
    pub expected_identity_sequence: u64,
    pub handle_hash: [u8; MANIFEST_HASH_BYTES],
    pub handle: String,
}

#[derive(Accounts)]
#[instruction(args: ReleaseHandleArgs)]
pub struct ReleaseHandle<'info> {
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
    #[account(
        mut,
        close = root_authority,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            HANDLE_SEED,
            args.handle_hash.as_ref()
        ],
        bump = handle_claim.bump,
        has_one = config @ SocialProtocolError::HandleClaimSubstitution,
        has_one = identity @ SocialProtocolError::HandleClaimSubstitution,
        constraint = handle_claim.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub handle_claim: Account<'info, HandleClaim>,
    #[account(mut)]
    pub root_authority: Signer<'info>,
}

pub fn handle_release_handle(ctx: Context<ReleaseHandle>, args: ReleaseHandleArgs) -> Result<()> {
    validate_handle_hash(&args.handle, &args.handle_hash)?;
    require!(
        ctx.accounts.handle_claim.handle_hash == args.handle_hash,
        SocialProtocolError::HandleClaimSubstitution
    );
    require!(
        ctx.accounts.handle_claim.handle == args.handle,
        SocialProtocolError::HandleClaimSubstitution
    );

    let released_at_slot = Clock::get()?.slot;
    let next_identity_sequence = checked_next_sequence(
        ctx.accounts.identity.sequence,
        args.expected_identity_sequence,
    )?;
    ctx.accounts.identity.sequence = next_identity_sequence;

    emit!(HandleReleased {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        handle_claim: ctx.accounts.handle_claim.key(),
        identity: ctx.accounts.identity.key(),
        authority: ctx.accounts.root_authority.key(),
        identity_sequence: next_identity_sequence,
        handle_hash: args.handle_hash,
        handle: args.handle,
        released_at_slot,
    });

    Ok(())
}

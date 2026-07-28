use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, COMMUNITY_SEED, CONFIG_SEED, IDENTITY_SEED, MANIFEST_HASH_BYTES,
        PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::CommunityGovernanceUpdated,
    state::{Community, Identity, ProtocolConfig},
    validation::{checked_next_sequence, validate_nonzero_hash},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateCommunityGovernanceArgs {
    pub expected_creator_sequence: u64,
    pub governance_version: u16,
    pub governance_strategy_hash: [u8; MANIFEST_HASH_BYTES],
}

#[derive(Accounts)]
pub struct UpdateCommunityGovernance<'info> {
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
            COMMUNITY_SEED,
            creator_identity.key().as_ref(),
            community.community_nonce.as_ref()
        ],
        bump = community.bump,
        has_one = config @ SocialProtocolError::CommunitySubstitution,
        has_one = creator_identity @ SocialProtocolError::CommunitySubstitution,
        constraint = community.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub community: Account<'info, Community>,
    pub root_authority: Signer<'info>,
}

pub fn handle_update_community_governance(
    ctx: Context<UpdateCommunityGovernance>,
    args: UpdateCommunityGovernanceArgs,
) -> Result<()> {
    validate_nonzero_hash(&args.governance_strategy_hash)?;
    let expected_governance_version = ctx
        .accounts
        .community
        .governance_version
        .checked_add(1)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
    require_eq!(
        args.governance_version,
        expected_governance_version,
        SocialProtocolError::GovernanceVersionMismatch
    );

    let updated_at_slot = Clock::get()?.slot;
    let next_creator_sequence = checked_next_sequence(
        ctx.accounts.creator_identity.sequence,
        args.expected_creator_sequence,
    )?;
    let previous_governance_version = ctx.accounts.community.governance_version;
    let previous_strategy_hash = ctx.accounts.community.governance_strategy_hash;

    ctx.accounts.creator_identity.sequence = next_creator_sequence;
    ctx.accounts.community.creator_sequence = next_creator_sequence;
    ctx.accounts.community.governance_version = args.governance_version;
    ctx.accounts.community.governance_strategy_hash = args.governance_strategy_hash;
    ctx.accounts.community.updated_at_slot = updated_at_slot;

    emit!(CommunityGovernanceUpdated {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        community: ctx.accounts.community.key(),
        creator_identity: ctx.accounts.creator_identity.key(),
        authority: ctx.accounts.root_authority.key(),
        creator_sequence: next_creator_sequence,
        previous_governance_version,
        governance_version: args.governance_version,
        previous_strategy_hash,
        governance_strategy_hash: args.governance_strategy_hash,
        updated_at_slot,
    });

    Ok(())
}

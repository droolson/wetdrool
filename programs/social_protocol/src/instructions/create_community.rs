use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, COMMUNITY_SEED, CONFIG_SEED, IDENTITY_SEED, MANIFEST_HASH_BYTES,
        NONCE_BYTES, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION,
    },
    errors::SocialProtocolError,
    events::CommunityCreated,
    state::{Community, CommunityMembershipPolicy, CommunityVisibility, Identity, ProtocolConfig},
    validation::{
        checked_increment, checked_next_sequence, validate_manifest, validate_nonzero_hash,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateCommunityArgs {
    pub expected_creator_sequence: u64,
    pub community_nonce: [u8; NONCE_BYTES],
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
    pub governance_version: u16,
    pub governance_strategy_hash: [u8; MANIFEST_HASH_BYTES],
    pub visibility: CommunityVisibility,
    pub membership_policy: CommunityMembershipPolicy,
}

#[derive(Accounts)]
#[instruction(args: CreateCommunityArgs)]
pub struct CreateCommunity<'info> {
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
        init,
        payer = payer,
        space = Community::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            COMMUNITY_SEED,
            creator_identity.key().as_ref(),
            args.community_nonce.as_ref()
        ],
        bump
    )]
    pub community: Account<'info, Community>,
    pub root_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_community(
    ctx: Context<CreateCommunity>,
    args: CreateCommunityArgs,
) -> Result<()> {
    validate_manifest(&args.manifest_hash, &args.manifest_uri)?;
    validate_nonzero_hash(&args.governance_strategy_hash)?;
    require!(
        args.governance_version > 0,
        SocialProtocolError::InvalidGovernanceVersion
    );

    let created_at_slot = Clock::get()?.slot;
    let next_creator_sequence = checked_next_sequence(
        ctx.accounts.creator_identity.sequence,
        args.expected_creator_sequence,
    )?;
    ctx.accounts.creator_identity.sequence = next_creator_sequence;
    ctx.accounts.config.community_count = checked_increment(ctx.accounts.config.community_count)?;

    let community = &mut ctx.accounts.community;
    community.version = ACCOUNT_VERSION;
    community.config = ctx.accounts.config.key();
    community.creator_identity = ctx.accounts.creator_identity.key();
    community.community_nonce = args.community_nonce;
    community.manifest_hash = args.manifest_hash;
    community.manifest_uri = args.manifest_uri.clone();
    community.governance_version = args.governance_version;
    community.governance_strategy_hash = args.governance_strategy_hash;
    community.visibility = args.visibility;
    community.membership_policy = args.membership_policy;
    community.membership_policy_sequence = 1;
    community.membership_sequence = 0;
    community.creator_sequence = next_creator_sequence;
    community.member_count = 0;
    community.created_at_slot = created_at_slot;
    community.updated_at_slot = created_at_slot;
    community.bump = ctx.bumps.community;

    emit!(CommunityCreated {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        community: community.key(),
        creator_identity: ctx.accounts.creator_identity.key(),
        authority: ctx.accounts.root_authority.key(),
        community_nonce: args.community_nonce,
        creator_sequence: next_creator_sequence,
        manifest_hash: args.manifest_hash,
        manifest_uri: args.manifest_uri,
        governance_version: args.governance_version,
        governance_strategy_hash: args.governance_strategy_hash,
        visibility: args.visibility,
        membership_policy: args.membership_policy,
        membership_policy_sequence: community.membership_policy_sequence,
        membership_sequence: community.membership_sequence,
        created_at_slot,
    });

    Ok(())
}

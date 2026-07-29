use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, COMMUNITY_ROLE_MEMBER, COMMUNITY_SEED, CONFIG_SEED, DELEGATION_SEED,
        IDENTITY_SEED, MANIFEST_HASH_BYTES, MEMBERSHIP_SEED, PDA_PREFIX, PDA_VERSION,
        PROTOCOL_VERSION, SCOPE_COMMUNITY,
    },
    errors::SocialProtocolError,
    events::CommunityMembershipChanged,
    state::{
        Community, CommunityMembership, CommunityMembershipAction, CommunityMembershipPolicy,
        CommunityMembershipState, CommunityVisibility, Delegation, Identity, ProtocolConfig,
    },
    validation::{
        authorize_identity_action, checked_increment, checked_next_sequence, validate_manifest,
        validate_membership_state_roles,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct JoinCommunityArgs {
    pub expected_member_sequence: u64,
    pub expected_state_sequence: u64,
    pub expected_membership_policy_sequence: u64,
    pub expected_community_membership_sequence: u64,
    pub manifest_hash: [u8; MANIFEST_HASH_BYTES],
    pub manifest_uri: String,
}

#[derive(Accounts)]
pub struct JoinCommunity<'info> {
    #[account(
        mut,
        seeds = [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
        bump = config.bump,
        constraint = config.version == PROTOCOL_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            COMMUNITY_SEED,
            community.creator_identity.as_ref(),
            community.community_nonce.as_ref()
        ],
        bump = community.bump,
        has_one = config @ SocialProtocolError::CommunitySubstitution,
        constraint = community.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub community: Box<Account<'info, Community>>,
    #[account(
        mut,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            member_identity.origin_authority.as_ref(),
            member_identity.identity_nonce.as_ref()
        ],
        bump = member_identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        constraint = member_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub member_identity: Box<Account<'info, Identity>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = CommunityMembership::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            MEMBERSHIP_SEED,
            community.key().as_ref(),
            member_identity.key().as_ref()
        ],
        bump
    )]
    pub membership: Box<Account<'info, CommunityMembership>>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            DELEGATION_SEED,
            member_identity.key().as_ref(),
            authority.key().as_ref(),
            delegation.delegation_sequence.to_le_bytes().as_ref()
        ],
        bump = delegation.bump,
        has_one = config @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.identity == member_identity.key()
            @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.delegate_authority == authority.key()
            @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub delegation: Option<Box<Account<'info, Delegation>>>,
}

pub fn handle_join_community(ctx: Context<JoinCommunity>, args: JoinCommunityArgs) -> Result<()> {
    validate_manifest(&args.manifest_hash, &args.manifest_uri)?;
    require!(
        matches!(
            ctx.accounts.community.visibility,
            CommunityVisibility::Public | CommunityVisibility::Unlisted
        ),
        SocialProtocolError::CommunityNotPublic
    );
    require!(
        ctx.accounts.community.membership_policy == CommunityMembershipPolicy::Open,
        SocialProtocolError::CommunityMembershipNotOpen
    );
    require_eq!(
        ctx.accounts.community.membership_policy_sequence,
        args.expected_membership_policy_sequence,
        SocialProtocolError::MembershipPolicySequenceMismatch
    );
    require_eq!(
        ctx.accounts.community.membership_sequence,
        args.expected_community_membership_sequence,
        SocialProtocolError::CommunityMembershipSequenceMismatch
    );

    let updated_at_slot = Clock::get()?.slot;
    authorize_identity_action(
        ctx.accounts.member_identity.key(),
        &ctx.accounts.member_identity,
        ctx.accounts.authority.key(),
        ctx.accounts
            .delegation
            .as_deref()
            .map(|delegation| &**delegation),
        SCOPE_COMMUNITY,
        updated_at_slot,
    )?;

    let config_key = ctx.accounts.config.key();
    let community_key = ctx.accounts.community.key();
    let member_identity_key = ctx.accounts.member_identity.key();
    let is_new = ctx.accounts.membership.version == 0;

    if is_new {
        require_eq!(
            args.expected_state_sequence,
            0,
            SocialProtocolError::MembershipSequenceMismatch
        );
        ctx.accounts.config.membership_count =
            checked_increment(ctx.accounts.config.membership_count)?;
        let membership = &mut ctx.accounts.membership;
        membership.version = ACCOUNT_VERSION;
        membership.config = config_key;
        membership.community = community_key;
        membership.member_identity = member_identity_key;
        membership.state_sequence = 0;
        membership.member_action_sequence = 0;
        membership.created_at_slot = updated_at_slot;
        membership.bump = ctx.bumps.membership;
    } else {
        require_eq!(
            ctx.accounts.membership.version,
            ACCOUNT_VERSION,
            SocialProtocolError::UnsupportedProtocolVersion
        );
        require_keys_eq!(
            ctx.accounts.membership.config,
            config_key,
            SocialProtocolError::CommunitySubstitution
        );
        require_keys_eq!(
            ctx.accounts.membership.community,
            community_key,
            SocialProtocolError::CommunitySubstitution
        );
        require_keys_eq!(
            ctx.accounts.membership.member_identity,
            member_identity_key,
            SocialProtocolError::CommunitySubstitution
        );
        validate_membership_state_roles(
            ctx.accounts.membership.state,
            ctx.accounts.membership.roles,
        )?;
        require!(
            ctx.accounts.membership.state != CommunityMembershipState::Banned,
            SocialProtocolError::MembershipBanned
        );
        require!(
            matches!(
                ctx.accounts.membership.state,
                CommunityMembershipState::Left | CommunityMembershipState::Removed
            ),
            SocialProtocolError::MembershipStateUnchanged
        );
        require_eq!(
            ctx.accounts.membership.state_sequence,
            args.expected_state_sequence,
            SocialProtocolError::MembershipSequenceMismatch
        );
    }

    let next_member_sequence = checked_next_sequence(
        ctx.accounts.member_identity.sequence,
        args.expected_member_sequence,
    )?;
    let next_state_sequence = checked_increment(ctx.accounts.membership.state_sequence)?;
    let next_community_membership_sequence =
        checked_increment(ctx.accounts.community.membership_sequence)?;

    ctx.accounts.member_identity.sequence = next_member_sequence;
    ctx.accounts.community.member_count = checked_increment(ctx.accounts.community.member_count)?;
    ctx.accounts.community.membership_sequence = next_community_membership_sequence;
    ctx.accounts.community.updated_at_slot = updated_at_slot;

    let membership = &mut ctx.accounts.membership;
    membership.acted_by_identity = member_identity_key;
    membership.action = CommunityMembershipAction::Join;
    membership.state = CommunityMembershipState::Active;
    membership.roles = COMMUNITY_ROLE_MEMBER;
    membership.state_sequence = next_state_sequence;
    membership.member_action_sequence = next_member_sequence;
    membership.actor_sequence = next_member_sequence;
    membership.active_since_membership_sequence = next_community_membership_sequence;
    membership.manifest_hash = args.manifest_hash;
    membership.manifest_uri = args.manifest_uri.clone();
    membership.updated_at_slot = updated_at_slot;

    emit!(CommunityMembershipChanged {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        community: community_key,
        membership: membership.key(),
        member_identity: member_identity_key,
        actor_identity: member_identity_key,
        authority: ctx.accounts.authority.key(),
        action: membership.action,
        state: membership.state,
        state_sequence: next_state_sequence,
        member_action_sequence: next_member_sequence,
        actor_sequence: next_member_sequence,
        membership_policy_sequence: ctx.accounts.community.membership_policy_sequence,
        community_membership_sequence: next_community_membership_sequence,
        active_since_membership_sequence: next_community_membership_sequence,
        roles: membership.roles,
        manifest_hash: args.manifest_hash,
        manifest_uri: args.manifest_uri,
        updated_at_slot,
    });

    Ok(())
}

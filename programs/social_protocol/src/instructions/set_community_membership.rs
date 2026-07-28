use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, COMMUNITY_SEED, CONFIG_SEED, DELEGATION_SEED, IDENTITY_SEED,
        MEMBERSHIP_SEED, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION, SCOPE_COMMUNITY,
    },
    errors::SocialProtocolError,
    events::CommunityMembershipChanged,
    state::{Community, CommunityMembership, Delegation, Identity, ProtocolConfig},
    validation::{
        authorize_identity_action, checked_decrement, checked_increment, checked_next_sequence,
        validate_community_roles,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetCommunityMembershipArgs {
    pub expected_authority_sequence: u64,
    pub active: bool,
    pub roles: u16,
}

#[derive(Accounts)]
pub struct SetCommunityMembership<'info> {
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
    #[account(
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
    pub member_identity: Account<'info, Identity>,
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
    pub membership: Account<'info, CommunityMembership>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            DELEGATION_SEED,
            creator_identity.key().as_ref(),
            authority.key().as_ref(),
            delegation.delegation_sequence.to_le_bytes().as_ref()
        ],
        bump = delegation.bump,
        has_one = config @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.identity == creator_identity.key()
            @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.delegate_authority == authority.key()
            @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub delegation: Option<Account<'info, Delegation>>,
}

pub fn handle_set_community_membership(
    ctx: Context<SetCommunityMembership>,
    args: SetCommunityMembershipArgs,
) -> Result<()> {
    validate_community_roles(args.active, args.roles)?;
    let updated_at_slot = Clock::get()?.slot;
    authorize_identity_action(
        ctx.accounts.creator_identity.key(),
        &ctx.accounts.creator_identity,
        ctx.accounts.authority.key(),
        ctx.accounts.delegation.as_deref(),
        SCOPE_COMMUNITY,
        updated_at_slot,
    )?;

    let config_key = ctx.accounts.config.key();
    let community_key = ctx.accounts.community.key();
    let member_identity_key = ctx.accounts.member_identity.key();
    let creator_identity_key = ctx.accounts.creator_identity.key();
    let is_new = ctx.accounts.membership.version == 0;

    if is_new {
        require!(args.active, SocialProtocolError::MembershipStateUnchanged);
        ctx.accounts.config.membership_count =
            checked_increment(ctx.accounts.config.membership_count)?;
        let membership = &mut ctx.accounts.membership;
        membership.version = ACCOUNT_VERSION;
        membership.config = config_key;
        membership.community = community_key;
        membership.member_identity = member_identity_key;
        membership.assigned_by_identity = creator_identity_key;
        membership.roles = 0;
        membership.state_sequence = 0;
        membership.authority_sequence = 0;
        membership.created_at_slot = updated_at_slot;
        membership.updated_at_slot = updated_at_slot;
        membership.active = false;
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
    }

    require!(
        ctx.accounts.membership.active != args.active
            || (args.active && ctx.accounts.membership.roles != args.roles),
        SocialProtocolError::MembershipStateUnchanged
    );

    let next_authority_sequence = checked_next_sequence(
        ctx.accounts.creator_identity.sequence,
        args.expected_authority_sequence,
    )?;
    let next_membership_sequence = checked_increment(ctx.accounts.membership.state_sequence)?;

    if ctx.accounts.membership.active != args.active {
        ctx.accounts.community.member_count = if args.active {
            checked_increment(ctx.accounts.community.member_count)?
        } else {
            checked_decrement(ctx.accounts.community.member_count)?
        };
    }

    ctx.accounts.creator_identity.sequence = next_authority_sequence;
    ctx.accounts.community.creator_sequence = next_authority_sequence;
    ctx.accounts.community.updated_at_slot = updated_at_slot;
    ctx.accounts.membership.assigned_by_identity = creator_identity_key;
    ctx.accounts.membership.roles = args.roles;
    ctx.accounts.membership.state_sequence = next_membership_sequence;
    ctx.accounts.membership.authority_sequence = next_authority_sequence;
    ctx.accounts.membership.updated_at_slot = updated_at_slot;
    ctx.accounts.membership.active = args.active;

    emit!(CommunityMembershipChanged {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        community: community_key,
        membership: ctx.accounts.membership.key(),
        member_identity: member_identity_key,
        assigned_by_identity: creator_identity_key,
        authority: ctx.accounts.authority.key(),
        authority_sequence: next_authority_sequence,
        membership_state_sequence: next_membership_sequence,
        roles: args.roles,
        active: args.active,
        updated_at_slot,
    });

    Ok(())
}

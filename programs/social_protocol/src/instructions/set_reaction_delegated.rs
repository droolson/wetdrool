use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, DELEGATION_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION,
        POST_SEED, PROTOCOL_VERSION, REACTION_SEED, SCOPE_SOCIAL,
    },
    errors::SocialProtocolError,
    events::ReactionStateChanged,
    instructions::SetReactionArgs,
    state::{Delegation, Identity, PostReference, ProtocolConfig, ReactionReference},
    validation::{
        authorize_identity_action, checked_increment, checked_next_sequence, validate_reaction_kind,
    },
};

#[derive(Accounts)]
#[instruction(args: SetReactionArgs)]
pub struct SetReactionDelegated<'info> {
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
            reactor_identity.origin_authority.as_ref(),
            reactor_identity.identity_nonce.as_ref()
        ],
        bump = reactor_identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        constraint = reactor_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub reactor_identity: Account<'info, Identity>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            POST_SEED,
            target_post.author_identity.as_ref(),
            target_post.post_nonce.as_ref()
        ],
        bump = target_post.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        constraint = target_post.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub target_post: Account<'info, PostReference>,
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
        constraint = delegation.identity == reactor_identity.key()
            @ SocialProtocolError::DelegationSubstitution,
        has_one = delegate_authority @ SocialProtocolError::DelegationSubstitution,
        constraint = delegation.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub delegation: Account<'info, Delegation>,
    pub delegate_authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = ReactionReference::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            REACTION_SEED,
            reactor_identity.key().as_ref(),
            target_post.key().as_ref(),
            args.reaction_kind.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub reaction_reference: Account<'info, ReactionReference>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_set_reaction_delegated(
    ctx: Context<SetReactionDelegated>,
    args: SetReactionArgs,
) -> Result<()> {
    validate_reaction_kind(args.reaction_kind)?;
    if args.active {
        require!(
            ctx.accounts.target_post.tombstoned_at_slot.is_none(),
            SocialProtocolError::PostTombstoned
        );
    }

    let updated_at_slot = Clock::get()?.slot;
    authorize_identity_action(
        ctx.accounts.reactor_identity.key(),
        &ctx.accounts.reactor_identity,
        ctx.accounts.delegate_authority.key(),
        Some(&ctx.accounts.delegation),
        SCOPE_SOCIAL,
        updated_at_slot,
    )?;

    let config_key = ctx.accounts.config.key();
    let reactor_identity_key = ctx.accounts.reactor_identity.key();
    let target_post_key = ctx.accounts.target_post.key();
    let is_new = ctx.accounts.reaction_reference.version == 0;

    if is_new {
        require!(args.active, SocialProtocolError::ReactionInactive);
        ctx.accounts.config.reaction_reference_count =
            checked_increment(ctx.accounts.config.reaction_reference_count)?;
        let reaction = &mut ctx.accounts.reaction_reference;
        reaction.version = ACCOUNT_VERSION;
        reaction.config = config_key;
        reaction.reactor_identity = reactor_identity_key;
        reaction.target_post = target_post_key;
        reaction.reaction_kind = args.reaction_kind;
        reaction.state_sequence = 0;
        reaction.reactor_sequence = 0;
        reaction.created_at_slot = updated_at_slot;
        reaction.updated_at_slot = updated_at_slot;
        reaction.active = false;
        reaction.bump = ctx.bumps.reaction_reference;
    } else {
        require_eq!(
            ctx.accounts.reaction_reference.version,
            ACCOUNT_VERSION,
            SocialProtocolError::UnsupportedProtocolVersion
        );
        require_keys_eq!(
            ctx.accounts.reaction_reference.config,
            config_key,
            SocialProtocolError::ReactionSubstitution
        );
        require_keys_eq!(
            ctx.accounts.reaction_reference.reactor_identity,
            reactor_identity_key,
            SocialProtocolError::ReactionSubstitution
        );
        require_keys_eq!(
            ctx.accounts.reaction_reference.target_post,
            target_post_key,
            SocialProtocolError::ReactionSubstitution
        );
        require_eq!(
            ctx.accounts.reaction_reference.reaction_kind,
            args.reaction_kind,
            SocialProtocolError::ReactionSubstitution
        );
    }

    if args.active {
        require!(
            !ctx.accounts.reaction_reference.active,
            SocialProtocolError::AlreadyReacted
        );
    } else {
        require!(
            ctx.accounts.reaction_reference.active,
            SocialProtocolError::ReactionInactive
        );
    }

    let next_reactor_sequence = checked_next_sequence(
        ctx.accounts.reactor_identity.sequence,
        args.expected_reactor_sequence,
    )?;
    let next_reaction_sequence = checked_increment(ctx.accounts.reaction_reference.state_sequence)?;
    ctx.accounts.reactor_identity.sequence = next_reactor_sequence;
    ctx.accounts.reaction_reference.state_sequence = next_reaction_sequence;
    ctx.accounts.reaction_reference.reactor_sequence = next_reactor_sequence;
    ctx.accounts.reaction_reference.updated_at_slot = updated_at_slot;
    ctx.accounts.reaction_reference.active = args.active;

    emit!(ReactionStateChanged {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        reaction_reference: ctx.accounts.reaction_reference.key(),
        reactor_identity: reactor_identity_key,
        target_post: target_post_key,
        authority: ctx.accounts.delegate_authority.key(),
        reaction_kind: args.reaction_kind,
        reactor_sequence: next_reactor_sequence,
        reaction_state_sequence: next_reaction_sequence,
        active: args.active,
        updated_at_slot,
    });

    Ok(())
}
